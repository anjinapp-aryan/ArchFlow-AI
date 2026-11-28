import {
  edgeInteraction,
  enginePath,
  estimateTextWidth,
  pointAlong,
  type CanonicalDocument,
  type CanonicalEdge,
  type Point,
  type Rect,
} from "@archflow/canonical-model";

/**
 * Deterministic automatic camera.
 *
 * A pure function of the canonical document, the engine's content bounds, the viewport aspect
 * ratio and the options: it never measures the DOM and never uses wall-clock time. The plan is
 * a list of segments (hold, move, follow); `cameraBoundsAt(plan, t)` returns the world rectangle
 * the painter fits into the viewport at instant `t`. Playback and video export both call it, so
 * they frame every instant identically for the same aspect ratio.
 *
 * The camera only changes the framing. Node positions, connector geometry and the engine's
 * display list are untouched.
 *
 * Rules (defaults, all configurable): no camera for diagrams with at most 6 components; zoom at
 * most 2.2x the overview; every stop is held at least 1 s; one transition at a time; a stop
 * covers everything active while it is shown (components, packets with their labels, the
 * connector label); the plan starts and ends on the full-diagram overview. Ideas adapted from the
 * camera rules in omkamal/animated-diagrams-skill (Apache-2.0); no code was copied.
 */

/** World rectangle: x, y, width, height (the painter's `Framing.bounds`). */
export type Bounds = [number, number, number, number];

export interface CameraOptions {
  /** Diagrams with at most this many components keep the static overview. */
  maxStaticNodes: number;
  /** Highest zoom, relative to the overview fit. */
  maxZoom: number;
  /** A stop zooms in only if it gains at least this factor over the overview. */
  minZoomGain: number;
  /** Shortest time a stop is held (ms). */
  minDwellMs: number;
  /** Duration of one transition (ms). */
  moveMs: number;
  /** The plan ends on the overview, held at least this long when the scenario allows it (ms). */
  endHoldMs: number;
  /** Margin around the focused content (world px). */
  margin: number;
  /** Follow a lone packet along its connector instead of framing the whole connector. */
  followPackets: boolean;
  /** Zoom while following a packet (clamped to maxZoom). */
  followZoom: number;
  /** Frame the smallest group containing the focus when it still gains enough zoom. */
  snapToGroups: boolean;
  /**
   * Keep the next destination in view: while a request or response travels, the camera also
   * frames the hop the scenario takes next from its destination (connector and component).
   */
  context: boolean;
  /** Free space kept around the framed content, as a fraction of the view on each side. */
  safeMargin: number;
  /**
   * Never cut a component or a connector label at the frame edge (the frame zooms out or shifts
   * instead). In dense diagrams this can leave only the overview; off, frames fit the focus.
   */
  avoidCuts: boolean;
}

export const DEFAULT_CAMERA_OPTIONS: Readonly<CameraOptions> = Object.freeze({
  maxStaticNodes: 6,
  maxZoom: 2.2,
  minZoomGain: 1.25,
  minDwellMs: 1000,
  moveMs: 1200,
  endHoldMs: 1200,
  margin: 28,
  followPackets: false,
  followZoom: 1.8,
  snapToGroups: true,
  context: true,
  safeMargin: 0.05,
  avoidCuts: true,
});

/** Camera state: centre (world) and zoom relative to the overview fit. */
export interface CameraView {
  cx: number;
  cy: number;
  zoom: number;
}

interface FollowSpec {
  path: Point[];
  t0: number;
  duration: number;
  forward: boolean;
}

export interface CameraSegment {
  kind: "hold" | "move" | "follow";
  t0: number;
  t1: number;
  from: CameraView;
  to: CameraView;
  /** True when the segment shows the exact overview (painter output identical to no camera). */
  overview: boolean;
  /** What the stop frames: component ids, or "overview". */
  focus: string[];
  follow?: FollowSpec;
}

export interface CameraPlan {
  enabled: boolean;
  /** Why the camera is off, or a one-line summary when on. */
  reason: string;
  overview: Bounds;
  aspect: number;
  durationMs: number;
  options: CameraOptions;
  segments: CameraSegment[];
}

/** Something on screen between t0 and t1 that must stay visible. */
export interface CameraActivity {
  id: string;
  t0: number;
  t1: number;
  rect: Rect;
  nodes: string[];
  /** Exact packet path, when the activity is a packet on an orthogonal connector. */
  follow?: FollowSpec;
}

