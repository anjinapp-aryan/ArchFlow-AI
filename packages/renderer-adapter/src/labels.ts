import {
  estimateTextWidth,
  pointAlong,
  type CanonicalDocument,
  type Point,
  type Rect,
} from "@archflow/canonical-model";
import { edgePath } from "./camera.ts";

/**
 * Adaptive connector labels (render time only).
 *
 * Connector labels are 12 px in the diagram. On a large diagram's overview they shrink below a
 * comfortable reading size (about 8 px in a 1280x720 video for the AWS ALB example, 6 px for 40
 * components). Making every label bigger in the layout would widen the diagram and shrink the
 * overview by the same factor, so instead the painter enlarges a label on screen only while it is
 * small, and only as far as the free space around it allows:
 *
 * - each label gets a maximum scale (`max`), the largest at which its box still touches no
 *   component, no other label (at that label's own maximum) and no other connector, and stays
 *   inside the diagram;
 * - at instant t the painter scales a label by `min(max, minPx / on-screen size)`: labels that are
 *   already readable (camera stops, 1080p) are drawn exactly as the engine laid them out;
 * - text, position and anchor are unchanged; nothing is hidden or shortened, so the diagram says
 *   the same thing at every scale.
 *
 * Deterministic: a pure function of the canonical document.
 */
export interface LabelBoost {
  text: string;
  /** Centre of the label (world coordinates, the engine's anchor). */
  cx: number;
  cy: number;
  /** Largest scale with free space around the label (>= 1). */
  max: number;
  /** Box at scale 1 (world px). */
  w: number;
  h: number;
}

/** Target on-screen size of connector text (device px of a 1:1 viewport). */
export const LABEL_MIN_PX = 11;
/** Upper limit of the enlargement. */
export const LABEL_MAX_BOOST = 1.5;
const STEP = 0.05;

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (outer: Rect, r: Rect): boolean =>
  r.x >= outer.x &&
  r.y >= outer.y &&
  r.x + r.w <= outer.x + outer.w &&
  r.y + r.h <= outer.y + outer.h;

/** Does the segment p-q cross rectangle r? (axis-aligned routes, plus a sampled fallback) */
function segmentHits(p: Point, q: Point, r: Rect): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 4));
  for (let i = 0; i <= n; i++) {
    const x = p.x + ((q.x - p.x) * i) / n;
    const y = p.y + ((q.y - p.y) * i) / n;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
}

/** The label box at scale `s` (text box grown around the anchor; padding does not scale). */
export function labelBox(b: Pick<LabelBoost, "cx" | "cy" | "w" | "h">, s: number): Rect {
  const w = (b.w - 8) * s + 8;
  const h = (b.h - 6) * s + 6;
  return { x: b.cx - w / 2, y: b.cy - h / 2, w, h };
}

export function labelBoosts(doc: CanonicalDocument): LabelBoost[] {
  const nodes = doc.diagram.nodes.map((n) => ({ x: n.x - 2, y: n.y - 2, w: n.w + 4, h: n.h + 4 }));
  const items: (LabelBoost & { edge: string })[] = [];
  const paths = new Map<string, Point[]>();
  for (const e of doc.diagram.edges) {
    const { pts, exact } = edgePath(doc, e);
    if (exact) paths.set(e.id, pts);
    if (!e.label || e.labelPos === undefined || !exact) continue;
    const c = pointAlong(pts, e.labelPos, e.labelOffset ?? 10);
    // 12 px text: about 0.85 of the generic estimate, 14 px line box, 4 px padding per side
    items.push({
      edge: e.id,
      text: e.label,
      cx: c.x,
      cy: c.y,
      w: estimateTextWidth(e.label) * 0.85 + 8,
      h: 20,
      max: 1,
    });
  }
  if (items.length === 0) return [];
  const xs = doc.diagram.nodes.flatMap((n) => [n.x, n.x + n.w]);
  const ys = doc.diagram.nodes.flatMap((n) => [n.y, n.y + n.h]);
  for (const pts of paths.values())
    for (const p of pts) {
      xs.push(p.x);
      ys.push(p.y);
    }
  for (const it of items) {
    const b = labelBox(it, 1);
    xs.push(b.x, b.x + b.w);
    ys.push(b.y, b.y + b.h);
  }
  const area: Rect = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };

  // obstacles a label may already touch at scale 1 stay allowed (the engine drew it that way)
  const free = (it: (typeof items)[number], s: number, others: boolean): boolean => {
    const box = labelBox(it, s);
    const base = labelBox(it, 1);
    if (!inside(area, box) && inside(area, base)) return false;
    for (const n of nodes) if (overlap(box, n) && !overlap(base, n)) return false;
    for (const [id, pts] of paths) {
      if (id === it.edge) continue;
      for (let i = 1; i < pts.length; i++)
        if (segmentHits(pts[i - 1]!, pts[i]!, box) && !segmentHits(pts[i - 1]!, pts[i]!, base))
          return false;
    }
    if (others)
      for (const o of items)
        if (o !== it && overlap(box, labelBox(o, o.max)) && !overlap(base, labelBox(o, 1)))
          return false;
    return true;
  };
  for (const it of items) {
    let s = 1;
    while (s + STEP <= LABEL_MAX_BOOST + 1e-9 && free(it, s + STEP, false)) s += STEP;
    it.max = Math.round(s * 100) / 100;
  }
  // labels next to each other share the free space between them: shrink the larger one first
  for (let guard = 0; guard < 400; guard++) {
    let changed = false;
    for (const it of [...items].sort((a, b) => b.max - a.max || a.edge.localeCompare(b.edge)))
      if (it.max > 1 && !free(it, it.max, true)) {
        it.max = Math.max(1, Math.round((it.max - STEP) * 100) / 100);
        changed = true;
      }
    if (!changed) break;
  }
  return items.map(({ edge: _edge, ...b }) => b);
}

/** Scale the painter applies to a label drawn `sizePx` device px high on screen. */
export function labelScale(b: Pick<LabelBoost, "max">, sizePx: number, minPx: number): number {
  if (!(sizePx > 0) || sizePx >= minPx) return 1;
  return Math.min(b.max, minPx / sizePx);
}
