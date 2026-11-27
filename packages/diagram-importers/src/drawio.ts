import {
  LIMITS,
  type CanonicalDocument,
  type CanonicalEdge,
  type CanonicalGroup,
  type CanonicalNode,
} from "@archflow/canonical-model";
import {
  IdMapper,
  Issues,
  checkInput,
  clamp,
  collapse,
  emptyDocument,
  finish,
  fitLabel,
  htmlToText,
  type ImportOptions,
  type ImportResult,
} from "./common.ts";
import { XmlError, childrenNamed, firstChild, parseXml, type XmlElement } from "./xml.ts";

/**
 * draw.io / diagrams.net importer (uncompressed and compressed pages, layers, containers,
 * `UserObject`/`object` wrappers, edge-label child cells, HTML labels, waypoints).
 *
 * Faithfulness rules:
 * - geometry is converted to absolute coordinates (children of containers are parent-relative
 *   in draw.io);
 * - arrowheads are read, never assumed: no arrowhead on either end = `direction: "none"`;
 * - anything that cannot be represented is dropped WITH a warning, never silently.
 */

export interface DrawioOptions extends ImportOptions {
  /** 0-based page index for multi-page files. Default 0. */
  page?: number;
}

/** Decompressed page size cap (zip-bomb guard). */
const MAX_DECOMPRESSED_CHARS = 16_000_000;

interface Cell {
  id: string;
  value: string;
  style: Map<string, string>;
  /** First bare token of the style string (e.g. `text`, `ellipse`, `swimlane`). */
  styleTokens: Set<string>;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geo?: XmlElement;
  html: boolean;
  /** Document order. */
  order: number;
}

