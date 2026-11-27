import type { CorpusEntry, Direction, Format, Routing, Stroke } from "./corpus.ts";
import { truthFor } from "./corpus.ts";

/** Importer-neutral view of what an importer produced. Matching is by (unique) label. */
export interface ImportedNode {
  label: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Label of the direct enclosing group, if the importer kept it. */
  group?: string;
}
export interface ImportedEdge {
  from: string;
  to: string;
  label?: string;
  direction: Direction;
  stroke?: Stroke;
  routing?: Routing;
}
export interface ImportedGroup {
  label: string;
  parent?: string;
}
/** Ordered interaction (sequence diagrams): who sends what to whom, and whether it is a reply. */
export interface ImportedMessage {
  from: string;
  to: string;
  label?: string;
  reply: boolean;
}
export interface Imported {
  nodes: ImportedNode[];
  edges: ImportedEdge[];
  groups: ImportedGroup[];
  /** Present when the importer turns sequence messages into ordered steps. */
  messages?: ImportedMessage[];
  warnings: string[];
}
export type ImportOutcome = { ok: true; imported: Imported } | { ok: false; error: string };

export const CHECKS = [
  "nodes",
  "node-position",
  "node-size",
  "edges",
  "edge-direction",
  "edge-dashed",
  "edge-routing",
  "groups",
  "group-nesting",
  "group-membership",
  "sequence-messages",
  "sequence-replies",
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface Check {
  name: CheckName;
  /** false = the format cannot express this feature; not counted for or against the importer. */
  applicable: boolean;
  expected: number;
  matched: number;
  details: string[];
}
export interface DiagramScore {
  id: string;
  format: Format;
  outcome: "imported" | "rejected";
  error?: string;
  /** Imported with every applicable check at 100 %. */
  pass: boolean;
  checks: Check[];
  extraNodes: string[];
  extraEdges: string[];
  warnings: string[];
}

export const POSITION_TOLERANCE_PX = 1;

const edgeKeyUnordered = (a: string, b: string, label: string | undefined): string =>
  `${[a, b].sort().join("\u0000")}\u0001${label ?? ""}`;

/** Direction as "who sends to whom": backward edges are the reverse forward edge. */
function directed(from: string, to: string, d: Direction): string {
  if (d === "none") return `none:${[from, to].sort().join(">")}`;
  if (d === "both") return `both:${[from, to].sort().join(">")}`;
  return d === "forward" ? `fwd:${from}>${to}` : `fwd:${to}>${from}`;
}

export function scoreImport(
  entry: CorpusEntry,
  format: Format,
  outcome: ImportOutcome,
): DiagramScore {
  const truth = truthFor(entry, format);
  const geometry = format === "drawio";
  /** Every format can express groups (draw.io containers, Mermaid subgraphs, sequence boxes). */
  const groupsExpressible = true;
  const mk = (name: CheckName, applicable: boolean, expected: number): Check => ({
    name,
    applicable,
    expected: applicable ? expected : 0,
    matched: 0,
    details: [],
  });
  const checks = new Map<CheckName, Check>();
  const isSeq = format === "mermaid-sequence" || format === "plantuml-sequence";
  /** Sequence diagrams: connectors are the distinct participant pairs; messages are checked separately. */
  const edgesT = isSeq ? uniquePairs(truth.edges) : truth.edges;
  const dashedTruth = isSeq ? [] : edgesT.filter((e) => e.stroke === "dashed");
  const routedTruth = edgesT.filter((e) => e.routing !== "straight");
  const nestedTruth = truth.groups.filter((g) => g.parent !== undefined);
  const memberTruth = truth.nodes.filter((n) => n.group !== undefined);
  checks.set("nodes", mk("nodes", true, truth.nodes.length));
  checks.set("node-position", mk("node-position", geometry, truth.nodes.length));
  checks.set("node-size", mk("node-size", geometry, truth.nodes.length));
  checks.set("edges", mk("edges", true, edgesT.length));
  checks.set("edge-direction", mk("edge-direction", true, edgesT.length));
  checks.set("sequence-messages", mk("sequence-messages", isSeq, truth.edges.length));
  checks.set(
    "sequence-replies",
    mk("sequence-replies", isSeq, truth.edges.filter((e) => e.stroke === "dashed").length),
  );
  checks.set("edge-dashed", mk("edge-dashed", dashedTruth.length > 0, dashedTruth.length));
  checks.set(
    "edge-routing",
    mk("edge-routing", geometry && routedTruth.length > 0, routedTruth.length),
  );
  checks.set(
    "groups",
    mk("groups", groupsExpressible && truth.groups.length > 0, truth.groups.length),
  );
  checks.set(
    "group-nesting",
    mk("group-nesting", groupsExpressible && nestedTruth.length > 0, nestedTruth.length),
  );
  checks.set(
    "group-membership",
    mk("group-membership", groupsExpressible && memberTruth.length > 0, memberTruth.length),
  );
  const list = [...checks.values()];

  if (!outcome.ok) {
    return {
      id: entry.id,
      format,
      outcome: "rejected",
      error: outcome.error,
      pass: false,
      checks: list,
      extraNodes: [],
      extraEdges: [],
      warnings: [],
    };
  }
  const imp = outcome.imported;
  const labelOf = new Map(truth.nodes.map((n) => [n.key, n.label]));
  const groupLabel = new Map(truth.groups.map((g) => [g.key, g.label]));
  const lbl = (k: string): string => labelOf.get(k) ?? k;

  // nodes
  const impNodes = new Map(imp.nodes.map((n) => [n.label, n]));
  const matchedNodes = new Set<string>();
  for (const t of truth.nodes) {
    const got = impNodes.get(t.label);
    if (!got) {
      checks.get("nodes")!.details.push(`missing node "${t.label}"`);
      continue;
    }
    matchedNodes.add(t.label);
    checks.get("nodes")!.matched++;
    if (geometry) {
      const pos = checks.get("node-position")!;
      if (got.x === undefined || got.y === undefined)
        pos.details.push(`"${t.label}": position not provided`);
      else if (
        Math.abs(got.x - t.x) <= POSITION_TOLERANCE_PX &&
        Math.abs(got.y - t.y) <= POSITION_TOLERANCE_PX
      )
        pos.matched++;
      else
        pos.details.push(
          `"${t.label}": expected (${t.x},${t.y}) got (${round(got.x)},${round(got.y)})`,
        );
      const size = checks.get("node-size")!;
      if (got.w === undefined || got.h === undefined)
        size.details.push(`"${t.label}": size not provided`);
      else if (
        Math.abs(got.w - t.w) <= POSITION_TOLERANCE_PX &&
        Math.abs(got.h - t.h) <= POSITION_TOLERANCE_PX
      )
        size.matched++;
      else
        size.details.push(
          `"${t.label}": expected ${t.w}x${t.h} got ${round(got.w)}x${round(got.h)}`,
        );
    }
  }
  const extraNodes = imp.nodes.filter((n) => !matchedNodes.has(n.label)).map((n) => n.label);

  // edges (multiset matching on unordered endpoints + label, then direction compared)
  const pool = new Map<string, ImportedEdge[]>();
  for (const e of imp.edges) {
    const k = edgeKeyUnordered(e.from, e.to, e.label);
    pool.set(k, [...(pool.get(k) ?? []), e]);
  }
  for (const t of edgesT) {
    const from = lbl(t.from);
    const to = lbl(t.to);
    const k = edgeKeyUnordered(from, to, t.label);
    const candidates = pool.get(k);
    const desc = `${from} -> ${to}${t.label !== undefined ? ` "${t.label}"` : ""}`;
    // prefer the candidate whose direction matches
    const want = directed(from, to, t.direction);
    const idx = candidates?.findIndex((c) => directed(c.from, c.to, c.direction) === want) ?? -1;
    const pick = candidates && (idx >= 0 ? idx : candidates.length > 0 ? 0 : -1);
    if (!candidates || pick === undefined || pick < 0) {
      checks.get("edges")!.details.push(`missing edge ${desc}`);
      continue;
    }
    const got = candidates.splice(pick, 1)[0]!;
    checks.get("edges")!.matched++;
    const dir = checks.get("edge-direction")!;
    if (directed(got.from, got.to, got.direction) === want) dir.matched++;
    else
      dir.details.push(
        `${desc}: expected ${t.direction}, importer says ${got.direction} (${got.from} -> ${got.to})`,
      );
    if (t.stroke === "dashed") {
      const c = checks.get("edge-dashed")!;
      if (got.stroke === "dashed") c.matched++;
      else c.details.push(`${desc}: dashed style lost (${got.stroke ?? "not provided"})`);
    }
    if (geometry && t.routing !== "straight") {
      const c = checks.get("edge-routing")!;
      if (got.routing === t.routing) c.matched++;
      else
        c.details.push(
          `${desc}: expected ${t.routing} routing, got ${got.routing ?? "not provided"}`,
        );
    }
  }
  const extraEdges = [...pool.values()]
    .flat()
    .map((e) => `${e.from} -> ${e.to}${e.label !== undefined ? ` "${e.label}"` : ""}`);

  // sequence messages: same order, endpoints, label; replies flagged
  if (isSeq) {
    const msgs = imp.messages ?? [];
    const sm = checks.get("sequence-messages")!;
    const sr = checks.get("sequence-replies")!;
    truth.edges.forEach((t, i) => {
      const got = msgs[i];
      const want = `${lbl(t.from)} -> ${lbl(t.to)} "${t.label ?? ""}"`;
      if (
        got &&
        got.from === lbl(t.from) &&
        got.to === lbl(t.to) &&
        (got.label ?? "") === (t.label ?? "")
      )
        sm.matched++;
      else
        sm.details.push(
          `message #${i + 1}: expected ${want}, got ${got ? `${got.from} -> ${got.to} "${got.label ?? ""}"` : "nothing"}`,
        );
      if (t.stroke === "dashed") {
        if (got?.reply) sr.matched++;
        else sr.details.push(`message #${i + 1} ${want}: reply not recognised`);
      }
    });
    if (msgs.length > truth.edges.length)
      sm.details.push(`${msgs.length - truth.edges.length} extra message(s)`);
  }

  // groups
  if (groupsExpressible) {
    const impGroups = new Map(imp.groups.map((g) => [g.label, g]));
    for (const g of truth.groups) {
      const got = impGroups.get(g.label);
      if (!got) checks.get("groups")!.details.push(`missing group "${g.label}"`);
      else checks.get("groups")!.matched++;
      if (g.parent !== undefined) {
        const want = groupLabel.get(g.parent);
        const c = checks.get("group-nesting")!;
        if (got?.parent === want) c.matched++;
        else
          c.details.push(
            `group "${g.label}": expected parent "${want}", got ${got?.parent ?? "none"}`,
          );
      }
    }
    for (const n of memberTruth) {
      const want = groupLabel.get(n.group!);
      const c = checks.get("group-membership")!;
      if (impNodes.get(n.label)?.group === want) c.matched++;
      else
        c.details.push(
          `node "${n.label}": expected group "${want}", got ${impNodes.get(n.label)?.group ?? "none"}`,
        );
    }
  }

  const pass =
    extraNodes.length === 0 &&
    extraEdges.length === 0 &&
    list.every((c) => !c.applicable || c.matched === c.expected);
  return {
    id: entry.id,
    format,
    outcome: "imported",
    pass,
    checks: list,
    extraNodes,
    extraEdges,
    warnings: imp.warnings,
  };
}

/** Distinct unordered participant pairs of a sequence diagram, unlabeled, forward from the first message. */
function uniquePairs(edges: CorpusEntry["edges"]): CorpusEntry["edges"] {
  const seen = new Set<string>();
  const out: CorpusEntry["edges"] = [];
  for (const e of edges) {
    const k = [e.from, e.to].sort().join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    const { label: _label, ...rest } = e;
    void _label;
    out.push({ ...rest, stroke: "solid", direction: "forward" });
  }
  return out;
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** An importer that returns the ground truth exactly (used to test the scorer itself). */
export function perfectImport(entry: CorpusEntry, format: Format): Imported {
  const truth = truthFor(entry, format);
  const labelOf = new Map(truth.nodes.map((n) => [n.key, n.label]));
  const groupLabel = new Map(truth.groups.map((g) => [g.key, g.label]));
  return {
    nodes: truth.nodes.map((n) => ({
      label: n.label,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      ...(n.group ? { group: groupLabel.get(n.group)! } : {}),
    })),
    ...(format === "mermaid-sequence" || format === "plantuml-sequence"
      ? {
          messages: truth.edges.map((e) => ({
            from: labelOf.get(e.from)!,
            to: labelOf.get(e.to)!,
            ...(e.label !== undefined ? { label: e.label } : {}),
            reply: e.stroke === "dashed",
          })),
        }
      : {}),
    edges: (format === "mermaid-sequence" || format === "plantuml-sequence"
      ? uniquePairs(truth.edges)
      : truth.edges
    ).map((e) => ({
      from: labelOf.get(e.from)!,
      to: labelOf.get(e.to)!,
      ...(e.label !== undefined && format !== "mermaid-sequence" && format !== "plantuml-sequence"
        ? { label: e.label }
        : {}),
      direction: e.direction,
      stroke: format === "mermaid-sequence" || format === "plantuml-sequence" ? "solid" : e.stroke,
      routing: e.routing,
    })),
    groups: truth.groups.map((g) => ({
      label: g.label,
      ...(g.parent ? { parent: groupLabel.get(g.parent)! } : {}),
    })),
    warnings: [],
  };
}

export interface Summary {
  diagrams: number;
  imported: number;
  rejected: number;
  passed: number;
  checks: Record<string, { expected: number; matched: number }>;
}

export function summarize(scores: DiagramScore[]): Summary {
  const checks: Summary["checks"] = {};
  for (const s of scores)
    for (const c of s.checks) {
      if (!c.applicable) continue;
      const cur = (checks[c.name] ??= { expected: 0, matched: 0 });
      cur.expected += c.expected;
      cur.matched += c.matched;
    }
  return {
    diagrams: scores.length,
    imported: scores.filter((s) => s.outcome === "imported").length,
    rejected: scores.filter((s) => s.outcome === "rejected").length,
    passed: scores.filter((s) => s.pass).length,
    checks,
  };
}
