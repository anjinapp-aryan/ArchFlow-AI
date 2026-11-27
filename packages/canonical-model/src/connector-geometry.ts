/**
 * Connector geometry exactly as the pinned engine computes it (AnimatedDiagrams v2.2.0,
 * Engine/Engine.cpp ComputeEdgeGeometry and Geometry/Path.cpp FlatPath::PointAlong).
 *
 * Shared by the auto-layout (to place labels where the engine will draw them) and the renderer
 * adapter (to turn axis-aligned first/last waypoints into side ports).
 */

import type { Point } from "./schema.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Engine gap between a node and its connector (kGap) and arrowhead length (kArrowLen). */
export const PORT_GAP = 4;
export const ARROW_LEN = 12;

/** Port on `r`'s side facing `p` when `p` is axis-aligned with that side; else undefined. */
export function sidePort(r: Rect, p: Point): Point | undefined {
  if (p.y >= r.y && p.y <= r.y + r.h) {
    if (p.x >= r.x + r.w) return { x: r.x + r.w + PORT_GAP, y: p.y };
    if (p.x <= r.x) return { x: r.x - PORT_GAP, y: p.y };
  }
  if (p.x >= r.x && p.x <= r.x + r.w) {
    if (p.y >= r.y + r.h) return { x: p.x, y: r.y + r.h + PORT_GAP };
    if (p.y <= r.y) return { x: p.x, y: r.y - PORT_GAP };
  }
  return undefined;
}

const pullBack = (from: Point, to: Point, len: number): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d <= len || d === 0) return from;
  return { x: to.x - (dx / d) * len, y: to.y - (dy / d) * len };
};

/** The polyline the engine draws for an orthogonal connector with these waypoints. */
export function enginePath(
  from: Rect,
  to: Rect,
  wps: Point[],
  arrowStart: boolean,
  arrowEnd: boolean,
): Point[] {
  const first = wps[0] ?? { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const last = wps[wps.length - 1] ?? { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const s = sidePort(from, first) ?? { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const t = sidePort(to, last) ?? { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const start = arrowStart ? pullBack(first, s, ARROW_LEN) : s;
  const end = arrowEnd ? pullBack(last, t, ARROW_LEN) : t;
  return [start, ...wps, end];
}

/** FlatPath::PointAlong (engine): point at `pos` of the length, offset perpendicular ("up" > 0). */
export function pointAlong(pts: Point[], pos: number, off: number): Point {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = cum[cum.length - 1]!;
  const at = (len: number): Point => {
    const l = Math.max(0, Math.min(total, len));
    for (let i = 1; i < pts.length; i++) {
      if (l <= cum[i]! || i === pts.length - 1) {
        const seg = cum[i]! - cum[i - 1]!;
        const k = seg === 0 ? 0 : (l - cum[i - 1]!) / seg;
        return {
          x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * k,
          y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * k,
        };
      }
    }
    return pts[0]!;
  };
  const p = Math.max(0, Math.min(1, pos));
  const c = at(total * p);
  if (off === 0) return c;
  const a = at(total * p - 3);
  const b = at(total * p + 3);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  let nx = Math.cos(ang + Math.PI / 2);
  let ny = Math.sin(ang + Math.PI / 2);
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: c.x + nx * off, y: c.y + ny * off };
}
