import { Graph, layout } from "@dagrejs/dagre";
import {
  LIMITS,
  enginePath,
  type CanonicalEdge,
  estimateTextWidth,
  pointAlong,
  titleWidth,
  type Point,
} from "@archflow/canonical-model";

/**
 * Deterministic layered layout with orthogonal connector routing, for sources without geometry
 * (text descriptions, Mermaid flowcharts, PlantUML).
 *
 * 1. Request traffic is laid out with dagre (MIT): rank assignment, ordering within ranks and the
 *    cross-axis coordinates. Monitoring connectors and monitor-only components are excluded, so
 *    health checks cannot distort the request flow.
 * 2. Ranks are re-spaced so every gap fits its vertical connector tracks plus the widest label
 *    that may sit in it.
 * 3. Every connector is routed orthogonally: each one leaves/enters through its own port (spread
 *    along the node side, sorted to avoid crossings) and runs its vertical leg on its own track.
 * 4. Monitor-only components go to a separate band below the request flow; their connectors run
 *    in lanes there and climb to their targets' far side, away from request traffic.
 * 5. Labels are placed on their own connector at the first candidate position that touches no
 *    node and no other label; if a label cannot be placed, spacing grows and the layout repeats.
 *
 * Everything is computed from estimated text widths and integer-rounded coordinates, so the same
 * input gives the same output in Node and in every browser.
 */

export type RankDir = "TB" | "BT" | "LR" | "RL";

export interface LayoutNode {
  id: string;
  label: string;
  /** Canonical node kind: decides the engine shape and therefore how much room the title needs. */
  kind?: string;
  group?: string;
}
export interface LayoutGroup {
  id: string;
  label: string;
  parent?: string;
}
export interface LayoutEdge {
  /** Result key; defaults to the edge's index as a string. */
  id?: string;
  from: string;
  to: string;
  label?: string;
  /** Canonical connector semantics; `monitoring` edges are routed in the monitoring band. */
  interaction?: string;
  /** Arrowheads (default: end only), needed to place labels exactly where the engine draws them. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type { Point };
export interface EdgeRoute {
  /** Orthogonal polyline between the two ports (ports are implied by the first/last point). */
  waypoints: Point[];
  /** Label anchor as the engine reads it: fraction of path length and perpendicular offset. */
  labelPos?: number;
  labelOffset?: number;
  /** Label box chosen by the placer (diagram pixels), for tests and diagnostics. */
  labelBox?: Rect;
}
export interface LayoutResult {
  nodes: Map<string, Rect>;
  groups: Map<string, Rect>;
  edges: Map<string, EdgeRoute>;
  /** Ids of components placed in the monitoring band. */
  monitorNodes: Set<string>;
  /** Labels that could not be placed without touching a node or another label. */
  labelConflicts: number;
}

export const NODE_H = 60;
/** Engine default edge label size (px); labels are laid out for exactly this size. */
export const EDGE_LABEL_PX = 12;
const LABEL_H = 18;
/** Gap between a connector and its label: keeps the label clear of packets riding the line. */
const LABEL_CLEAR = 8;
/** Half the height of a packet riding a connector (engine capsule, size 1). */
const PACKET_HALF = 7;
const GROUP_TITLE_BAND = 28;
const GROUP_PAD = 16;
const MARGIN = 20;
const TRACK = 14;
const PAD = 16;
const MIN_GAP = 56;
const BAND_GAP = 44;
/** Shapes whose sides are not straight vertical lines: connectors use the side's midpoint. */
const CENTER_PORT_KINDS = new Set(["user", "cloud", "decision", "balancer", "cache", "queue"]);

/** Width that fits the bold title the engine draws (inverse of titleRoom). */
export function nodeWidth(label: string, kind?: string): number {
  const t = titleWidth(label);
  let w: number;
  if (kind === "user") w = t / 0.8 + 28;
  else if (kind === "decision") w = t * 1.7 + 28;
  else if (kind === "cloud") w = t * 1.3 + 44;
  else w = t + 56;
  return Math.round(Math.min(360, Math.max(120, Math.ceil(w))));
}

