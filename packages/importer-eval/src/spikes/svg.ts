import { parseXml, type XmlElement } from "@archflow/diagram-importers";
import type { CorpusEntry, Direction } from "../corpus.ts";
import { renderDrawio } from "../corpus.ts";
import type { ImportOutcome, Imported, ImportedEdge } from "../score.ts";

/**
 * P1.6 SVG feasibility spike (research code, not shipped).
 *
 * 1. Fixture renderers: the same ground-truth diagrams rendered as (a) a plain hand-style SVG
 *    (rect + text + path with markers, nested <g transform>, CSS classes) and (b) an imitation of
 *    Mermaid's SVG structure (centred node groups, foreignObject labels, cubic paths, clusters).
 *    Plus (c) draw.io "SVG with embedded diagram" (handled by the product importer).
 * 2. A heuristic generic-SVG importer that recovers components, connectors (by geometry),
 *    arrowheads (markers), dashes (attribute/style/CSS class), labels and groups.
 */

// ------------------------------------------------------------------ fixtures

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const center = (n: { x: number; y: number; w: number; h: number }) => ({
  x: n.x + n.w / 2,
  y: n.y + n.h / 2,
});

/** Point on the border of rect n in the direction of p. */
function border(n: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) {
  const c = center(n);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const k = Math.min(
    Math.abs(dx) > 1e-9 ? n.w / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? n.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: c.x + dx * k, y: c.y + dy * k };
}

function markers(d: Direction): string {
  return d === "forward"
    ? ' marker-end="url(#arrow)"'
    : d === "backward"
      ? ' marker-start="url(#arrow-start)"'
      : d === "both"
        ? ' marker-start="url(#arrow-start)" marker-end="url(#arrow)"'
        : "";
}

export function renderPlainSvg(entry: CorpusEntry): string {
  const byKey = new Map(entry.nodes.map((n) => [n.key, n]));
  const groupByKey = new Map(entry.groups.map((g) => [g.key, g]));
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">`,
    `<style>.dash{stroke-dasharray:6 4}.conn{fill:none;stroke:#333}</style>`,
    `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L9,3 L0,6 z"/></marker>`,
    `<marker id="arrow-start" markerWidth="10" markerHeight="10" refX="0" refY="3" orient="auto"><path d="M9,0 L0,3 L9,6 z"/></marker></defs>`,
  ];
  // groups (absolute frames) drawn as nested <g transform> with a title
  const emitGroup = (key: string | undefined, ox: number, oy: number): void => {
    for (const g of entry.groups.filter((x) => x.parent === key)) {
      out.push(
        `<g transform="translate(${g.x - ox},${g.y - oy})"><rect width="${g.w}" height="${g.h}" fill="none" stroke="#999"/><text x="8" y="16">${esc(g.label)}</text>`,
      );
      emitNodes(g.key, g.x, g.y);
      emitGroup(g.key, g.x, g.y);
      out.push("</g>");
    }
  };
  const emitNodes = (group: string | undefined, ox: number, oy: number): void => {
    for (const n of entry.nodes.filter((x) => x.group === group))
      out.push(
        `<g transform="translate(${n.x - ox},${n.y - oy})"><rect width="${n.w}" height="${n.h}" rx="6" fill="#eef"/><text x="${n.w / 2}" y="${n.h / 2 + 4}" text-anchor="middle">${esc(n.label)}</text></g>`,
      );
  };
  emitNodes(undefined, 0, 0);
  emitGroup(undefined, 0, 0);
  void groupByKey;
  for (const e of entry.edges) {
    const a = byKey.get(e.from)!;
    const b = byKey.get(e.to)!;
    const p1 = border(a, center(b));
    const p2 = border(b, center(a));
    const d =
      e.routing === "curved"
        ? `M${p1.x},${p1.y} Q${(p1.x + p2.x) / 2},${(p1.y + p2.y) / 2 - 30} ${p2.x},${p2.y}`
        : e.routing === "orthogonal"
          ? `M${p1.x},${p1.y} H${(p1.x + p2.x) / 2} V${p2.y} H${p2.x}`
          : `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
    out.push(
      `<path class="conn${e.stroke === "dashed" ? " dash" : ""}" d="${d}"${markers(e.direction)}/>`,
    );
    if (e.label !== undefined)
      out.push(
        `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 6}" text-anchor="middle">${esc(e.label)}</text>`,
      );
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}

