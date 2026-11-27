import {
  enginePath,
  pointAlong,
  type CanonicalDocument,
  type Point,
  type Rect,
} from "@archflow/canonical-model";
import {
  cameraBoundsAt,
  cameraViewAt,
  type Bounds,
  type CameraPlan,
} from "@archflow/renderer-adapter";

/**
 * Camera QA, computed independently of the planner's own activity boxes: what each scenario
 * event puts on screen (its components, and for packets on routed connectors the packet with its
 * label) must lie inside the camera's world rectangle at every sampled instant of the event.
 */

/** Stand-in for the engine's content bounds in node tests: nodes, routed paths, a margin. */
export function contentBounds(doc: CanonicalDocument): Bounds {
  const pts: Point[] = [];
  for (const n of doc.diagram.nodes) pts.push({ x: n.x, y: n.y }, { x: n.x + n.w, y: n.y + n.h });
  for (const e of doc.diagram.edges) for (const w of e.waypoints ?? []) pts.push(w);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const m = 40;
  const x = Math.min(...xs) - m;
  const y = Math.min(...ys) - m;
  return [x, y, Math.max(...xs) + m - x, Math.max(...ys) + m - y];
}

const inside = (outer: Bounds, r: Rect, tol = 0.5): boolean =>
  r.x >= outer[0] - tol &&
  r.y >= outer[1] - tol &&
  r.x + r.w <= outer[0] + outer[2] + tol &&
  r.y + r.h <= outer[1] + outer[3] + tol;

/** Engine packet easing (ease-in-out) and position, recomputed here on purpose. */
function packetAt(path: Point[], forward: boolean, t0: number, dur: number, t: number): Point {
  const p = Math.max(0, Math.min(1, (t - t0) / Math.max(1, dur)));
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  return pointAlong(path, forward ? e : 1 - e, 0);
}

export interface CameraIssues {
  hidden: string[];
  jumps: string[];
  zoomTooHigh: string[];
  shortStops: string[];
  overlappingMoves: string[];
  endsOffOverview: boolean;
  startsOffOverview: boolean;
}

/** Sample the plan every `stepMs` and report every violated rule. */
export function checkCamera(
  doc: CanonicalDocument,
  plan: CameraPlan,
  stepMs = 1000 / 60,
): CameraIssues {
  const out: CameraIssues = {
    hidden: [],
    jumps: [],
    zoomTooHigh: [],
    shortStops: [],
    overlappingMoves: [],
    endsOffOverview: false,
    startsOffOverview: false,
  };
  const nodes = new Map(doc.diagram.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const hide = (msg: string): void => {
    if (!seen.has(msg)) out.hidden.push(msg);
    seen.add(msg);
  };
  for (const ev of doc.scenario?.events ?? []) {
    for (let t = ev.t; t <= ev.t + ev.durationMs; t += stepMs) {
      const b = cameraBoundsAt(plan, t);
      const ids = ev.type === "packet" ? [ev.from, ev.to] : ev.type === "note" ? [] : [ev.nodeId];
      for (const id of ids) {
        const n = nodes.get(id)!;
        if (!inside(b, { x: n.x, y: n.y, w: n.w, h: n.h })) hide(`${ev.id}: ${id} hidden`);
      }
      if (ev.type === "packet") {
        const e = doc.diagram.edges.find((x) =>
          ev.edgeId !== undefined
            ? x.id === ev.edgeId
            : (x.from === ev.from && x.to === ev.to) || (x.from === ev.to && x.to === ev.from),
        );
        if (e?.routing === "orthogonal" && (e.waypoints?.length ?? 0) > 0) {
          const path = enginePath(
            nodes.get(e.from)!,
            nodes.get(e.to)!,
            e.waypoints ?? [],
            e.direction === "backward" || e.direction === "both",
            e.direction === "forward" || e.direction === "both",
          );
          const p = packetAt(path, e.from === ev.from, ev.t, ev.durationMs, t);
          // packet (about 14 px) and its label drawn 16 px above it
          if (!inside(b, { x: p.x - 10, y: p.y - 26, w: 20, h: 34 }))
            hide(`${ev.id}: packet hidden`);
        }
      }
    }
  }
  // smoothness: centre moves at most 12% of the view width per 1/60 s, zoom at most 6%
  let prev = cameraViewAt(plan, 0);
  let prevB = cameraBoundsAt(plan, 0);
  for (let t = stepMs; t <= plan.durationMs; t += stepMs) {
    const v = cameraViewAt(plan, t);
    const b = cameraBoundsAt(plan, t);
    const d = Math.hypot(
      b[0] + b[2] / 2 - (prevB[0] + prevB[2] / 2),
      b[1] + b[3] / 2 - (prevB[1] + prevB[3] / 2),
    );
    if (
      d >
      0.12 *
        Math.min(Math.max(b[2], b[3] * plan.aspect), Math.max(prevB[2], prevB[3] * plan.aspect))
    )
      out.jumps.push(`t=${t.toFixed(0)}: centre jumps ${d.toFixed(1)}`);
    // the painter letterboxes a rectangle to the viewport: compare the world width actually shown
    const shown = (r: Bounds): number => Math.max(r[2], r[3] * plan.aspect);
    const zr = Math.max(shown(b) / shown(prevB), shown(prevB) / shown(b));
    if (zr > 1.06) out.jumps.push(`t=${t.toFixed(0)}: zoom jumps x${zr.toFixed(3)}`);
    if (v.zoom > plan.options.maxZoom + 1e-9) out.zoomTooHigh.push(`t=${t.toFixed(0)}: ${v.zoom}`);
    prev = v;
    prevB = b;
  }
  void prev;
  // stops held long enough; moves one at a time (segments are contiguous and never overlap)
  const segs = plan.segments;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (i > 0 && s.t0 !== segs[i - 1]!.t1)
      out.overlappingMoves.push(`segment ${i} starts at ${s.t0}, previous ends ${segs[i - 1]!.t1}`);
    if (s.kind === "move" && i > 0 && segs[i - 1]!.kind === "move")
      out.overlappingMoves.push(`segments ${i - 1}/${i} are both moves`);
  }
  // a stop (hold or follow, plus a hold right after its follow) lasts at least minDwellMs, except
  // the final overview, which lasts until the end
  let stopStart = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const nextIsMove = segs[i + 1]?.kind === "move";
    if (s.kind === "move") stopStart = s.t1;
    else if (nextIsMove && s.t1 - stopStart < plan.options.minDwellMs)
      out.shortStops.push(`stop ${stopStart}..${s.t1} (${s.t1 - stopStart} ms)`);
  }
  const first = cameraBoundsAt(plan, 0);
  const last = cameraBoundsAt(plan, plan.durationMs);
  out.startsOffOverview = first.join() !== plan.overview.join();
  out.endsOffOverview = last.join() !== plan.overview.join();
  return out;
}

export const noIssues: CameraIssues = {
  hidden: [],
  jumps: [],
  zoomTooHigh: [],
  shortStops: [],
  overlappingMoves: [],
  endsOffOverview: false,
  startsOffOverview: false,
};