// --- geometry -----------------------------------------------------------------------------------

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const grow = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
});
const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - 0.01 &&
  inner.y >= outer.y - 0.01 &&
  inner.x + inner.w <= outer.x + outer.w + 0.01 &&
  inner.y + inner.h <= outer.y + outer.h + 0.01;
const ofPoints = (pts: Point[]): Rect => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const clampTo = (r: Rect, o: Rect): Rect => {
  const x = Math.max(r.x, o.x);
  const y = Math.max(r.y, o.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(r.x + r.w, o.x + o.w) - x),
    h: Math.max(0, Math.min(r.y + r.h, o.y + o.h) - y),
  };
};
const toRect = (b: Bounds): Rect => ({ x: b[0], y: b[1], w: b[2], h: b[3] });

/** World size shown at zoom 1 for the viewport aspect ratio (the overview, letterboxed). */
function baseSize(o: Rect, aspect: number): { w: number; h: number } {
  return o.w / o.h >= aspect ? { w: o.w, h: o.w / aspect } : { w: o.h * aspect, h: o.h };
}

/** World rectangle shown for `v` (centre clamped so the view never leaves the overview needlessly). */
export function viewRect(plan: Pick<CameraPlan, "overview" | "aspect">, v: CameraView): Rect {
  const o = toRect(plan.overview);
  const b = baseSize(o, plan.aspect);
  const w = b.w / v.zoom;
  const h = b.h / v.zoom;
  const cx = w >= o.w ? o.x + o.w / 2 : Math.min(o.x + o.w - w / 2, Math.max(o.x + w / 2, v.cx));
  const cy = h >= o.h ? o.y + o.h / 2 : Math.min(o.y + o.h - h / 2, Math.max(o.y + h / 2, v.cy));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const overviewView = (o: Rect): CameraView => ({ cx: o.x + o.w / 2, cy: o.y + o.h / 2, zoom: 1 });

/** Zoom that fits `r` with `safe` free space on each side (clamped to [1, maxZoom]). */
function fitZoom(r: Rect, o: Rect, aspect: number, maxZoom: number, safe = 0): number {
  const b = baseSize(o, aspect);
  const k = 1 + 2 * safe;
  const z = Math.min(b.w / Math.max(1, r.w * k), b.h / Math.max(1, r.h * k));
  return Math.max(1, Math.min(maxZoom, z));
}

// --- activities from the scenario ----------------------------------------------------------------

/** Room above a packet for its label (engine: 16 px above the packet) and the packet itself. */
const PACKET_ROOM = 30;
/** A state change is framed this long at its start and at its end. */
const STATE_CHANGE_MS = 600;
/** Room around a node for state badges, timers and the activity highlight. */
const NODE_ROOM = 14;

function edgeFor(
  doc: CanonicalDocument,
  from: string,
  to: string,
  edgeId?: string,
): CanonicalEdge | undefined {
  const edges = doc.diagram.edges;
  if (edgeId !== undefined) return edges.find((e) => e.id === edgeId);
  return edges.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
}

/** Engine path of a connector (orthogonal: exact; otherwise the centre line). */
export function edgePath(
  doc: CanonicalDocument,
  e: CanonicalEdge,
): { pts: Point[]; exact: boolean } {
  const a = doc.diagram.nodes.find((n) => n.id === e.from)!;
  const b = doc.diagram.nodes.find((n) => n.id === e.to)!;
  if (e.routing === "orthogonal" && (e.waypoints?.length ?? 0) > 0)
    return {
      pts: enginePath(
        a,
        b,
        e.waypoints ?? [],
        e.direction === "backward" || e.direction === "both",
        e.direction === "forward" || e.direction === "both",
      ),
      exact: true,
    };
  return {
    pts: [
      { x: a.x + a.w / 2, y: a.y + a.h / 2 },
      { x: b.x + b.w / 2, y: b.y + b.h / 2 },
    ],
    exact: false,
  };
}

/** Connector label boxes where ArchFlow anchored them (exact routes only). */
export function connectorLabelBoxes(doc: CanonicalDocument): Rect[] {
  const out: Rect[] = [];
  for (const e of doc.diagram.edges) {
    if (!e.label || e.labelPos === undefined) continue;
    const { pts, exact } = edgePath(doc, e);
    if (!exact) continue;
    const c = pointAlong(pts, e.labelPos, e.labelOffset ?? 10);
    const w = estimateTextWidth(e.label) * 0.85 + 12;
    out.push({ x: c.x - w / 2, y: c.y - 12, w, h: 24 });
  }
  return out;
}

/** Engine note card (Engine/Scene.cpp `_DrawNote`): top-left (x, y), 12.5 px text + 28 px, 30 px high. */
export const noteCard = (text: string, x: number, y: number): Rect => ({
  x,
  y,
  w: estimateTextWidth(text) * 0.95 + 36,
  h: 30,
});

/** Everything that must stay visible, per scenario event (sorted by start, then id). */
export function cameraActivities(doc: CanonicalDocument, context = false): CameraActivity[] {
  const nodes = new Map(doc.diagram.nodes.map((n) => [n.id, n as Rect]));
  const events = doc.scenario?.events ?? [];
  /**
   * The next hop the scenario really takes after packet `ev` arrives: the next request or
   * response in the same flow that leaves its destination (connector and component).
   */
  const nextHop = (ev: Extract<(typeof events)[number], { type: "packet" }>): Rect | undefined => {
    const arrive = ev.t + ev.durationMs;
    let next: Extract<(typeof events)[number], { type: "packet" }> | undefined;
    for (const q of events)
      if (
        q.type === "packet" &&
        q !== ev &&
        q.variant !== "probe" &&
        q.from === ev.to &&
        q.flowId === ev.flowId &&
        q.t >= arrive - 1 &&
        (!next || q.t < next.t)
      )
        next = q;
    if (!next) return undefined;
    const far = nodes.get(next.to);
    const e = edgeFor(doc, next.from, next.to, next.edgeId);
    if (!far) return undefined;
    const box = grow(far, NODE_ROOM);
    return e ? union(box, grow(ofPoints(edgePath(doc, e).pts), 8)) : box;
  };
  const out: CameraActivity[] = [];
  const nodeBox = (id: string): Rect | undefined => {
    const n = nodes.get(id);
    return n ? grow({ x: n.x, y: n.y, w: n.w, h: n.h }, NODE_ROOM) : undefined;
  };
  for (const ev of doc.scenario?.events ?? []) {
    const t0 = ev.t;
    const t1 = ev.t + ev.durationMs;
    if (ev.type === "packet") {
      const a = nodes.get(ev.from);
      const b = nodes.get(ev.to);
      if (!a || !b) continue;
      let rect = union(nodeBox(ev.from)!, nodeBox(ev.to)!);
      const e = edgeFor(doc, ev.from, ev.to, ev.edgeId);
      let follow: FollowSpec | undefined;
      if (e) {
        const ea = nodes.get(e.from)!;
        const eb = nodes.get(e.to)!;
        let pts: Point[];
        if (e.routing === "orthogonal" && (e.waypoints?.length ?? 0) > 0) {
          pts = enginePath(
            ea,
            eb,
            e.waypoints ?? [],
            e.direction === "backward" || e.direction === "both",
            e.direction === "forward" || e.direction === "both",
          );
          if ((ev.count ?? 1) <= 1)
            follow = { path: pts, t0, duration: ev.durationMs, forward: e.from === ev.from };
        } else {
          // curved or straight connectors: the engine's curve stays near the centre line; the
          // bulge is covered by a margin proportional to the length
          const c1 = { x: ea.x + ea.w / 2, y: ea.y + ea.h / 2 };
          const c2 = { x: eb.x + eb.w / 2, y: eb.y + eb.h / 2 };
          pts = [c1, c2];
          rect = union(rect, grow(ofPoints(pts), 0.15 * Math.hypot(c2.x - c1.x, c2.y - c1.y)));
        }
        rect = union(rect, grow(ofPoints(pts), PACKET_ROOM));
        if (e.label && e.labelPos !== undefined) {
          const c = pointAlong(pts, e.labelPos, e.labelOffset ?? 10);
          const w = estimateTextWidth(e.label) * 0.85 + 12;
          rect = union(rect, { x: c.x - w / 2, y: c.y - 12, w, h: 24 });
        }
      } else {
        // no connector: the engine draws a straight line between the node borders
        rect = union(
          rect,
          grow(
            ofPoints([
              { x: a.x + a.w / 2, y: a.y + a.h / 2 },
              { x: b.x + b.w / 2, y: b.y + b.h / 2 },
            ]),
            PACKET_ROOM,
          ),
        );
      }
      if (context && ev.variant !== "probe" && (!e || edgeInteraction(e) !== "monitoring")) {
        const c = nextHop(ev);
        if (c) rect = union(rect, c);
      }
      out.push({ id: ev.id, t0, t1, rect, nodes: [ev.from, ev.to], ...(follow ? { follow } : {}) });
    } else if (ev.type === "node_state") {
      // a state matters when it changes: a long state (a caller waiting for its answer, a target
      // that stays unhealthy) is framed when it starts and when it ends, not all the time
      const r = nodeBox(ev.nodeId);
      if (!r) continue;
      if (t1 - t0 <= 2 * STATE_CHANGE_MS)
        out.push({ id: ev.id, t0, t1, rect: r, nodes: [ev.nodeId] });
      else
        out.push(
          { id: ev.id, t0, t1: t0 + STATE_CHANGE_MS, rect: r, nodes: [ev.nodeId] },
          { id: `${ev.id}~end`, t0: t1 - STATE_CHANGE_MS, t1, rect: r, nodes: [ev.nodeId] },
        );
    } else if (ev.type === "timeout") {
      const r = nodeBox(ev.nodeId);
      if (r) out.push({ id: ev.id, t0, t1, rect: grow(r, 10), nodes: [ev.nodeId] });
    } else if (ev.type === "note") {
      out.push({ id: ev.id, t0, t1, rect: noteCard(ev.text, ev.x, ev.y), nodes: [] });
    }
  }
  return out.sort((p, q) => p.t0 - q.t0 || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

// --- planning ------------------------------------------------------------------------------------

interface Piece {
  t0: number;
  t1: number;
  acts: CameraActivity[];
  rect: Rect;
}

/** Split the timeline at every start/end; each piece lists what is active. */
function pieces(acts: CameraActivity[]): Piece[] {
  const cuts = [...new Set(acts.flatMap((a) => [a.t0, a.t1]))].sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i]!;
    const t1 = cuts[i + 1]!;
    const live = acts.filter((a) => a.t0 < t1 && a.t1 > t0);
    if (live.length === 0) continue;
    out.push({ t0, t1, acts: live, rect: live.map((a) => a.rect).reduce(union) });
  }
  return out;
}

interface Stop {
  arrive: number;
  /** undefined: the overview. */
  rect: Rect | undefined;
  nodes: Set<string>;
  follow?: CameraActivity;
}

export function planCamera(
  doc: CanonicalDocument,
  overview: Bounds,
  aspect: number,
  durationMs: number,
  options: Partial<CameraOptions> = {},
): CameraPlan {
  const opt: CameraOptions = { ...DEFAULT_CAMERA_OPTIONS, ...options };
  const o = toRect(overview);
  const plan: CameraPlan = {
    enabled: false,
    reason: "",
    overview,
    aspect,
    durationMs,
    options: opt,
    segments: [],
  };
  const still = (reason: string): CameraPlan => {
    plan.reason = reason;
    plan.segments = [
      {
        kind: "hold",
        t0: 0,
        t1: durationMs,
        from: overviewView(o),
        to: overviewView(o),
        overview: true,
        focus: ["overview"],
      },
    ];
    return plan;
  };
  if (!(aspect > 0) || !(o.w > 0) || !(o.h > 0)) return still("no visible content");
  const n = doc.diagram.nodes.length;
  if (n <= opt.maxStaticNodes)
    return still(`${n} components (camera only above ${opt.maxStaticNodes})`);
  const all = cameraActivities(doc, opt.context).map((a) => ({
    ...a,
    rect: clampTo(grow(a.rect, opt.margin), o),
  }));
  if (all.length === 0) return still("no scenario events");
  // notes that start after everything else (an ending summary) are shown on the overview
  const notes = new Set(
    (doc.scenario?.events ?? []).filter((e) => e.type === "note").map((e) => e.id),
  );
  // (states may last to the end, to show the final picture: only traffic counts as work)
  const states = new Set(
    (doc.scenario?.events ?? []).filter((e) => e.type === "node_state").map((e) => e.id),
  );
  const isWork = (a: CameraActivity): boolean =>
    !notes.has(a.id) && !states.has(a.id.replace(/~end$/, ""));
  const workEnd = Math.max(0, ...all.filter(isWork).map((a) => a.t1));
  const trailing = all.filter((a) => notes.has(a.id) && a.t0 >= workEnd);
  const endingAt = trailing.length ? Math.min(...trailing.map((a) => a.t0)) : Infinity;
  // from the ending on, the overview shows everything: nothing after it needs a stop
  const acts = all.filter((a) => !trailing.includes(a) && a.t0 < endingAt);
  if (acts.length === 0) return still("no scenario events");
  const summaryAt = endingAt;

  const groups = opt.snapToGroups
    ? doc.diagram.groups.flatMap((g) => (g.frame ? [{ id: g.id, rect: g.frame as Rect }] : []))
    : [];
  const frameOf = (r: Rect): Rect | undefined => {
    // smallest group frame containing the focus, if it still gains enough zoom
    const fit = groups
      .filter((g) => contains(g.rect, r))
      .map((g) => clampTo(grow(g.rect, opt.margin), o))
      .filter((g) => fitZoom(g, o, aspect, opt.maxZoom) >= opt.minZoomGain)
      .sort((p, q) => p.w * p.h - q.w * q.h);
    return fit[0];
  };
  // a frame never cuts a component or a connector label at its edge: whatever it would cut is
  // taken in whole (the frame zooms out), until nothing is cut
  const obstacles: Rect[] = [
    ...doc.diagram.nodes.map((q) => ({ x: q.x, y: q.y, w: q.w, h: q.h })),
    ...connectorLabelBoxes(doc),
  ];
  const cuts = (v: Rect, r: Rect): boolean => {
    const outside = r.x + r.w <= v.x || r.y + r.h <= v.y || r.x >= v.x + v.w || r.y >= v.y + v.h;
    return !contains(v, r) && !outside;
  };
  const settled = new Map<string, CameraView>();
  /**
   * The view for a focus: the highest zoom (from the best fit down, in 3 % steps) and the
   * nearest centre (shifts of up to 20 % of the view) at which the view shows the focus with the
   * safe margin and cuts no component and no connector label at its edge. Deterministic: a fixed
   * search order. Falls back to the overview.
   */
  const frameFor = (r: Rect): CameraView => {
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    const hit = settled.get(key);
    if (hit) return hit;
    const f = frameOf(r) ?? r;
    const base = baseSize(o, aspect);
    const shifts = [0, -0.05, 0.05, -0.1, 0.1, -0.15, 0.15, -0.2, 0.2];
    let found: CameraView = overviewView(o);
    search: for (
      let z = fitZoom(f, o, aspect, opt.maxZoom, opt.safeMargin);
      z > 1.0001;
      z /= 1.03
    ) {
      const w = base.w / z;
      const h = base.h / z;
      for (const dx of shifts)
        for (const dy of shifts) {
          const v = viewRect(plan, {
            cx: f.x + f.w / 2 + dx * w,
            cy: f.y + f.h / 2 + dy * h,
            zoom: z,
          });
          // the safe margin applies where the diagram continues beyond the view; at the
          // diagram's own edge there is nothing to keep clear of
          const mx = opt.safeMargin * v.w;
          const my = opt.safeMargin * v.h;
          const x0 = v.x <= o.x + 0.5 ? v.x : v.x + mx;
          const y0 = v.y <= o.y + 0.5 ? v.y : v.y + my;
          const x1 = v.x + v.w >= o.x + o.w - 0.5 ? v.x + v.w : v.x + v.w - mx;
          const y1 = v.y + v.h >= o.y + o.h - 0.5 ? v.y + v.h : v.y + v.h - my;
          const inner = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          if (!contains(inner, f) || (opt.avoidCuts && obstacles.some((q) => cuts(v, q)))) continue;
          found = { cx: v.x + v.w / 2, cy: v.y + v.h / 2, zoom: z };
          break search;
        }
    }
    settled.set(key, found);
    return found;
  };
  const zoomOf = (r: Rect | undefined): number => (r ? frameFor(r).zoom : 1);

  const ps = pieces(acts);
  const during = (from: number, to: number): Piece[] => ps.filter((p) => p.t1 > from && p.t0 < to);
  const unionOf = (list: Piece[]): Rect | undefined =>
    list.length ? list.map((p) => p.rect).reduce(union) : undefined;
  const nodesOf = (list: Piece[]): Set<string> =>
    new Set(list.flatMap((p) => p.acts.flatMap((a) => a.nodes)));
  /**
   * The next stop, arriving at `t`: it frames everything active from the start of the transition
   * into it until its own dwell and the following transition are over (or it is the overview).
   */
  const stopAt = (t: number): Stop => {
    const list = during(t - opt.moveMs, t + opt.minDwellMs + opt.moveMs);
    const look = unionOf(list)!;
    return zoomOf(look) >= opt.minZoomGain
      ? { arrive: t, rect: look, nodes: nodesOf(list) }
      : { arrive: t, rect: undefined, nodes: new Set() };
  };

  const stops: Stop[] = [{ arrive: 0, rect: undefined, nodes: new Set() }];
  /** A packet that travels alone long enough to follow, with room to move on afterwards. */
  const lone = (p: Piece): CameraActivity | undefined => {
    if (!opt.followPackets || p.acts.length !== 1) return undefined;
    const a = p.acts[0]!;
    if (!a.follow || a.t0 !== p.t0 || a.t1 - a.t0 < opt.minDwellMs) return undefined;
    if (!during(a.t0, a.t1).every((q) => q.acts.length === 1 && q.acts[0] === a)) return undefined;
    const after = ps.find((q) => q.t0 >= a.t1);
    return !after || after.t0 >= a.t1 + opt.moveMs ? a : undefined;
  };
  /** A stop is busy until its dwell (or its followed packet) is over. */
  const busyUntil = (s: Stop): number => (s.follow ? s.follow.t1 : s.arrive + opt.minDwellMs);

  for (const p of ps) {
    const cur = stops[stops.length - 1]!;
    if (cur.follow && p.t0 < cur.follow.t1) continue; // inside the followed packet's flight
    const canMove = p.t0 - opt.moveMs >= busyUntil(cur);
    const follow = canMove ? lone(p) : undefined;
    if (follow) {
      stops.push({ arrive: p.t0, rect: follow.rect, nodes: new Set(follow.nodes), follow });
      continue;
    }
    if (cur.follow) {
      // `lone` guaranteed room to move on after the packet
      stops.push(stopAt(p.t0));
      continue;
    }
    if (cur.rect === undefined) {
      if (!canMove) continue; // the overview shows everything
      const next = stopAt(p.t0);
      if (next.rect) stops.push(next);
      continue;
    } else {
      const grown = union(cur.rect, p.rect);
      if (zoomOf(grown) >= zoomOf(cur.rect) - 1e-9 || !canMove) {
        // still fits the stop's view, or too early to move: the stop keeps everything visible
        cur.rect = zoomOf(grown) >= opt.minZoomGain ? grown : undefined;
        if (cur.rect) for (const a of p.acts) for (const id of a.nodes) cur.nodes.add(id);
        else cur.nodes.clear();
        continue;
      }
    }
    // move to a new stop that covers at least the next dwell + transition
    stops.push(stopAt(p.t0));
  }

  // end on the overview, held at least endHoldMs when the scenario is long enough
  const lastEnd = Math.max(...acts.map((a) => a.t1));
  for (;;) {
    const cur = stops[stops.length - 1]!;
    if (cur.rect === undefined && !cur.follow) break;
    const earliest = (cur.follow ? cur.follow.t1 : cur.arrive + opt.minDwellMs) + opt.moveMs;
    const latest = Math.min(durationMs - opt.endHoldMs, summaryAt);
    const arrive = Math.min(latest, Math.max(lastEnd, earliest));
    if (arrive >= earliest) {
      stops.push({ arrive, rect: undefined, nodes: new Set() });
      break;
    }
    // no room to leave this stop properly: show the overview from its start instead
    stops.pop();
    stops.push({ arrive: cur.arrive, rect: undefined, nodes: new Set() });
  }

  // merge consecutive overview stops
  const merged: Stop[] = [];
  for (const s of stops) {
    const prev = merged[merged.length - 1];
    if (prev && prev.rect === undefined && !prev.follow && s.rect === undefined && !s.follow)
      continue;
    merged.push(s);
  }

  const viewOf = (s: Stop, at: "start" | "end"): CameraView => {
    if (s.follow) {
      const z = Math.min(opt.followZoom, opt.maxZoom);
      const p = packetPoint(s.follow.follow!, at === "start" ? s.follow.t0 : s.follow.t1);
      return { cx: p.x, cy: p.y, zoom: z };
    }
    if (!s.rect) return overviewView(o);
    return frameFor(s.rect);
  };
  const focusOf = (s: Stop): string[] => (s.rect || s.follow ? [...s.nodes].sort() : ["overview"]);

  const segs: CameraSegment[] = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i]!;
    const next = merged[i + 1];
    const start = viewOf(s, "start");
    const holdEnd = next ? next.arrive - opt.moveMs : durationMs;
    const isOverview = !s.rect && !s.follow;
    if (s.follow) {
      segs.push({
        kind: "follow",
        t0: s.arrive,
        t1: s.follow.t1,
        from: start,
        to: viewOf(s, "end"),
        overview: false,
        focus: focusOf(s),
        follow: s.follow.follow!,
      });
      if (holdEnd > s.follow.t1)
        segs.push({
          kind: "hold",
          t0: s.follow.t1,
          t1: holdEnd,
          from: viewOf(s, "end"),
          to: viewOf(s, "end"),
          overview: false,
          focus: focusOf(s),
        });
    } else if (holdEnd > s.arrive)
      segs.push({
        kind: "hold",
        t0: s.arrive,
        t1: holdEnd,
        from: start,
        to: start,
        overview: isOverview,
        focus: focusOf(s),
      });
    if (next) {
      const to = viewOf(next, "start");
      segs.push({
        kind: "move",
        t0: holdEnd,
        t1: next.arrive,
        from: viewOf(s, "end"),
        to,
        overview: false,
        focus: focusOf(next),
      });
    }
  }
  plan.segments = segs;
  const stopsShown = merged.filter((s) => s.rect || s.follow).length;
  if (stopsShown === 0) return still("nothing gains enough zoom over the overview");
  plan.enabled = true;
  plan.reason = `${stopsShown} stop(s), ${merged.length - 1} transition(s)`;
  return plan;
}