/** Structural imitation of Mermaid's flowchart SVG (not produced by Mermaid itself). */
export function renderMermaidLikeSvg(entry: CorpusEntry): string {
  const byKey = new Map(entry.nodes.map((n) => [n.key, n]));
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-1" class="flowchart" viewBox="0 0 1200 800">`,
    `<style>#mermaid-1 .flowchart-link{stroke:#333;fill:none}#mermaid-1 .edge-pattern-dashed{stroke-dasharray:3}</style>`,
    `<g><marker id="mermaid-1_flowchart-v2-pointEnd" class="marker flowchart-v2" viewBox="0 0 10 10" refX="5" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker><marker id="mermaid-1_flowchart-v2-pointStart" class="marker flowchart-v2" viewBox="0 0 10 10" refX="4.5" refY="5" orient="auto"><path d="M 0 5 L 10 10 L 10 0 z"/></marker>`,
    `<g class="root"><g class="clusters">`,
  ];
  for (const g of entry.groups)
    out.push(
      `<g class="cluster" id="${g.key}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}"/><g class="cluster-label" transform="translate(${g.x + 10},${g.y + 4})"><foreignObject width="200" height="24"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>${esc(g.label)}</p></span></div></foreignObject></g></g>`,
    );
  out.push(`</g><g class="edgePaths">`);
  for (const e of entry.edges) {
    const a = byKey.get(e.from)!;
    const b = byKey.get(e.to)!;
    const p1 = border(a, center(b));
    const p2 = border(b, center(a));
    const mk =
      e.direction === "forward"
        ? ' marker-end="url(#mermaid-1_flowchart-v2-pointEnd)"'
        : e.direction === "both"
          ? ' marker-start="url(#mermaid-1_flowchart-v2-pointStart)" marker-end="url(#mermaid-1_flowchart-v2-pointEnd)"'
          : e.direction === "backward"
            ? ' marker-start="url(#mermaid-1_flowchart-v2-pointStart)"'
            : "";
    out.push(
      `<path d="M${p1.x},${p1.y}C${p1.x + 20},${p1.y} ${p2.x - 20},${p2.y} ${p2.x},${p2.y}" id="L_${e.from}_${e.to}_0" class="edge-thickness-normal ${e.stroke === "dashed" ? "edge-pattern-dashed" : "edge-pattern-solid"} flowchart-link"${mk}/>`,
    );
  }
  out.push(`</g><g class="edgeLabels">`);
  for (const e of entry.edges) {
    if (e.label === undefined) continue;
    const a = center(byKey.get(e.from)!);
    const b = center(byKey.get(e.to)!);
    out.push(
      `<g class="edgeLabel" transform="translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})"><g class="label" transform="translate(-30,-12)"><foreignObject width="60" height="24"><div xmlns="http://www.w3.org/1999/xhtml"><span class="edgeLabel"><p>${esc(e.label)}</p></span></div></foreignObject></g></g>`,
    );
  }
  out.push(`</g><g class="nodes">`);
  for (const n of entry.nodes) {
    const c = center(n);
    out.push(
      `<g class="node default" id="flowchart-${n.key}-0" transform="translate(${c.x},${c.y})"><rect class="basic label-container" x="${-n.w / 2}" y="${-n.h / 2}" width="${n.w}" height="${n.h}"/><g class="label" transform="translate(${-n.w / 2 + 8},-12)"><rect/><foreignObject width="${n.w - 16}" height="24"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>${esc(n.label)}</p></span></div></foreignObject></g></g>`,
    );
  }
  out.push(`</g></g></g></svg>`);
  return out.join("\n") + "\n";
}

/** draw.io "Export as SVG" with "Include a copy of my diagram" (simplified body). */
export function renderDrawioSvg(entry: CorpusEntry): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" content="${esc(renderDrawio(entry))}"><g><rect width="10" height="10"/></g></svg>\n`;
}