export async function importDrawio(
  text: string,
  options: DrawioOptions = {},
): Promise<ImportResult> {
  const issues = new Issues();
  if (!checkInput(text, issues, "drawio"))
    return { ok: false, errors: issues.errors, warnings: [] };

  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (e) {
    return xmlFailure(e, issues);
  }

  // ---- locate the page's mxGraphModel ----
  // draw.io "Export as SVG" with "Include a copy of my diagram" stores the full mxfile in the
  // root `content` attribute: import that (exact model, no SVG geometry guessing).
  if (root.name === "svg") {
    const embedded = root.attrs["content"];
    if (
      embedded &&
      /<mxfile|<mxGraphModel/.test(embedded) &&
      (options as { _svgDepth?: number })._svgDepth === undefined
    ) {
      const r = await importDrawio(embedded, { ...options, _svgDepth: 1 } as DrawioOptions);
      const note = {
        code: "drawio.from_svg",
        message: "imported the draw.io diagram embedded in this SVG",
      };
      return r.ok
        ? { ...r, warnings: [note, ...r.warnings] }
        : { ...r, warnings: [note, ...r.warnings] };
    }
    issues.error(
      "svg.not_supported",
      'this SVG has no embedded draw.io diagram; generic SVG import is not supported (export from draw.io with "Include a copy of my diagram", or use the source file)',
    );
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }
  let model: XmlElement | undefined;
  let pageName: string | undefined;
  let pageId: string | undefined;
  if (root.name === "mxGraphModel") model = root;
  else if (root.name === "mxfile") {
    const pages = childrenNamed(root, "diagram");
    if (pages.length === 0) {
      issues.error("drawio.no_model", "the file contains no <diagram> page");
      return { ok: false, errors: issues.errors, warnings: issues.warnings };
    }
    const index = options.page ?? 0;
    const page = pages[index];
    if (!page) {
      issues.error("drawio.no_page", `page ${index + 1} requested, file has ${pages.length}`);
      return { ok: false, errors: issues.errors, warnings: issues.warnings };
    }
    if (pages.length > 1)
      issues.warn(
        "drawio.multiple_pages",
        `file has ${pages.length} pages; imported page ${index + 1} ("${page.attrs["name"] ?? ""}")`,
      );
    pageName = page.attrs["name"];
    pageId = page.attrs["id"];
    model = firstChild(page, "mxGraphModel");
    if (!model && page.text.length > 0) {
      try {
        const xml = await inflatePage(page.text);
        model = parseXml(xml);
        if (model.name !== "mxGraphModel") model = undefined;
      } catch (e) {
        if (e instanceof XmlError) return xmlFailure(e, issues);
        issues.error(
          "drawio.decompress_failed",
          `compressed page could not be decoded: ${(e as Error).message}`,
        );
        return { ok: false, errors: issues.errors, warnings: issues.warnings };
      }
    }
  }
  if (!model) {
    issues.error("drawio.no_model", "no <mxGraphModel> found (is this a draw.io file?)");
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }
  const rootEl = firstChild(model, "root");
  if (!rootEl) {
    issues.error("drawio.no_model", "<mxGraphModel> has no <root>");
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }

  // ---- collect cells (unwrap UserObject/object) ----
  const cells: Cell[] = [];
  const byId = new Map<string, Cell>();
  let order = 0;
  for (const el of rootEl.children) {
    let cellEl: XmlElement | undefined;
    let id: string | undefined;
    let value: string | undefined;
    if (el.name === "mxCell") {
      cellEl = el;
      id = el.attrs["id"];
      value = el.attrs["value"];
    } else if (el.name === "UserObject" || el.name === "object") {
      cellEl = firstChild(el, "mxCell");
      id = el.attrs["id"];
      value = el.attrs["label"];
      if (el.attrs["placeholders"] === "1")
        issues.warnOnce(
          "drawio.placeholders_not_expanded",
          "labels using %placeholders% are imported as written",
          id,
        );
    } else continue;
    if (!cellEl || id === undefined) continue;
    const styleText = cellEl.attrs["style"] ?? "";
    const { map, tokens } = parseStyle(styleText);
    const cell: Cell = {
      id,
      value: value ?? "",
      style: map,
      styleTokens: tokens,
      vertex: cellEl.attrs["vertex"] === "1",
      edge: cellEl.attrs["edge"] === "1",
      ...(cellEl.attrs["parent"] !== undefined ? { parent: cellEl.attrs["parent"] } : {}),
      ...(cellEl.attrs["source"] !== undefined ? { source: cellEl.attrs["source"] } : {}),
      ...(cellEl.attrs["target"] !== undefined ? { target: cellEl.attrs["target"] } : {}),
      ...(firstChild(cellEl, "mxGeometry") ? { geo: firstChild(cellEl, "mxGeometry")! } : {}),
      html: map.get("html") === "1",
      order: order++,
    };
    if (byId.has(id)) {
      issues.warn("drawio.duplicate_cell_id", `duplicate cell id; later cell ignored`, id);
      continue;
    }
    byId.set(id, cell);
    cells.push(cell);
  }

  const labelOf = (c: Cell): string => {
    const raw = c.html ? htmlToText(c.value) : collapse(c.value);
    return fitLabel(raw, issues, c.id);
  };

  // ---- classify vertices ----
  const edgeLabelsOf = new Map<string, Cell[]>();
  const vertexChildren = new Map<string, Cell[]>();
  for (const c of cells) {
    if (!c.vertex || c.parent === undefined) continue;
    const parent = byId.get(c.parent);
    if (parent?.edge) {
      edgeLabelsOf.set(parent.id, [...(edgeLabelsOf.get(parent.id) ?? []), c]);
      continue;
    }
    if (parent?.vertex)
      vertexChildren.set(parent.id, [...(vertexChildren.get(parent.id) ?? []), c]);
  }
  type Kind = "node" | "group" | "flatgroup" | "text" | "edgelabel";
  const kindOf = new Map<string, Kind>();
  for (const c of cells) {
    if (!c.vertex) continue;
    const parent = c.parent !== undefined ? byId.get(c.parent) : undefined;
    if (parent?.edge) kindOf.set(c.id, "edgelabel");
    else if (
      c.styleTokens.has("swimlane") ||
      c.style.get("container") === "1" ||
      c.styleTokens.has("group") ||
      (vertexChildren.get(c.id)?.length ?? 0) > 0
    ) {
      const label = labelOf(c);
      // An invisible "group" with no title is a selection group, not a component container.
      kindOf.set(c.id, c.styleTokens.has("group") && label === "" ? "flatgroup" : "group");
    } else if (c.styleTokens.has("text") || c.styleTokens.has("edgeLabel"))
      kindOf.set(c.id, "text");
    else kindOf.set(c.id, "node");
  }

  // ---- absolute geometry ----
  const absCache = new Map<string, { x: number; y: number }>();
  const absOrigin = (id: string | undefined, depth = 0): { x: number; y: number } => {
    if (id === undefined || depth > 64) return { x: 0, y: 0 };
    const cached = absCache.get(id);
    if (cached) return cached;
    const c = byId.get(id);
    if (!c || !c.vertex) return { x: 0, y: 0 };
    const p = absOrigin(c.parent, depth + 1);
    const g = c.geo;
    const r = { x: p.x + num(g?.attrs["x"]), y: p.y + num(g?.attrs["y"]) };
    absCache.set(id, r);
    return r;
  };
  const rect = (c: Cell): { x: number; y: number; w: number; h: number; ok: boolean } => {
    const o = absOrigin(c.id);
    const w = num(c.geo?.attrs["width"]);
    const h = num(c.geo?.attrs["height"]);
    return { x: o.x, y: o.y, w, h, ok: c.geo !== undefined && w > 0 && h > 0 };
  };

  // ---- groups ----
  const groupIds = new IdMapper("group");
  const groups: CanonicalGroup[] = [];
  const canonicalGroupOf = (c: Cell | undefined, depth = 0): string | undefined => {
    // nearest enclosing real group (flat groups are transparent)
    for (let cur = c; cur && depth < 64; depth++) {
      const k = kindOf.get(cur.id);
      if (k === "group") return groupIds.get(cur.id);
      cur = cur.parent !== undefined ? byId.get(cur.parent) : undefined;
    }
    return undefined;
  };
  for (const c of cells) {
    if (kindOf.get(c.id) !== "group") continue;
    const id = groupIds.assign(c.id);
    const r = rect(c);
    groups.push({
      id,
      label: labelOf(c),
      ...(r.ok ? { frame: { x: r.x, y: r.y, w: r.w, h: r.h } } : {}),
    });
  }
  for (const g of groups) {
    const src = cells.find((c) => groupIds.get(c.id) === g.id)!;
    const parent = src.parent !== undefined ? canonicalGroupOf(byId.get(src.parent)) : undefined;
    if (parent !== undefined) g.parentId = parent;
  }
  if (cells.some((c) => kindOf.get(c.id) === "flatgroup"))
    issues.warnOnce(
      "drawio.selection_group_flattened",
      "untitled draw.io groups were flattened (their shapes are kept at their absolute positions)",
    );

  // ---- nodes ----
  const nodeIds = new IdMapper("node");
  const nodes: CanonicalNode[] = [];
  for (const c of cells) {
    const kind = kindOf.get(c.id);
    if (kind === "text") {
      issues.warn(
        "drawio.text_ignored",
        "free text/annotation cell is not a component; ignored",
        c.id,
      );
      continue;
    }
    if (kind !== "node") continue;
    const r = rect(c);
    if (!r.ok)
      issues.warn("drawio.missing_geometry", "shape without size; default 120x60 used", c.id);
    let w = r.ok ? r.w : 120;
    let h = r.ok ? r.h : 60;
    if (w < LIMITS.minNodeSize || h < LIMITS.minNodeSize) {
      issues.warn(
        "drawio.node_resized",
        `shape ${w}x${h} enlarged to the minimum ${LIMITS.minNodeSize}px`,
        c.id,
      );
      w = Math.max(w, LIMITS.minNodeSize);
      h = Math.max(h, LIMITS.minNodeSize);
    }
    const group = c.parent !== undefined ? canonicalGroupOf(byId.get(c.parent)) : undefined;
    nodes.push({
      id: nodeIds.assign(c.id),
      label: labelOf(c),
      kind: kindFromStyle(c),
      x: clamp(r.x, -LIMITS.maxCoordinate, LIMITS.maxCoordinate),
      y: clamp(r.y, -LIMITS.maxCoordinate, LIMITS.maxCoordinate),
      w: Math.min(w, 2000),
      h: Math.min(h, 2000),
      ...(group !== undefined ? { groupId: group } : {}),
    });
  }

  // ---- edges ----
  const edgeIds = new IdMapper("edge");
  const edges: CanonicalEdge[] = [];
  for (const c of cells) {
    if (!c.edge) continue;
    const endpoint = (ref: string | undefined, role: string): string | undefined => {
      if (ref === undefined) {
        issues.warn("drawio.dangling_edge", `connector has no ${role}; dropped`, c.id);
        return undefined;
      }
      const k = kindOf.get(ref);
      if (k === "node") return nodeIds.get(ref);
      if (k === "group" || k === "flatgroup")
        issues.warn(
          "drawio.edge_to_group",
          `connector ${role} is a container; containers cannot carry traffic in the canonical model; dropped`,
          c.id,
        );
      else
        issues.warn(
          "drawio.edge_unsupported_endpoint",
          `connector ${role} is not a component; dropped`,
          c.id,
        );
      return undefined;
    };
    const from = endpoint(c.source, "source");
    const to = from !== undefined ? endpoint(c.target, "target") : undefined;
    if (from === undefined || to === undefined) continue;
    if (from === to) {
      issues.warn("drawio.self_loop", "self-loop connectors are not supported; dropped", c.id);
      continue;
    }
    const startArrow = c.style.get("startArrow") ?? "none";
    const endArrow = c.style.get("endArrow") ?? "classic";
    const start = startArrow !== "none" && startArrow !== "";
    const end = endArrow !== "none" && endArrow !== "";
    const direction = start && end ? "both" : end ? "forward" : start ? "backward" : "none";
    const labels = [
      c.value ? labelOf(c) : "",
      ...(edgeLabelsOf.get(c.id) ?? []).map(labelOf),
    ].filter((l) => l.length > 0);
    const label = labels.length > 0 ? fitLabel(labels.join(" "), issues, c.id) : undefined;
    const edgeStyle = c.style.get("edgeStyle") ?? "";
    const routing =
      c.style.get("curved") === "1"
        ? "curved"
        : /orthogonal|elbow|entityRelation|isometric/i.test(edgeStyle)
          ? "orthogonal"
          : "straight";
    const dashed = c.style.get("dashed") === "1";
    const dotted = dashed && /^\s*1(\s|$)/.test(c.style.get("dashPattern") ?? "");
    const parentOrigin = absOrigin(c.parent);
    const points = (c.geo?.children ?? [])
      .filter((x) => x.name === "Array" && x.attrs["as"] === "points")
      .flatMap((a) => childrenNamed(a, "mxPoint"))
      .map((p) => ({
        x: clamp(parentOrigin.x + num(p.attrs["x"]), -LIMITS.maxCoordinate, LIMITS.maxCoordinate),
        y: clamp(parentOrigin.y + num(p.attrs["y"]), -LIMITS.maxCoordinate, LIMITS.maxCoordinate),
      }));
    if (points.length > LIMITS.maxWaypoints)
      issues.warn(
        "drawio.waypoints_truncated",
        `more than ${LIMITS.maxWaypoints} waypoints; extra dropped`,
        c.id,
      );
    const head = arrowHead(end ? endArrow : start ? startArrow : "none", issues, c.id);
    edges.push({
      id: edgeIds.assign(c.id),
      from,
      to,
      ...(label !== undefined ? { label } : {}),
      direction,
      arrowHead: head,
      stroke: dotted ? "dotted" : dashed ? "dashed" : "solid",
      routing,
      ...(points.length > 0 ? { waypoints: points.slice(0, LIMITS.maxWaypoints) } : {}),
    });
  }

  const rewritten = nodeIds.rewritten + edgeIds.rewritten + groupIds.rewritten;
  if (rewritten > 0)
    issues.warn(
      "import.ids_rewritten",
      `${rewritten} source id(s) were rewritten to valid canonical ids`,
    );
  if (nodes.length === 0) issues.error("drawio.no_components", "no components (shapes) found");
  if (nodes.length > LIMITS.maxNodes)
    issues.error("drawio.too_many_nodes", `more than ${LIMITS.maxNodes} shapes`);
  if (edges.length > LIMITS.maxEdges)
    issues.error("drawio.too_many_edges", `more than ${LIMITS.maxEdges} connectors`);
  if (groups.length > LIMITS.maxGroups)
    issues.error("drawio.too_many_groups", `more than ${LIMITS.maxGroups} containers`);

  const idSource = options.diagramId ?? pageId ?? "drawio";
  const doc: CanonicalDocument = emptyDocument(
    new IdMapper("diagram").assign(idSource),
    fitLabel(options.name ?? pageName ?? "Imported draw.io diagram", issues, "name"),
  );
  doc.diagram.nodes = nodes;
  doc.diagram.edges = edges;
  doc.diagram.groups = groups;
  return finish(doc, issues);
}