/** Width of an edge label drawn by the engine (regular 12 px) plus its halo and a safety margin. */
export function edgeLabelWidth(text: string): number {
  return Math.ceil(estimateTextWidth(text) * (EDGE_LABEL_PX / 14) * 1.2) + 8;
}

export function layoutGraph(
  nodes: LayoutNode[],
  groups: LayoutGroup[],
  edges: LayoutEdge[],
  rankdir: RankDir,
): LayoutResult {
  let best: LayoutResult | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = attemptLayout(nodes, groups, edges, rankdir, attempt);
    if (!best || r.labelConflicts < best.labelConflicts) best = r;
    if (r.labelConflicts === 0) break;
  }
  return best!;
}

// ---------------------------------------------------------------------------------------------
// One layout attempt. Routing works in "LR space" (ranks along +x); other directions are mapped.
// ---------------------------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Vertical {
  key: string;
  kind: "fwd" | "same" | "mon";
  yIn: number;
  yOut: number;
  x: number;
}

function attemptLayout(
  nodes: LayoutNode[],
  groups: LayoutGroup[],
  edges: LayoutEdge[],
  rankdir: RankDir,
  attempt: number,
): LayoutResult {
  const vertical = rankdir === "TB" || rankdir === "BT";
  const keyOf = (e: LayoutEdge, i: number): string => e.id ?? String(i);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const isMon = (e: LayoutEdge): boolean => e.interaction === "monitoring";

  // monitor-only components: every connector touching them is a monitoring connector they start
  const touching = new Map<string, LayoutEdge[]>();
  for (const e of edges)
    for (const id of new Set([e.from, e.to])) touching.set(id, [...(touching.get(id) ?? []), e]);
  const monitorNodes = new Set<string>();
  for (const n of nodes) {
    const es = touching.get(n.id) ?? [];
    if (n.group === undefined && es.length > 0 && es.every((e) => isMon(e) && e.from === n.id))
      monitorNodes.add(n.id);
  }

  const reqNodes = nodes.filter((n) => !monitorNodes.has(n.id));
  const reqEdges = edges
    .map((e, i) => ({ e, key: keyOf(e, i), i }))
    .filter(({ e }) => !isMon(e) && !monitorNodes.has(e.from) && !monitorNodes.has(e.to));
  const monEdges = edges
    .map((e, i) => ({ e, key: keyOf(e, i), i }))
    .filter(({ e }) => isMon(e) && nodeById.has(e.from) && nodeById.has(e.to) && e.from !== e.to);

  // screen size of every node, then its LR-space size (w along the rank axis)
  const screen = new Map<string, { w: number; h: number }>();
  for (const n of nodes) screen.set(n.id, { w: nodeWidth(n.label, n.kind), h: NODE_H });
  if (!vertical) {
    // grow nodes that need many ports on one side (LR: ports are spread along the height)
    const outs = new Map<string, number>();
    const ins = new Map<string, number>();
    for (const { e } of reqEdges) {
      outs.set(e.from, (outs.get(e.from) ?? 0) + 1);
      ins.set(e.to, (ins.get(e.to) ?? 0) + 1);
    }
    for (const n of reqNodes) {
      if (CENTER_PORT_KINDS.has(n.kind ?? "")) continue;
      const k = Math.max(outs.get(n.id) ?? 0, ins.get(n.id) ?? 0);
      const s = screen.get(n.id)!;
      s.h = Math.max(NODE_H, 18 * k + 18);
    }
  }
  const lrSize = (id: string): { w: number; h: number } => {
    const s = screen.get(id)!;
    return vertical ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
  };

  // --- 1. dagre on the request graph ----------------------------------------------------------
  const g = new Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: (vertical ? 60 : 36) + attempt * 24,
    ranksep: 80,
    edgesep: 24,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const gr of groups) g.setNode(`g:${gr.id}`, { label: gr.label, width: 1, height: 1 });
  for (const gr of groups) if (gr.parent !== undefined) g.setParent(`g:${gr.id}`, `g:${gr.parent}`);
  for (const n of reqNodes) {
    const s = lrSize(n.id);
    g.setNode(`n:${n.id}`, { label: n.label, width: s.w, height: s.h });
    if (n.group !== undefined) g.setParent(`n:${n.id}`, `g:${n.group}`);
  }
  for (const { e, key } of reqEdges) {
    if (e.from === e.to) continue;
    g.setEdge(`n:${e.from}`, `n:${e.to}`, {}, key);
  }
  layout(g);

  const dg = new Map<string, { x: number; y: number }>();
  for (const n of reqNodes) {
    const l = g.node(`n:${n.id}`) as { x: number; y: number };
    dg.set(n.id, { x: l.x, y: l.y });
  }

  // --- 2. ranks and their x positions -----------------------------------------------------------
  const centers = [...new Set(reqNodes.map((n) => Math.round(dg.get(n.id)!.x)))].sort(
    (a, b) => a - b,
  );
  const rankOf = new Map<string, number>();
  for (const n of reqNodes) rankOf.set(n.id, centers.indexOf(Math.round(dg.get(n.id)!.x)));
  const rankCount = centers.length;
  const rankW = Array.from({ length: rankCount }, () => 0);
  for (const n of reqNodes) {
    const r = rankOf.get(n.id)!;
    rankW[r] = Math.max(rankW[r]!, lrSize(n.id).w);
  }
  const box = new Map<string, Box>(); // LR space
  const cy = (id: string): number => {
    const b = box.get(id)!;
    return b.y + b.h / 2;
  };

  // y of an edge at the centre of every rank it passes (from dagre's dummy nodes)
  const dagrePoints = (from: string, to: string, key: string): Point[] => {
    const ed = g.edge({ v: `n:${from}`, w: `n:${to}`, name: key }) as
      { points?: Point[] } | undefined;
    return ed?.points ?? [];
  };
  const yAtX = (pts: Point[], x: number, fallback: number): number => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (x >= lo && x <= hi && hi > lo) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
    return fallback;
  };

  // label extent along the rank axis decides how wide a gap must be
  const labelExtent = (e: LayoutEdge): number =>
    e.label ? (vertical ? LABEL_H + 6 : edgeLabelWidth(e.label)) : 0;

  // forward orientation of request edges
  interface Fwd {
    key: string;
    e: LayoutEdge;
    a: string; // lower rank end
    b: string; // higher (or same) rank end
    reversed: boolean;
    ra: number;
    rb: number;
    mids: number[]; // y at intermediate ranks
  }
  const fwd: Fwd[] = [];
  for (const { e, key } of reqEdges) {
    if (e.from === e.to) continue;
    const rf = rankOf.get(e.from)!;
    const rt = rankOf.get(e.to)!;
    const reversed = rt < rf;
    const a = reversed ? e.to : e.from;
    const b = reversed ? e.from : e.to;
    fwd.push({ key, e, a, b, reversed, ra: Math.min(rf, rt), rb: Math.max(rf, rt), mids: [] });
  }

  // per-gap content: number of vertical tracks and the widest label that can sit there
  const gapTracks = Array.from({ length: rankCount + 1 }, () => 0);
  const gapLabel = Array.from({ length: rankCount + 1 }, () => 0);
  for (const f of fwd) {
    if (f.ra === f.rb) {
      gapTracks[f.ra]!++;
      continue;
    }
    for (let r = f.ra; r < f.rb; r++) {
      gapTracks[r]!++;
      gapLabel[r] = Math.max(gapLabel[r]!, labelExtent(f.e));
    }
  }
  for (const { e } of monEdges) {
    const r = rankOf.get(e.to);
    if (r !== undefined) gapTracks[r]!++;
  }
  const gapWidth = (r: number): number =>
    Math.max(
      MIN_GAP + attempt * 16,
      PAD + gapTracks[r]! * TRACK + PAD + gapLabel[r]! + PAD + attempt * 16,
    );
  const rankX: number[] = [];
  let xCursor = 0;
  for (let r = 0; r < rankCount; r++) {
    rankX.push(xCursor);
    xCursor += rankW[r]! + gapWidth(r);
  }
  for (const n of reqNodes) {
    const s = lrSize(n.id);
    const r = rankOf.get(n.id)!;
    box.set(n.id, {
      x: rankX[r]! + (rankW[r]! - s.w) / 2,
      y: dg.get(n.id)!.y - s.h / 2,
      w: s.w,
      h: s.h,
    });
  }
  for (const f of fwd) {
    const pts = dagrePoints(f.reversed ? f.b : f.a, f.reversed ? f.a : f.b, f.key);
    for (let r = f.ra + 1; r < f.rb; r++)
      f.mids.push(yAtX(pts, centers[r]!, (cy(f.a) + cy(f.b)) / 2));
  }

  // --- 3. ports ---------------------------------------------------------------------------------
  // side "R" = towards higher ranks, "L" = towards lower ranks (LR space)
  type Side = "R" | "L";
  const portY = new Map<string, number>(); // `${key}|${end}` -> y (LR space)
  const sideLists = new Map<string, { slot: string; other: number; order: number }[]>();
  const addToSide = (
    node: string,
    side: Side,
    slot: string,
    other: number,
    order: number,
  ): void => {
    const k = `${node}|${side}`;
    sideLists.set(k, [...(sideLists.get(k) ?? []), { slot, other, order }]);
  };
  fwd.forEach((f, i) => {
    if (f.ra === f.rb) {
      addToSide(f.a, "R", `${f.key}|a`, cy(f.b), i);
      addToSide(f.b, "R", `${f.key}|b`, cy(f.a), i);
      return;
    }
    addToSide(f.a, "R", `${f.key}|a`, f.mids[0] ?? cy(f.b), i);
    addToSide(f.b, "L", `${f.key}|b`, f.mids[f.mids.length - 1] ?? cy(f.a), i);
  });
  monEdges.forEach(({ e, key }, i) => {
    if (monitorNodes.has(e.to) || !box.has(e.to)) return;
    // monitoring arrives on the far side of its target, below that side's request ports
    addToSide(e.to, "R", `${key}|t`, Number.MAX_SAFE_INTEGER - 1000 + i, 100000 + i);
  });
  for (const [k, list] of sideLists) {
    const node = k.slice(0, k.lastIndexOf("|"));
    const b = box.get(node)!;
    const centerOnly = CENTER_PORT_KINDS.has(nodeById.get(node)?.kind ?? "");
    list.sort((p, q) => p.other - q.other || p.order - q.order);
    list.forEach((p, idx) => {
      const y = centerOnly ? b.y + b.h / 2 : b.y + (b.h * (idx + 1)) / (list.length + 1);
      portY.set(p.slot, Math.round(y));
    });
  }

  // --- 4. vertical tracks per gap ---------------------------------------------------------------
  const verticals = Array.from({ length: rankCount + 1 }, () => [] as Vertical[]);
  for (const f of fwd) {
    const ys = [portY.get(`${f.key}|a`)!, ...f.mids.map(Math.round), portY.get(`${f.key}|b`)!];
    if (f.ra === f.rb) {
      verticals[f.ra]!.push({ key: f.key, kind: "same", yIn: ys[0]!, yOut: ys[1]!, x: 0 });
      continue;
    }
    for (let r = f.ra; r < f.rb; r++) {
      const k = r - f.ra;
      verticals[r]!.push({
        key: `${f.key}#${k}`,
        kind: "fwd",
        yIn: ys[k]!,
        yOut: ys[k + 1]!,
        x: 0,
      });
    }
  }
  const reqBottom = Math.max(0, ...[...box.values()].map((b) => b.y + b.h));
  for (const { e, key } of monEdges) {
    if (monitorNodes.has(e.to) || !box.has(e.to)) continue;
    const r = rankOf.get(e.to)!;
    verticals[r]!.push({
      key: `${key}#mon`,
      kind: "mon",
      yIn: reqBottom + BAND_GAP,
      yOut: portY.get(`${key}|t`)!,
      x: 0,
    });
  }
  const crossings = (a: Vertical, b: Vertical): number => {
    // a is left of b; count crossings of a's outgoing and b's incoming horizontals
    const inSpan = (y: number, v: Vertical): boolean =>
      y > Math.min(v.yIn, v.yOut) && y < Math.max(v.yIn, v.yOut);
    let c = 0;
    if (a.kind === "fwd" && inSpan(a.yOut, b)) c++;
    if (b.kind !== "mon" && inSpan(b.yIn, a)) c++;
    if (b.kind === "mon" && inSpan(b.yOut, a)) c++;
    return c;
  };
  verticals.forEach((list, r) => {
    const mon = list.filter((v) => v.kind === "mon").sort((p, q) => q.yOut - p.yOut);
    const same = list.filter((v) => v.kind === "same");
    const fw = list
      .filter((v) => v.kind === "fwd")
      .sort((p, q) => p.yIn - q.yIn || p.yOut - q.yOut);
    // adjacent swaps while they remove crossings (deterministic, bounded)
    for (let pass = 0; pass < fw.length; pass++) {
      let changed = false;
      for (let i = 0; i + 1 < fw.length; i++) {
        if (crossings(fw[i + 1]!, fw[i]!) < crossings(fw[i]!, fw[i + 1]!)) {
          [fw[i], fw[i + 1]] = [fw[i + 1]!, fw[i]!];
          changed = true;
        }
      }
      if (!changed) break;
    }
    const ordered = [...mon, ...same, ...fw];
    const base = r < rankCount ? rankX[r]! + rankW[r]! : xCursor;
    ordered.forEach((v, i) => (v.x = base + PAD + i * TRACK));
    list.splice(0, list.length, ...ordered);
  });
  const trackX = new Map<string, number>();
  for (const list of verticals) for (const v of list) trackX.set(v.key, v.x);

  // --- 5. routes in LR space --------------------------------------------------------------------
  const routes = new Map<string, Point[]>();
  for (const f of fwd) {
    const ys = [portY.get(`${f.key}|a`)!, ...f.mids.map(Math.round), portY.get(`${f.key}|b`)!];
    const pts: Point[] = [];
    if (f.ra === f.rb) {
      const x = trackX.get(f.key)!;
      pts.push({ x, y: ys[0]! }, { x, y: ys[1]! });
    } else {
      for (let r = f.ra; r < f.rb; r++) {
        const k = r - f.ra;
        const x = trackX.get(`${f.key}#${k}`)!;
        if (ys[k] !== ys[k + 1]) pts.push({ x, y: ys[k]! }, { x, y: ys[k + 1]! });
      }
      if (pts.length === 0) {
        // straight: one waypoint carries the port coordinate
        const ba = box.get(f.a)!;
        const bb = box.get(f.b)!;
        pts.push({ x: Math.round((ba.x + ba.w + bb.x) / 2), y: ys[0]! });
      }
    }
    routes.set(f.key, f.reversed ? pts.reverse() : pts);
  }

  // monitoring band: monitor components below the request flow, lanes above them
  const monRoutes = monEdges.filter(({ e }) => !monitorNodes.has(e.to) && box.has(e.to));
  const laneOrder = [...monRoutes].sort(
    (p, q) => trackX.get(`${p.key}#mon`)! - trackX.get(`${q.key}#mon`)! || p.i - q.i,
  );
  const laneTop = reqBottom + BAND_GAP;
  const laneY = new Map<string, number>();
  // labelled lanes are spaced so their labels fit above them
  let laneCursor = laneTop;
  laneOrder.forEach((m, i) => {
    if (i > 0) laneCursor += m.e.label ? LABEL_H + LABEL_CLEAR + 8 : TRACK;
    laneY.set(m.key, laneCursor);
  });
  const monNodeTop = laneCursor + BAND_GAP;
  let monCursorRight = Number.POSITIVE_INFINITY;
  const monList = nodes.filter((n) => monitorNodes.has(n.id));
  // right-to-left: each monitor sits left of the tracks it feeds
  const monSorted = [...monList].sort((p, q) => {
    const xs = (id: string): number =>
      Math.min(
        Number.POSITIVE_INFINITY,
        ...monRoutes.filter((m) => m.e.from === id).map((m) => trackX.get(`${m.key}#mon`)!),
      );
    return xs(q.id) - xs(p.id);
  });
  for (const n of monSorted) {
    const s = lrSize(n.id);
    const mine = monRoutes.filter((m) => m.e.from === n.id);
    const minTrack = Math.min(xCursor, ...mine.map((m) => trackX.get(`${m.key}#mon`)!));
    const right = Math.min(minTrack - PAD * 2, monCursorRight - PAD * 2);
    const x = Math.max(0, right - s.w);
    box.set(n.id, { x, y: monNodeTop, w: s.w, h: s.h });
    monCursorRight = x;
  }
  for (const n of monList) {
    const b = box.get(n.id)!;
    const mine = monRoutes
      .filter((m) => m.e.from === n.id)
      .sort((p, q) => trackX.get(`${p.key}#mon`)! - trackX.get(`${q.key}#mon`)!);
    const centerOnly = CENTER_PORT_KINDS.has(n.kind ?? "");
    mine.forEach((m, idx) => {
      const px = centerOnly
        ? Math.round(b.x + b.w / 2)
        : Math.round(b.x + (b.w * (idx + 1)) / (mine.length + 1));
      const ly = laneY.get(m.key)!;
      const tx = trackX.get(`${m.key}#mon`)!;
      routes.set(m.key, [
        { x: px, y: ly },
        { x: tx, y: ly },
        { x: tx, y: portY.get(`${m.key}|t`)! },
      ]);
    });
  }
  // monitoring connectors from request-band components: leave downwards into the band
  for (const m of monRoutes) {
    if (monitorNodes.has(m.e.from)) continue;
    const b = box.get(m.e.from)!;
    const ly = laneY.get(m.key)!;
    const tx = trackX.get(`${m.key}#mon`)!;
    const px = Math.round(b.x + b.w / 2);
    routes.set(m.key, [
      { x: px, y: ly },
      { x: tx, y: ly },
      { x: tx, y: portY.get(`${m.key}|t`)! },
    ]);
  }

  // --- 6. map to screen space -------------------------------------------------------------------
  const toScreenPt = (p: Point): Point => {
    if (rankdir === "LR") return { x: p.x, y: p.y };
    if (rankdir === "RL") return { x: -p.x, y: p.y };
    if (rankdir === "TB") return { x: p.y, y: p.x };
    return { x: p.y, y: -p.x }; // BT
  };
  const toScreenBox = (b: Box): Box => {
    const a = toScreenPt({ x: b.x, y: b.y });
    const c = toScreenPt({ x: b.x + b.w, y: b.y + b.h });
    return {
      x: Math.min(a.x, c.x),
      y: Math.min(a.y, c.y),
      w: Math.abs(c.x - a.x),
      h: Math.abs(c.y - a.y),
    };
  };
  const outNodes = new Map<string, Rect>();
  for (const n of nodes) {
    const b = box.get(n.id);
    if (b) outNodes.set(n.id, toScreenBox(b));
  }
  const outRoutes = new Map<string, Point[]>();
  for (const [k, pts] of routes) outRoutes.set(k, pts.map(toScreenPt));

  // group frames (union of members), innermost first
  const depth = (id: string): number => {
    let d = 0;
    for (let cur = groups.find((x) => x.id === id); cur?.parent !== undefined; d++)
      cur = groups.find((x) => x.id === cur!.parent);
    return d;
  };
  const frames = new Map<string, Rect>();
  const ordered = [...groups].sort((a, b) => depth(b.id) - depth(a.id));
  for (const gr of ordered) {
    const parts: Rect[] = [
      ...nodes
        .filter((n) => n.group === gr.id && outNodes.has(n.id))
        .map((n) => outNodes.get(n.id)!),
      ...groups.filter((c) => c.parent === gr.id).map((c) => frames.get(c.id)!),
    ];
    if (parts.length === 0) {
      frames.set(gr.id, { x: 0, y: 0, w: 120, h: 60 });
      continue;
    }
    const x0 = Math.min(...parts.map((p) => p.x)) - GROUP_PAD;
    const y0 = Math.min(...parts.map((p) => p.y)) - GROUP_PAD - GROUP_TITLE_BAND;
    const x1 = Math.max(...parts.map((p) => p.x + p.w)) + GROUP_PAD;
    const y1 = Math.max(...parts.map((p) => p.y + p.h)) + GROUP_PAD;
    frames.set(gr.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  // shift so content starts at the margin, round everything
  const rects = [...outNodes.values(), ...frames.values()];
  const routePts = [...outRoutes.values()].flat();
  const dx = MARGIN - Math.min(...rects.map((r) => r.x), ...routePts.map((p) => p.x));
  const dy = MARGIN - Math.min(...rects.map((r) => r.y), ...routePts.map((p) => p.y));
  const rnd = (v: number): number => Math.round(v);
  for (const r of rects) {
    r.x = rnd(r.x + dx);
    r.y = rnd(r.y + dy);
    r.w = rnd(r.w);
    r.h = rnd(r.h);
  }
  for (const pts of outRoutes.values())
    for (const p of pts) {
      p.x = rnd(p.x + dx);
      p.y = rnd(p.y + dy);
    }

  // --- 7. labels --------------------------------------------------------------------------------
  const edgeOut = new Map<string, EdgeRoute>();
  const placed: Rect[] = [];
  let labelConflicts = 0;
  const nodeRects = [...outNodes.values()];
  edges.forEach((e, i) => {
    const key = keyOf(e, i);
    const wps = outRoutes.get(key);
    if (!wps) return;
    const route: EdgeRoute = { waypoints: wps };
    edgeOut.set(key, route);
    if (!e.label) return;
    const from = outNodes.get(e.from);
    const to = outNodes.get(e.to);
    if (!from || !to) return;
    const path = enginePath(from, to, wps, e.arrowStart ?? false, e.arrowEnd ?? true);
    const w = edgeLabelWidth(e.label);
    const pick = placeLabel(path, w, LABEL_H, nodeRects, placed, isMon(e));
    if (pick.conflict) labelConflicts++;
    route.labelPos = pick.pos;
    route.labelOffset = pick.off;
    route.labelBox = pick.box;
    placed.push(pick.box);
  });

  return { nodes: outNodes, groups: frames, edges: edgeOut, monitorNodes, labelConflicts };
}

const overlaps = (a: Rect, b: Rect, pad = 0): boolean =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * First label position along the connector that touches no node and no placed label. Candidates:
 * every straight segment (last segment first for requests, so the label sits next to its target;
 * longest first for monitoring), several points along it, above/below (or beside) the line.
 */
function placeLabel(
  path: Point[],
  w: number,
  h: number,
  nodeRects: Rect[],
  placed: Rect[],
  monitoring: boolean,
): { pos: number; off: number; box: Rect; conflict: boolean } {
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y));
  const total = cum[cum.length - 1]! || 1;
  const segs = path.slice(1).map((p, i) => ({ i, len: cum[i + 1]! - cum[i]! }));
  const isH = (i: number): boolean => Math.abs(path[i + 1]!.y - path[i]!.y) < 0.5;
  const order = monitoring
    ? [...segs].sort((a, b) => Number(isH(b.i)) - Number(isH(a.i)) || b.len - a.len || a.i - b.i)
    : [...segs]
        .reverse()
        .sort(
          (a, b) =>
            Number(isH(b.i) && b.len >= w + 12) - Number(isH(a.i) && a.len >= w + 12) ||
            Number(b.len >= w + 12) - Number(a.len >= w + 12),
        );
  // packets ride every segment of this connector: a label must stay out of that corridor
  const corridors: Rect[] = path.slice(1).map((b, i) => {
    const a = path[i]!;
    return {
      x: Math.min(a.x, b.x) - PACKET_HALF,
      y: Math.min(a.y, b.y) - PACKET_HALF,
      w: Math.abs(a.x - b.x) + 2 * PACKET_HALF,
      h: Math.abs(a.y - b.y) + 2 * PACKET_HALF,
    };
  });
  let fallback: { pos: number; off: number; box: Rect } | undefined;
  for (const s of order) {
    const a = path[s.i]!;
    const b = path[s.i + 1]!;
    const horizontal = Math.abs(b.y - a.y) < 0.5;
    const along = horizontal ? w : h;
    if (s.len < 8) continue;
    // below a horizontal line first: the engine draws a moving packet's own label 16 px above
    // the packet, so a connector label above the line would be crossed by every packet label
    // and clear of the packet itself (capsules are ~14 px tall, centred on the line)
    const offs = horizontal
      ? [-(h / 2 + LABEL_CLEAR), h / 2 + LABEL_CLEAR]
      : [w / 2 + LABEL_CLEAR + 3, -(w / 2 + LABEL_CLEAR + 3)];
    for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const lenAt = cum[s.i]! + s.len * f;
      // keep the label alongside this segment, clear of its corners
      if (s.len >= along + 8 && (s.len * f < along / 2 + 4 || s.len * (1 - f) < along / 2 + 4))
        continue;
      const pos = lenAt / total;
      for (const off of offs) {
        const c = pointAlong(path, pos, off);
        const bx: Rect = { x: c.x - w / 2, y: c.y - h / 2, w, h };
        fallback ??= { pos, off, box: bx };
        if (nodeRects.some((r) => overlaps(bx, r, 3))) continue;
        if (placed.some((r) => overlaps(bx, r, 2))) continue;
        if (corridors.some((r) => overlaps(bx, r))) continue;
        return { pos: round4(pos), off: Math.round(off * 10) / 10, box: bx, conflict: false };
      }
    }
  }
  const fb = fallback ?? { pos: 0.5, off: 10, box: { x: 0, y: 0, w, h } };
  return { pos: round4(fb.pos), off: Math.round(fb.off * 10) / 10, box: fb.box, conflict: true };
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** Copies orthogonal routes and label anchors from the layout onto canonical edges. */
export function applyRoutes(
  edges: CanonicalEdge[],
  routes: Map<
    string,
    { waypoints: { x: number; y: number }[]; labelPos?: number; labelOffset?: number }
  >,
): void {
  for (const e of edges) {
    const r = routes.get(e.id);
    if (!r || r.waypoints.length === 0 || r.waypoints.length > LIMITS.maxWaypoints) continue;
    e.routing = "orthogonal";
    e.waypoints = r.waypoints.map((p) => ({ x: p.x, y: p.y }));
    if (r.labelPos !== undefined) e.labelPos = r.labelPos;
    if (r.labelOffset !== undefined) e.labelOffset = r.labelOffset;
  }
}
