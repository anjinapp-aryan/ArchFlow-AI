import {
  looksLikeMonitoring,
  type CanonicalEdge,
  type CanonicalGroup,
  type CanonicalNode,
} from "@archflow/canonical-model";
import { IdMapper, Issues, fitLabel } from "./common.ts";
import { applyRoutes, layoutGraph, type RankDir } from "./layout.ts";
import { ignorable, slug, unquote, type Statement } from "./mermaid-text.ts";

/**
 * Mermaid flowchart (`flowchart` / `graph`) parser + layout. Supported: node shapes (incl. the
 * `@{ shape, label }` form), quoted/markdown/entity labels, every link type (`-->`, `---`,
 * `-.->`, `==>`, `<-->`, `o--o`, `x--x`, `~~~`, longer links), `|label|` and `-- label -->`
 * forms, chains, `&` fan-out, edge ids (`e1@-->`), nested subgraphs, `:::class`.
 * Styling statements are ignored with a warning. Unsupported constructs are reported, never
 * guessed.
 */

interface NodeRef {
  id: string;
  label?: string;
  shape?: string;
}
interface Link {
  start?: string;
  end?: string;
  body: string;
  label?: string;
}

const SHAPES: { open: string; closes: [string, string][] }[] = [
  { open: "(((", closes: [[")))", "dcircle"]] },
  { open: "([", closes: [["])", "stadium"]] },
  { open: "[[", closes: [["]]", "subroutine"]] },
  { open: "[(", closes: [[")]", "cylinder"]] },
  { open: "((", closes: [["))", "circle"]] },
  { open: "{{", closes: [["}}", "hexagon"]] },
  {
    open: "[/",
    closes: [
      ["/]", "parallelogram"],
      ["\\]", "trapezoid"],
    ],
  },
  {
    open: "[\\",
    closes: [
      ["\\]", "parallelogram"],
      ["/]", "trapezoid"],
    ],
  },
  { open: "(", closes: [[")", "round"]] },
  { open: "[", closes: [["]", "rect"]] },
  { open: "{", closes: [["}", "rhombus"]] },
  { open: ">", closes: [["]", "asym"]] },
];

const ID_RE = /[\p{L}\p{N}_](?:[\p{L}\p{N}_]|-(?=[\p{L}\p{N}_]))*/uy;

class Scanner {
  i = 0;
  constructor(readonly s: string) {}
  ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  done(): boolean {
    return this.i >= this.s.length;
  }
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i = re.lastIndex;
    return m;
  }
  startsWith(t: string): boolean {
    return this.s.startsWith(t, this.i);
  }
}

function readLabelUntil(sc: Scanner, closes: string[]): { text: string; close: string } | null {
  const s = sc.s;
  let j = sc.i;
  while (j < s.length && s[j] === " ") j++;
  if (s[j] === '"') {
    const endQ = s.indexOf('"', j + 1);
    if (endQ < 0) return null;
    let k = endQ + 1;
    while (k < s.length && s[k] === " ") k++;
    for (const c of closes)
      if (s.startsWith(c, k)) {
        sc.i = k + c.length;
        return { text: s.slice(j, endQ + 1), close: c };
      }
    return null;
  }
  let best: { at: number; close: string } | null = null;
  for (const c of closes) {
    const at = s.indexOf(c, sc.i);
    if (at >= 0 && (best === null || at < best.at)) best = { at, close: c };
  }
  if (!best) return null;
  const text = s.slice(sc.i, best.at);
  sc.i = best.at + best.close.length;
  return { text, close: best.close };
}

function readNode(sc: Scanner): NodeRef | null {
  const m = sc.match(ID_RE);
  if (!m) return null;
  const ref: NodeRef = { id: m[0] };
  if (sc.startsWith("@{")) {
    const end = sc.s.indexOf("}", sc.i);
    if (end < 0) return null;
    const body = sc.s.slice(sc.i + 2, end);
    sc.i = end + 1;
    const label = /label\s*:\s*("([^"]*)"|[^,}]+)/.exec(body);
    const shape = /shape\s*:\s*([A-Za-z-]+)/.exec(body);
    if (label) ref.label = unquote(label[2] ?? label[1]!);
    ref.shape = shape ? `@${shape[1]!.toLowerCase()}` : "rect";
  } else {
    for (const sh of SHAPES) {
      if (!sc.startsWith(sh.open)) continue;
      const save = sc.i;
      sc.i += sh.open.length;
      const r = readLabelUntil(
        sc,
        sh.closes.map((c) => c[0]),
      );
      if (!r) {
        sc.i = save;
        continue;
      }
      ref.label = unquote(r.text);
      ref.shape = sh.closes.find((c) => c[0] === r.close)![1];
      break;
    }
  }
  sc.match(/:::[\w-]+/y);
  return ref;
}