function xmlFailure(e: unknown, issues: Issues): ImportResult {
  if (e instanceof XmlError) {
    const code =
      e.code === "doctype"
        ? "drawio.doctype_rejected"
        : e.code === "limit"
          ? "drawio.too_complex"
          : "drawio.malformed";
    issues.error(code, e.message);
  } else issues.error("drawio.malformed", e instanceof Error ? e.message : String(e));
  return { ok: false, errors: issues.errors, warnings: issues.warnings };
}

function num(v: string | undefined): number {
  const n = v === undefined ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseStyle(style: string): { map: Map<string, string>; tokens: Set<string> } {
  const map = new Map<string, string>();
  const tokens = new Set<string>();
  for (const part of style.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq < 0) tokens.add(p);
    else map.set(p.slice(0, eq).trim(), p.slice(eq + 1).trim());
  }
  return { map, tokens };
}

function kindFromStyle(c: Cell): CanonicalNode["kind"] {
  const shape = (c.style.get("shape") ?? "").toLowerCase();
  const t = c.styleTokens;
  if (/cylinder|datastore|database/.test(shape) || t.has("cylinder")) return "db";
  if (t.has("rhombus") || shape === "rhombus") return "decision";
  if (shape === "document" || t.has("document")) return "document";
  if (shape === "cloud" || t.has("cloud")) return "cloud";
  if (/actor|umlactor/.test(shape) || t.has("actor")) return "user";
  if (/queue/.test(shape)) return "queue";
  return "service";
}

function arrowHead(name: string, issues: Issues, source: string): CanonicalEdge["arrowHead"] {
  const n = name.toLowerCase();
  if (n === "none") return "none";
  if (/^(classic|classicthin|block|blockthin|async)$/.test(n)) return "triangle";
  if (/^(open|openthin|openasync)$/.test(n)) return "open";
  if (/^diamond/.test(n)) return "diamond";
  if (/^(oval|circle|circleplus|dot)$/.test(n)) return "circle";
  issues.warnOnce(
    "drawio.arrow_mapped",
    `arrowhead "${name}" has no canonical equivalent; drawn as triangle`,
    source,
  );
  return "triangle";
}

/** base64 -> raw DEFLATE -> URI-encoded XML (draw.io's compressed page format). */
export async function inflatePage(b64: string): Promise<string> {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECOMPRESSED_CHARS) {
      await reader.cancel();
      throw new XmlError("limit", `compressed page expands beyond ${MAX_DECOMPRESSED_CHARS} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(all);
  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded; // some writers omit the URI encoding step
  }
}
