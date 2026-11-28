import {
  enginePath,
  estimateTextWidth,
  pointAlong,
  type CanonicalDocument,
  type Rect,
} from "@archflow/canonical-model";

/**
 * Where to put a scenario note so it covers no component, no connector label and no other note.
 *
 * The engine draws a note as a card whose top-left corner is the note's (x, y): 12.5 px text plus
 * 28 px padding wide, 30 px high (Engine/Scene.cpp `_DrawNote`). Widths are estimated
 * deterministically (no font measurement), with a safety margin.
 */

export const NOTE_H = 30;
export const noteWidth = (text: string): number => Math.ceil(estimateTextWidth(text) * 0.95 + 36);

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
});

/** Components and connector labels (where ArchFlow anchored them), as obstacles. */
export function noteObstacles(doc: CanonicalDocument): Rect[] {
  const nodes = new Map(doc.diagram.nodes.map((n) => [n.id, n]));
  const out: Rect[] = doc.diagram.nodes.map((n) => grow({ x: n.x, y: n.y, w: n.w, h: n.h }, 6));
  for (const e of doc.diagram.edges) {
    if (!e.label || e.labelPos === undefined || e.routing !== "orthogonal") continue;
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) continue;
    const pts = enginePath(
      a,
      b,
      e.waypoints ?? [],
      e.direction === "backward" || e.direction === "both",
      e.direction === "forward" || e.direction === "both",
    );
    const c = pointAlong(pts, e.labelPos, e.labelOffset ?? 10);
    const w = estimateTextWidth(e.label) * 0.9 + 8;
    out.push({ x: c.x - w / 2, y: c.y - 10, w, h: 20 });
  }
  return out;
}

/** Bounding box of the components and connector waypoints. */
export function diagramBox(doc: CanonicalDocument): Rect {
  const pts = [
    ...doc.diagram.nodes.flatMap((n) => [
      { x: n.x, y: n.y },
      { x: n.x + n.w, y: n.y + n.h },
    ]),
    ...doc.diagram.edges.flatMap((e) => e.waypoints ?? []),
  ];
  const x = Math.min(...pts.map((q) => q.x));
  const y = Math.min(...pts.map((q) => q.y));
  return { x, y, w: Math.max(...pts.map((q) => q.x)) - x, h: Math.max(...pts.map((q) => q.y)) - y };
}

/**
 * The engine frames the diagram (components and connectors) plus a margin; notes are not part
 * of it, so a note must stay within this much of the diagram to be on screen (pinned engine: 74 px).
 */
export const NOTE_REACH = 60;

/**
 * First free position for a note: next to `near` (above, below, right, left) or, without `near`,
 * above / below the whole diagram. `taken` are notes shown at the same time. Falls back to the
 * first candidate when everything is occupied.
 */
export function placeNote(
  text: string,
  near: Rect | undefined,
  obstacles: Rect[],
  taken: Rect[],
  box: Rect,
  /** The first `nodeCount` obstacles are components (covering them is worst). */
  nodeCount = obstacles.length,
): { x: number; y: number } {
  const w = noteWidth(text);
  const h = NOTE_H;
  const cands: { x: number; y: number }[] = near
    ? [
        { x: near.x, y: near.y - h - 8 },
        { x: near.x + near.w - w, y: near.y - h - 8 },
        { x: near.x, y: near.y + near.h + 8 },
        { x: near.x + near.w + 12, y: near.y + near.h / 2 - h / 2 },
        { x: near.x - w - 12, y: near.y + near.h / 2 - h / 2 },
        { x: near.x, y: near.y - 2 * h - 14 },
        { x: near.x, y: near.y + near.h + h + 14 },
      ]
    : [
        { x: box.x, y: box.y - h - 14 },
        { x: box.x + box.w / 2 - w / 2, y: box.y - h - 14 },
        { x: box.x, y: box.y + box.h + 14 },
      ];
  const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const reach = {
    x: box.x - NOTE_REACH,
    y: box.y - NOTE_REACH,
    w: box.w + 2 * NOTE_REACH,
    h: box.h + 2 * NOTE_REACH,
  };
  const within = (r: Rect): boolean =>
    r.x >= reach.x &&
    r.y >= reach.y &&
    r.x + r.w <= reach.x + reach.w &&
    r.y + r.h <= reach.y + reach.h;
  /** Moved inside the reachable area (keeps a note on screen even when every spot is taken). */
  const pull = (c: { x: number; y: number }) => ({
    x: Math.min(Math.max(c.x, reach.x), reach.x + reach.w - w),
    y: Math.min(Math.max(c.y, reach.y), reach.y + reach.h - h),
  });
  for (const c of cands) {
    const r = { x: c.x, y: c.y, w, h };
    if (within(r) && !obstacles.some((o) => overlap(r, o)) && !taken.some((o) => overlap(r, o)))
      return round(c);
  }
  // nothing free next to it: search a grid around it (deterministic order), taking the spot that
  // covers least (components count most, then other notes, then labels), nearest first
  const area = (a: Rect, b: Rect): number =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const anchor = pull(cands[0]!);
  let best = anchor;
  let bestScore = Infinity;
  for (let ring = 0; ring <= 12; ring++)
    for (let i = -ring; i <= ring; i++)
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const c = pull({ x: anchor.x + i * 24, y: anchor.y + j * 18 });
        const r = { x: c.x, y: c.y, w, h };
        let score = 0;
        obstacles.forEach((o, k) => {
          score += area(r, o) * (k < nodeCount ? 100 : 1);
        });
        for (const t of taken) score += area(r, t) * 50;
        score += ring * 0.001;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
  return round(best);
}