function readGroup(sc: Scanner): NodeRef[] | null {
  const out: NodeRef[] = [];
  for (;;) {
    sc.ws();
    const n = readNode(sc);
    if (!n) return out.length ? out : null;
    out.push(n);
    const save = sc.i;
    sc.ws();
    if (sc.startsWith("&")) {
      sc.i++;
      continue;
    }
    sc.i = save;
    return out;
  }
}

function readLink(sc: Scanner): Link | null {
  sc.ws();
  sc.match(/[\p{L}\p{N}_]+@(?=[<ox]?[-=.~])/uy); // edge id (ignored: canonical ids are assigned)
  // text form: `-- text -->`, `== text ==>`, `-. text .->`
  const tf = sc.match(/([<ox])?(--|==|-\.)(?=\s)/y);
  if (tf) {
    const body = tf[2]!;
    const closer =
      body === "--" ? /-{2,}([>ox]?)/g : body === "==" ? /={2,}([>ox]?)/g : /\.+-([>ox]?)/g;
    closer.lastIndex = sc.i;
    const c = closer.exec(sc.s);
    if (!c) return null;
    const label = unquote(sc.s.slice(sc.i, c.index));
    sc.i = closer.lastIndex;
    return {
      ...(tf[1] ? { start: tf[1] } : {}),
      ...(c[1] ? { end: c[1] } : {}),
      body,
      ...(label ? { label } : {}),
    };
  }
  const m = sc.match(/([<ox])?(-{2,}|={2,}|-\.+-|~{3,})([>ox])?/y);
  if (!m) return null;
  // `o`/`x` right after a link body is an end marker only if not the start of a node id
  let end = m[3];
  if ((end === "o" || end === "x") && /[\p{L}\p{N}_]/u.test(sc.s[sc.i] ?? "")) {
    sc.i--;
    end = undefined;
  }
  const link: Link = { body: m[2]!, ...(m[1] ? { start: m[1] } : {}), ...(end ? { end } : {}) };
  const save = sc.i;
  sc.ws();
  if (sc.startsWith("|")) {
    let from = sc.i + 1;
    while (sc.s[from] === " ") from++;
    // a quoted label may itself contain `|`
    if (sc.s[from] === '"') {
      const q = sc.s.indexOf('"', from + 1);
      if (q > 0) from = q + 1;
    }
    const close = sc.s.indexOf("|", from);
    if (close < 0) return null;
    const label = unquote(sc.s.slice(sc.i + 1, close));
    if (label) link.label = label;
    sc.i = close + 1;
  } else sc.i = save;
  return link;
}

export interface FlowchartOutput {
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  groups: CanonicalGroup[];
}