// --- evaluation ----------------------------------------------------------------------------------

/** Engine packet easing (ease-in-out quadratic, Model/Easing.cpp) and position along the path. */
function packetPoint(f: FollowSpec, t: number): Point {
  const p = Math.max(0, Math.min(1, (t - f.t0) / Math.max(1, f.duration)));
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  return pointAlong(f.path, f.forward ? e : 1 - e, 0);
}

const easeCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** Camera state at instant `t` (ms). */
export function cameraViewAt(plan: CameraPlan, t: number): CameraView {
  const segs = plan.segments;
  const s = segs.find((x) => t < x.t1) ?? segs[segs.length - 1]!;
  if (s.kind === "hold") return s.from;
  if (s.kind === "follow") {
    const p = packetPoint(s.follow!, Math.min(s.t1, Math.max(s.t0, t)));
    return { cx: p.x, cy: p.y, zoom: s.from.zoom };
  }
  const k = easeCubic(Math.max(0, Math.min(1, (t - s.t0) / Math.max(1, s.t1 - s.t0))));
  // the frame's edges move linearly (on the eased clock): whatever lies inside both the start
  // and the end frame stays inside the frame for the whole transition (an interpolated zoom with
  // a linearly moving centre can briefly cut it off)
  const a = viewRect(plan, s.from);
  const b = viewRect(plan, s.to);
  const x0 = a.x + (b.x - a.x) * k;
  const y0 = a.y + (b.y - a.y) * k;
  const x1 = a.x + a.w + (b.x + b.w - (a.x + a.w)) * k;
  const y1 = a.y + a.h + (b.y + b.h - (a.y + a.h)) * k;
  const base = baseSize(toRect(plan.overview), plan.aspect);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom: base.w / (x1 - x0) };
}

/** The painter's world rectangle at `t`; exactly `plan.overview` whenever the overview is shown. */
export function cameraBoundsAt(plan: CameraPlan, t: number): Bounds {
  const segs = plan.segments;
  const s = segs.find((x) => t < x.t1) ?? segs[segs.length - 1]!;
  if (s.overview) return plan.overview;
  const r = viewRect(plan, cameraViewAt(plan, t));
  const q = (v: number): number => Math.round(v * 4) / 4;
  return [q(r.x), q(r.y), q(r.w), q(r.h)];
}
