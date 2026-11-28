import {
  edgeInteraction,
  enginePath,
  pointAlong,
  type CanonicalDocument,
  type Point,
  type Rect,
} from "@archflow/canonical-model";
import {
  cameraBoundsAt,
  connectorLabelBoxes,
  noteCard,
  cameraViewAt,
  type Bounds,
  type CameraPlan,
} from "@archflow/renderer-adapter";

/**
 * Camera QA, computed independently of the planner's own activity boxes: what each scenario
 * event puts on screen (its components, and for packets on routed connectors the packet with its
 * label) must lie inside the camera's world rectangle at every sampled instant of the event.
 */

/** Stand-in for the engine's content bounds in node tests: nodes, routed paths, its margin. */
export function contentBounds(doc: CanonicalDocument): Bounds {
  const pts: Point[] = [];
  for (const n of doc.diagram.nodes) pts.push({ x: n.x, y: n.y }, { x: n.x + n.w, y: n.y + n.h });
  for (const e of doc.diagram.edges) for (const w of e.waypoints ?? []) pts.push(w);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const m = 74; // the pinned engine frames the content with a 74 px margin
  const x = Math.min(...xs) - m;
  const y = Math.min(...ys) - m;
  return [x, y, Math.max(...xs) + m - x, Math.max(...ys) + m - y];
}

/** Mirrors the planner: a state is framed for this long when it starts and when it ends. */
const STATE_CHANGE_MS = 600;

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
  /** Held frames that cut a component or a connector label at the frame edge. */
  cut: string[];
  /** Requests/responses whose next destination (where the flow goes next) was off screen. */
  nextHidden: string[];
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
    cut: [],
    nextHidden: [],
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
    const t1 = ev.t + ev.durationMs;
    for (let t = ev.t; t <= t1; t += stepMs) {
      // a long state (a caller waiting, a target that stays unhealthy) must be on screen when it
      // changes: its first and last STATE_CHANGE_MS
      if (
        ev.type === "node_state" &&
        ev.durationMs > 2 * STATE_CHANGE_MS &&
        t > ev.t + STATE_CHANGE_MS &&
        t < t1 - STATE_CHANGE_MS
      )
        continue;
      const b = cameraBoundsAt(plan, t);
      if (ev.type === "note" && !inside(b, noteCard(ev.text, ev.x, ev.y)))
        hide(`${ev.id}: note hidden`);
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
  // held frames: nothing cut at the edge
  const labels = connectorLabelBoxes(doc);
  const cuts = (b: Bounds, r: Rect): boolean =>
    !inside(b, r, 0.5) &&
    !(r.x + r.w <= b[0] || r.y + r.h <= b[1] || r.x >= b[0] + b[2] || r.y >= b[1] + b[3]);
  // (the optional packet-follow mode tracks the packet and may cut; its trailing hold is excluded)
  const held = plan.segments.filter(
    (x, i) => x.kind === "hold" && !x.overview && plan.segments[i - 1]?.kind !== "follow",
  );
  for (const s of held) {
    const b = cameraBoundsAt(plan, (s.t0 + s.t1) / 2);
    for (const n of doc.diagram.nodes) if (cuts(b, n)) out.cut.push(`${s.t0}-${s.t1}: ${n.id}`);
    labels.forEach((l, i) => {
      if (cuts(b, l)) out.cut.push(`${s.t0}-${s.t1}: label ${i}`);
    });
  }
  // next destinations: while a request/response is shown in a held frame, the component its
  // flow reaches next (the next packet leaving its destination) is on screen too
  const evs = doc.scenario?.events ?? [];
  for (const ev of evs) {
    if (ev.type !== "packet" || ev.variant === "probe" || !plan.options.context) continue;
    const e = doc.diagram.edges.find((x) => x.id === ev.edgeId);
    if (e && edgeInteraction(e) === "monitoring") continue;
    const arrive = ev.t + ev.durationMs;
    const next = evs
      .filter(
        (q) =>
          q.type === "packet" &&
          q !== ev &&
          q.variant !== "probe" &&
          q.from === ev.to &&
          q.flowId === ev.flowId &&
          q.t >= arrive - 1,
      )
      .sort((x, y) => x.t - y.t)[0];
    if (!next || next.type !== "packet") continue;
    const n = nodes.get(next.to)!;
    for (const s of held.filter((x) => x.t0 < arrive && ev.t < x.t1)) {
      const b = cameraBoundsAt(plan, Math.max(s.t0, ev.t));
      if (!inside(b, n)) out.nextHidden.push(`${ev.id}: next ${next.to}`);
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
  cut: [],
  nextHidden: [],
  jumps: [],
  zoomTooHigh: [],
  shortStops: [],
  overlappingMoves: [],
  endsOffOverview: false,
  startsOffOverview: false,
};