export function parseFlowchart(
  statements: Statement[],
  issues: Issues,
): FlowchartOutput | undefined {
  const header = /^(?:flowchart|graph|flowchart-elk)\b\s*(TB|TD|BT|LR|RL)?\s*$/i.exec(
    statements[0]?.text ?? "",
  );
  if (!header) {
    issues.error("mermaid.not_flowchart", "expected a `flowchart` or `graph` header");
    return undefined;
  }
  const dir = (header[1] ?? "TB").toUpperCase();
  const rankdir: RankDir = dir === "TD" ? "TB" : (dir as RankDir);

  interface N {
    id: string;
    label?: string;
    shape?: string;
    group?: string;
    line: number;
  }
  const nodes = new Map<string, N>();
  const subgraphs: { id: string; label: string; parent?: string; line: number }[] = [];
  const stack: string[] = [];
  const rawEdges: { from: string; to: string; link: Link; line: number }[] = [];
  const subgraphIds = new Set<string>();

  const touch = (ref: NodeRef, line: number): void => {
    const cur = nodes.get(ref.id);
    const group = stack[stack.length - 1];
    if (!cur)
      nodes.set(ref.id, {
        id: ref.id,
        ...(ref.label !== undefined ? { label: ref.label } : {}),
        ...(ref.shape !== undefined ? { shape: ref.shape } : {}),
        ...(group !== undefined ? { group } : {}),
        line,
      });
    else {
      if (ref.shape !== undefined) {
        if (ref.label !== undefined) cur.label = ref.label;
        cur.shape = ref.shape;
      }
      // Mermaid semantics: a node first used outside any subgraph joins the first subgraph that
      // later lists it (the usual "edges first, membership later" style).
      if (cur.group === undefined && group !== undefined) cur.group = group;
    }
  };

  for (const st of statements.slice(1)) {
    const t = st.text;
    const where = `line ${st.line}`;
    const sub = /^subgraph(?:\s+(.*))?$/i.exec(t);
    if (sub) {
      const rest = (sub[1] ?? "").trim();
      let id: string;
      let label: string;
      const a = /^([\p{L}\p{N}_-]+)\s*\[(.*)\]\s*$/u.exec(rest);
      if (a) {
        id = a[1]!;
        label = unquote(a[2]!);
      } else if (/^"(.*)"$/.test(rest)) {
        label = unquote(rest);
        id = slug(label);
      } else if (/^[\p{L}\p{N}_-]+$/u.test(rest)) {
        id = rest;
        label = rest;
      } else {
        label = unquote(rest) || "Subgraph";
        id = slug(label);
      }
      let unique = id;
      for (let k = 2; subgraphIds.has(unique); k++) unique = `${id}_${k}`;
      subgraphIds.add(unique);
      const parent = stack[stack.length - 1];
      subgraphs.push({
        id: unique,
        label,
        ...(parent !== undefined ? { parent } : {}),
        line: st.line,
      });
      stack.push(unique);
      continue;
    }
    if (/^end$/i.test(t)) {
      if (stack.length === 0)
        issues.warn("mermaid.unbalanced_end", "`end` without an open subgraph", where);
      stack.pop();
      continue;
    }
    if (/^direction\s+(TB|TD|BT|LR|RL)$/i.test(t)) {
      issues.warnOnce(
        "mermaid.subgraph_direction_ignored",
        "per-subgraph `direction` is ignored by the layout",
        where,
      );
      continue;
    }
    if (
      ignorable(
        st,
        issues,
        /^(classDef|class|style|linkStyle|click|accTitle|accDescr)\b/,
        "visual/interaction only and were ignored",
      )
    )
      continue;

    const sc = new Scanner(t);
    const first = readGroup(sc);
    if (!first) {
      issues.warn("mermaid.unrecognised_statement", `could not read: "${t.slice(0, 80)}"`, where);
      continue;
    }
    const chain: { groups: NodeRef[][]; links: Link[] } = { groups: [first], links: [] };
    let ok = true;
    for (;;) {
      sc.ws();
      if (sc.done()) break;
      const link = readLink(sc);
      const next = link ? readGroup(sc) : null;
      if (!link || !next) {
        ok = false;
        break;
      }
      chain.links.push(link);
      chain.groups.push(next);
    }
    if (!ok) {
      issues.warn("mermaid.unrecognised_statement", `could not read: "${t.slice(0, 80)}"`, where);
      continue;
    }
    for (const g of chain.groups) for (const ref of g) touch(ref, st.line);
    chain.links.forEach((link, k) => {
      for (const a of chain.groups[k]!)
        for (const b of chain.groups[k + 1]!)
          rawEdges.push({ from: a.id, to: b.id, link, line: st.line });
    });
  }
  if (stack.length > 0)
    issues.warn("mermaid.unclosed_subgraph", `${stack.length} subgraph(s) not closed with \`end\``);

  // Subgraph ids referenced like nodes are containers, not components.
  for (const id of subgraphIds) {
    const n = nodes.get(id);
    if (n && n.shape === undefined) nodes.delete(id);
    else if (n)
      issues.warn(
        "mermaid.id_conflict",
        `"${id}" is both a node and a subgraph; treated as a node`,
      );
  }

  const nodeIds = new IdMapper("node");
  const groupIds = new IdMapper("group");
  const groups: CanonicalGroup[] = subgraphs.map((s) => ({
    id: groupIds.assign(s.id),
    label: fitLabel(s.label, issues, `line ${s.line}`),
  }));
  subgraphs.forEach((s, i) => {
    if (s.parent !== undefined) groups[i]!.parentId = groupIds.get(s.parent)!;
  });
  const nodeList = [...nodes.values()];
  const canonicalNodes: CanonicalNode[] = nodeList.map((n) => ({
    id: nodeIds.assign(n.id),
    label: fitLabel(n.label ?? n.id, issues, `line ${n.line}`),
    kind: kindFromShape(n.shape),
    x: 0,
    y: 0,
    w: 120,
    h: 60,
    ...(n.group !== undefined ? { groupId: groupIds.get(n.group)! } : {}),
  }));

  const edgeIds = new IdMapper("edge");
  const edges: CanonicalEdge[] = [];
  rawEdges.forEach((e, i) => {
    const where = `line ${e.line}`;
    if (e.link.body.startsWith("~")) {
      issues.warnOnce(
        "mermaid.invisible_link",
        "invisible links (`~~~`) only affect layout; not imported",
        where,
      );
      return;
    }
    const from = nodeIds.get(e.from);
    const to = nodeIds.get(e.to);
    if (from === undefined || to === undefined) {
      issues.warn(
        "mermaid.edge_to_group",
        `link to subgraph "${from === undefined ? e.from : e.to}" dropped: containers cannot carry traffic in the canonical model`,
        where,
      );
      return;
    }
    if (from === to) {
      issues.warn("mermaid.self_loop", "self-loop links are not supported; dropped", where);
      return;
    }
    const { start, end, body } = e.link;
    if (body.startsWith("="))
      issues.warnOnce("mermaid.thick_link", "thick links (`==>`) are imported as solid", where);
    if (start === "x" || end === "x")
      issues.warnOnce(
        "mermaid.cross_arrow",
        "cross arrowheads (`--x`) are imported as triangles",
        where,
      );
    const head = end ?? start;
    edges.push({
      id: edgeIds.assign(`e${i + 1}`),
      from,
      to,
      ...(e.link.label !== undefined ? { label: fitLabel(e.link.label, issues, where) } : {}),
      direction: start && end ? "both" : end ? "forward" : start ? "backward" : "none",
      arrowHead: head === "o" ? "circle" : head ? "triangle" : "none",
      stroke: body.includes(".") ? "dashed" : "solid",
      routing: "curved",
    });
  });

  // connector semantics: dotted links are asynchronous; health checks are monitoring
  const nodeLabel = new Map(canonicalNodes.map((n) => [n.id, n.label]));
  const inferred: string[] = [];
  for (const e of edges) {
    if (looksLikeMonitoring(e.label, { label: nodeLabel.get(e.from) ?? "" })) {
      e.interaction = "monitoring";
      inferred.push(`${nodeLabel.get(e.from)} -> ${nodeLabel.get(e.to)}`);
    } else e.interaction = e.stroke === "solid" ? "sync_request" : "async_message";
  }
  if (inferred.length)
    issues.warn(
      "mermaid.monitoring_inferred",
      `treated as health checks (monitoring, not request routing): ${inferred.slice(0, 5).join("; ")}${inferred.length > 5 ? "; …" : ""}`,
    );

  // layout
  const placed = layoutGraph(
    canonicalNodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      ...(n.groupId ? { group: n.groupId } : {}),
    })),
    groups.map((g) => ({
      id: g.id,
      label: g.label,
      ...(g.parentId ? { parent: g.parentId } : {}),
    })),
    edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      ...(e.interaction ? { interaction: e.interaction } : {}),
      arrowStart: e.direction === "backward" || e.direction === "both",
      arrowEnd: e.direction === "forward" || e.direction === "both",
    })),
    rankdir,
  );
  for (const n of canonicalNodes) Object.assign(n, placed.nodes.get(n.id)!);
  applyRoutes(edges, placed.edges);
  for (const g of groups) g.frame = placed.groups.get(g.id)!;
  const rewritten = nodeIds.rewritten + groupIds.rewritten;
  if (rewritten > 0)
    issues.warn(
      "import.ids_rewritten",
      `${rewritten} source id(s) were rewritten to valid canonical ids`,
    );
  return { nodes: canonicalNodes, edges, groups };
}

function kindFromShape(shape: string | undefined): CanonicalNode["kind"] {
  switch (shape) {
    case "cylinder":
    case "@cyl":
    case "@database":
    case "@db":
    case "@lin-cyl":
    case "@h-cyl":
      return "db";
    case "rhombus":
    case "@diam":
    case "@decision":
    case "@diamond":
    case "@question":
      return "decision";
    case "@doc":
    case "@document":
    case "@docs":
      return "document";
    case "@cloud":
      return "cloud";
    default:
      return "service";
  }
}