// ------------------------------------------------------------------ heuristic importer

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: M, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
function parseTransform(t: string | undefined): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let n: M = [1, 0, 0, 1, 0, 0];
    if (fn === "translate") n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (fn === "scale") n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (fn === "matrix" && v.length === 6) n = v as M;
    m = mul(m, n);
  }
  return m;
}
const num = (s: string | undefined): number => (s === undefined ? 0 : Number(s) || 0);
function allText(el: XmlElement): string {
  return [el.text, ...el.children.map(allText)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
function pathEnds(
  d: string,
): { a: { x: number; y: number }; b: { x: number; y: number } } | undefined {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let start: { x: number; y: number } | undefined;
  const nums = (k: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < k; j++) out.push(Number(toks[i++]));
    return out;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const k = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, S: 4, T: 2, A: 7, Z: 0 }[C as "M"] ?? 0;
    if (C === "Z") {
      i++;
      continue;
    }
    const v = nums(k);
    if (v.some((n) => Number.isNaN(n))) break;
    if (C === "H") x = rel ? x + v[0]! : v[0]!;
    else if (C === "V") y = rel ? y + v[0]! : v[0]!;
    else {
      const nx = v[k - 2]!;
      const ny = v[k - 1]!;
      x = rel ? x + nx : nx;
      y = rel ? y + ny : ny;
    }
    if (C === "M" && !start) start = { x, y };
    if (C === "M") cmd = rel ? "l" : "L";
  }
  return start ? { a: start, b: { x, y } } : undefined;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export function importGenericSvg(text: string): ImportOutcome {
  let root: XmlElement;
  try {
    root = parseXml(text.replace(/<!DOCTYPE[^>]*>/i, ""));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (root.name !== "svg") return { ok: false, error: "not an SVG document" };
  // CSS: `.cls{...}` rules that set markers / dashes
  const css = [...allCss(root).matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({
    sel: sel!,
    body: body!,
  }));
  const styleOf = (el: XmlElement): string => {
    const cls = (el.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
    return [
      ...css
        .filter((r) => cls.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(r.sel)))
        .map((r) => r.body),
      el.attrs["style"] ?? "",
    ].join(";");
  };
  const shapes: Box[] = [];
  const texts: { x: number; y: number; text: string }[] = [];
  const lines: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    start: boolean;
    end: boolean;
    dashed: boolean;
  }[] = [];
  const walk = (el: XmlElement, ctm: M): void => {
    if (el.name === "defs" || el.name === "marker" || el.name === "style") return;
    const m = mul(ctm, parseTransform(el.attrs["transform"]));
    const st = styleOf(el);
    if (el.name === "rect" || el.name === "ellipse" || el.name === "circle") {
      let x: number, y: number, w: number, h: number;
      if (el.name === "rect")
        [x, y, w, h] = [
          num(el.attrs["x"]),
          num(el.attrs["y"]),
          num(el.attrs["width"]),
          num(el.attrs["height"]),
        ];
      else {
        const rx = num(el.attrs["rx"] ?? el.attrs["r"]);
        const ry = num(el.attrs["ry"] ?? el.attrs["r"]);
        [x, y, w, h] = [num(el.attrs["cx"]) - rx, num(el.attrs["cy"]) - ry, 2 * rx, 2 * ry];
      }
      const p = apply(m, x, y);
      const q = apply(m, x + w, y + h);
      if (q.x - p.x >= 20 && q.y - p.y >= 15)
        shapes.push({ x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y, label: "" });
    } else if (el.name === "text") {
      const p = apply(m, num(el.attrs["x"]), num(el.attrs["y"]) - 4);
      const t = allText(el);
      if (t) texts.push({ ...p, text: t });
      return;
    } else if (el.name === "foreignObject") {
      const p = apply(
        m,
        num(el.attrs["x"]) + num(el.attrs["width"]) / 2,
        num(el.attrs["y"]) + num(el.attrs["height"]) / 2,
      );
      const t = allText(el);
      if (t) texts.push({ ...p, text: t });
      return;
    } else if (el.name === "path" || el.name === "line" || el.name === "polyline") {
      let ends: { a: { x: number; y: number }; b: { x: number; y: number } } | undefined;
      if (el.name === "path") ends = pathEnds(el.attrs["d"] ?? "");
      else if (el.name === "line")
        ends = {
          a: { x: num(el.attrs["x1"]), y: num(el.attrs["y1"]) },
          b: { x: num(el.attrs["x2"]), y: num(el.attrs["y2"]) },
        };
      else {
        const v = (el.attrs["points"] ?? "")
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
        if (v.length >= 4)
          ends = { a: { x: v[0]!, y: v[1]! }, b: { x: v[v.length - 2]!, y: v[v.length - 1]! } };
      }
      const start = !!el.attrs["marker-start"] || /marker-start\s*:\s*url/.test(st);
      const end = !!el.attrs["marker-end"] || /marker-end\s*:\s*url/.test(st);
      const dashed = !!el.attrs["stroke-dasharray"] || /stroke-dasharray\s*:\s*[1-9]/.test(st);
      const fill = el.attrs["fill"] ?? (/fill\s*:\s*none/.test(st) ? "none" : undefined);
      if (ends && (start || end || fill === "none" || el.name !== "path"))
        lines.push({
          a: apply(m, ends.a.x, ends.a.y),
          b: apply(m, ends.b.x, ends.b.y),
          start,
          end,
          dashed,
        });
      return;
    }
    for (const c of el.children) walk(c, m);
  };
  walk(root, [1, 0, 0, 1, 0, 0]);

  // label shapes: each text goes to the smallest shape containing its anchor
  const inside = (b: Box, p: { x: number; y: number }, pad = 0) =>
    p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  const contains = (a: Box, b: Box) =>
    b.x >= a.x - 0.5 &&
    b.y >= a.y - 0.5 &&
    b.x + b.w <= a.x + a.w + 0.5 &&
    b.y + b.h <= a.y + a.h + 0.5 &&
    (a.w > b.w || a.h > b.h);
  const free: typeof texts = [];
  const isContainer = (b: Box) => shapes.some((o) => o !== b && contains(b, o));
  const lineMid = (p: { x: number; y: number }) =>
    Math.min(
      Infinity,
      ...lines.map((l) => Math.hypot((l.a.x + l.b.x) / 2 - p.x, (l.a.y + l.b.y) / 2 - p.y)),
    );
  for (const t of texts) {
    let hit: Box | undefined = shapes
      .filter((s) => inside(s, t))
      .sort((p, q) => p.w * p.h - q.w * q.h)[0];
    // a text inside a container but next to a connector midpoint is that connector's label
    if (hit && isContainer(hit) && lineMid(t) < 30) hit = undefined;
    if (hit) hit.label = (hit.label ? hit.label + " " : "") + t.text;
    else free.push(t);
  }
  const labelled = shapes.filter((s) => s.label);
  const groups = labelled.filter((s) => labelled.some((o) => o !== s && contains(s, o)));
  const nodes = labelled.filter((s) => !groups.includes(s));
  const nearest = (p: { x: number; y: number }) =>
    nodes
      .map((n) => ({
        n,
        d: Math.hypot(
          Math.max(n.x - p.x, 0, p.x - n.x - n.w),
          Math.max(n.y - p.y, 0, p.y - n.y - n.h),
        ),
      }))
      .filter((x) => x.d <= 15)
      .sort((p, q) => p.d - q.d)[0]?.n;
  const edges: ImportedEdge[] = [];
  const mids: { x: number; y: number; e: ImportedEdge }[] = [];
  for (const l of lines) {
    const a = nearest(l.a);
    const b = nearest(l.b);
    if (!a || !b || a === b) continue;
    const direction: Direction =
      l.start && l.end ? "both" : l.end ? "forward" : l.start ? "backward" : "none";
    const e: ImportedEdge = {
      from: a.label,
      to: b.label,
      direction,
      stroke: l.dashed ? "dashed" : "solid",
    };
    edges.push(e);
    mids.push({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2, e });
  }
  for (const t of free) {
    const m = mids
      .map((x) => ({ x, d: Math.hypot(x.x - t.x, x.y - t.y) }))
      .filter((x) => x.d < 45 && x.x.e.label === undefined)
      .sort((p, q) => p.d - q.d)[0];
    if (m) m.x.e.label = t.text;
  }
  const directGroup = (b: Box) =>
    groups.filter((g) => contains(g, b)).sort((p, q) => p.w * p.h - q.w * q.h)[0];
  const imported: Imported = {
    nodes: nodes.map((n) => {
      const g = directGroup(n);
      return { label: n.label, x: n.x, y: n.y, w: n.w, h: n.h, ...(g ? { group: g.label } : {}) };
    }),
    edges,
    groups: groups.map((g) => {
      const p = directGroup(g);
      return { label: g.label, ...(p ? { parent: p.label } : {}) };
    }),
    warnings: [],
  };
  return { ok: true, imported };
}

function allCss(el: XmlElement): string {
  return (el.name === "style" ? el.text : "") + el.children.map(allCss).join("\n");
}
