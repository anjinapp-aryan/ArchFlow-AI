import {
  enginePath,
  pointAlong,
  type CanonicalDocument,
  type CanonicalEdge,
  type Point,
  type Rect,
} from "@archflow/canonical-model";
import { edgeLabelWidth } from "@archflow/diagram-importers";

/**
 * Geometry checks for routed connectors, computed exactly as the engine draws them
 * (`enginePath`, `pointAlong`): orthogonality, connectors through nodes, label collisions and
 * crossings. Shared by the routing regression tests.
 */
export interface RoutingReport {
  nonOrthogonal: string[];
  throughNodes: string[];
  labelOnNode: string[];
  labelOnLabel: string[];
  /** Label inside the corridor packets use on its own connector (7 px either side of the line). */
  labelOnOwnPackets: string[];
  crossings: number;
}

const rectOf = (d: CanonicalDocument, id: string): Rect => {
  const n = d.diagram.nodes.find((x) => x.id === id)!;
  return { x: n.x, y: n.y, w: n.w, h: n.h };
};

export const pathOf = (d: CanonicalDocument, e: CanonicalEdge): Point[] =>
  enginePath(
    rectOf(d, e.from),
    rectOf(d, e.to),
    e.waypoints ?? [],
    e.direction === "backward" || e.direction === "both",
    e.direction === "forward" || e.direction === "both",
  );

/** Half the height of a request capsule riding a connector (engine packet, size 1). */
const PACKET_HALF = 7;

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Axis-aligned segment entering the rectangle's interior. */
const segRect = (a: Point, b: Point, r: Rect): boolean => {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 < r.x + r.w - 1 && x1 > r.x + 1 && y0 < r.y + r.h - 1 && y1 > r.y + 1;
};

/** Proper crossing of a horizontal and a vertical segment (touching at an end does not count). */
const crosses = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const h1 = Math.abs(a.y - b.y) < 0.5;
  const h2 = Math.abs(c.y - d.y) < 0.5;
  if (h1 === h2) return false;
  const [hA, hB, vA, vB] = h1 ? [a, b, c, d] : [c, d, a, b];
  return (
    vA.x > Math.min(hA.x, hB.x) + 0.5 &&
    vA.x < Math.max(hA.x, hB.x) - 0.5 &&
    hA.y > Math.min(vA.y, vB.y) + 0.5 &&
    hA.y < Math.max(vA.y, vB.y) - 0.5
  );
};

export function routingReport(d: CanonicalDocument): RoutingReport {
  const out: RoutingReport = {
    nonOrthogonal: [],
    throughNodes: [],
    labelOnNode: [],
    labelOnLabel: [],
    labelOnOwnPackets: [],
    crossings: 0,
  };
  const routed = d.diagram.edges.filter((e) => e.routing === "orthogonal");
  const paths = new Map(routed.map((e) => [e.id, pathOf(d, e)]));
  const labels: { id: string; box: Rect }[] = [];
  for (const e of routed) {
    const pts = paths.get(e.id)!;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (Math.abs(a.x - b.x) > 0.6 && Math.abs(a.y - b.y) > 0.6)
        out.nonOrthogonal.push(`${e.id} segment ${i}`);
      for (const n of d.diagram.nodes)
        if (n.id !== e.from && n.id !== e.to && segRect(a, b, n))
          out.throughNodes.push(`${e.id} through ${n.id}`);
    }
    if (e.label && e.labelPos !== undefined) {
      const c = pointAlong(pts, e.labelPos, e.labelOffset ?? 10);
      const w = edgeLabelWidth(e.label);
      const box = { x: c.x - w / 2, y: c.y - 9, w, h: 18 };
      for (const n of d.diagram.nodes)
        if (overlap(box, n)) out.labelOnNode.push(`${e.id} label on ${n.id}`);
      for (const l of labels) if (overlap(box, l.box)) out.labelOnLabel.push(`${e.id}/${l.id}`);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const corridor = {
          x: Math.min(a.x, b.x) - PACKET_HALF,
          y: Math.min(a.y, b.y) - PACKET_HALF,
          w: Math.abs(a.x - b.x) + 2 * PACKET_HALF,
          h: Math.abs(a.y - b.y) + 2 * PACKET_HALF,
        };
        if (overlap(box, corridor)) {
          out.labelOnOwnPackets.push(`${e.id} segment ${i}`);
          break;
        }
      }
      labels.push({ id: e.id, box });
    }
  }
  for (let i = 0; i < routed.length; i++)
    for (let j = i + 1; j < routed.length; j++) {
      const p = paths.get(routed[i]!.id)!;
      const q = paths.get(routed[j]!.id)!;
      for (let a = 1; a < p.length; a++)
        for (let b = 1; b < q.length; b++)
          if (crosses(p[a - 1]!, p[a]!, q[b - 1]!, q[b]!)) out.crossings++;
    }
  return out;
}
