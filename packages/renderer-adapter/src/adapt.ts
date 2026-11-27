import {
  TITLE_FONT_PX,
  sidePort,
  titleRoom,
  titleWidth,
  validateCanonical,
  type CanonicalDocument,
  type ValidationError,
  type ValidationOptions,
} from "@archflow/canonical-model";
import {
  ENGINE_DOCUMENT_VERSION,
  type EngineDocument,
  type EngineEdge,
  type EngineStep,
  type EngineNode,
} from "./engine-document.ts";
import { CONNECTOR_COLORS, PROBE_PACKET, connectorStyle } from "./connector-style.ts";

export interface AdaptError {
  /** `validation.*` (input invalid) or `unsupported.*` (valid input the engine cannot represent). */
  code: string;
  path: string;
  message: string;
}

export interface AdaptOptions {
  /**
   * The engine cannot draw groups. `reject` (default) refuses documents with groups;
   * `flatten` renders the components without their container frames and reports
   * `info.groups_flattened` (an explicit, visible loss, never a silent one).
   */
  groups?: "reject" | "flatten";
  /**
   * Real width (px) of `label` drawn bold at `fontPx`, as the painter will draw it. In a browser,
   * pass a canvas measurer so titles fit with the fonts actually installed (fallback fonts differ
   * by OS, e.g. DejaVu Sans on Linux is ~14% wider than Segoe UI). Without it the deterministic
   * estimate is used.
   */
  measureTitle?: TitleMeasurer;
}

export type TitleMeasurer = (label: string, fontPx: number) => number;

export type AdaptResult =
  | { ok: true; document: EngineDocument; warnings: AdaptError[] }
  | { ok: false; errors: AdaptError[] };

const fromValidation = (e: ValidationError): AdaptError => ({
  code: `validation.${e.code}`,
  path: e.path,
  message: e.message,
});

/**
 * Pure, deterministic mapping canonical model -> engine document.
 *
 * Never silently drops data that matters: features the engine cannot represent are rejected
 * with `unsupported.*` errors (the engine itself would silently normalise or erase them).
 * Information that is representable only as metadata is reported as warnings.
 */
export function toEngineDocument(
  input: unknown,
  options: ValidationOptions & AdaptOptions = {},
): AdaptResult {
  const v = validateCanonical(input, options);
  if (!v.ok) return { ok: false, errors: v.errors.map(fromValidation) };
  return adaptValidated(v.value, options);
}

export function adaptValidated(doc: CanonicalDocument, options: AdaptOptions = {}): AdaptResult {
  const errors: AdaptError[] = [];
  const warnings: AdaptError[] = [];
  const { diagram, scenario } = doc;
  const flatten = options.groups === "flatten";

  if (flatten && diagram.groups.length > 0)
    warnings.push({
      code: "info.groups_flattened",
      path: "/diagram/groups",
      message: `${diagram.groups.length} group(s) not drawn: the engine has no containers; their components are rendered`,
    });
  if (!flatten && diagram.groups.length > 0)
    errors.push({
      code: "unsupported.groups",
      path: "/diagram/groups",
      message: "groups/nested components are not supported by the engine document v3 adapter",
    });
  diagram.nodes.forEach((n, i) => {
    if (n.groupId !== undefined && !flatten)
      errors.push({
        code: "unsupported.node_group",
        path: `/diagram/nodes/${i}/groupId`,
        message: "node group membership is not supported",
      });
  });
  if (!scenario)
    errors.push({
      code: "unsupported.no_scenario",
      path: "/scenario",
      message: "the engine requires a scenario (use an empty events list for a static diagram)",
    });
  if (errors.length > 0 || !scenario) return { ok: false, errors };

  const nodes: EngineNode[] = diagram.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
    ...fitTitle(n.label, n.kind, n.w, options.measureTitle),
  }));

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const usedIds = new Set<string>([
    ...diagram.nodes.map((n) => n.id),
    ...diagram.edges.map((e) => e.id),
    ...scenario.events.flatMap((ev) => [ev.id, `${ev.id}~link`]),
  ]);
  /**
   * An orthogonal connector whose first/last waypoint is axis-aligned with a side of its node,
   * off that side's centre line, leaves/enters exactly there: the engine gets a node port. (On
   * the centre line the engine already computes that same point, so no port is added.)
   */
  const portFor = (nodeId: string, p: { x: number; y: number }): string | undefined => {
    const n = nodeById.get(nodeId)!;
    const at = sidePort(n, p);
    if (!at) return undefined;
    const onCenter =
      Math.abs(at.y - (n.y + n.h / 2)) < 0.5 || Math.abs(at.x - (n.x + n.w / 2)) < 0.5;
    if (onCenter) return undefined;
    n.ports ??= [];
    const dx = Math.round((at.x - n.x) * 100) / 100;
    const dy = Math.round((at.y - n.y) * 100) / 100;
    const existing = n.ports.find((q) => q.dx === dx && q.dy === dy);
    if (existing) return existing.id;
    // the engine makes ids unique across the whole document (nodes, ports, edges, steps) and
    // renames clashes, which would silently detach the edge: use document-unique port ids
    let id = `port:${n.id}:${n.ports.length + 1}`;
    while (usedIds.has(id)) id += "'";
    usedIds.add(id);
    n.ports.push({ id, dx, dy });
    return id;
  };
  const edges: EngineEdge[] = diagram.edges.map((e) => {
    const none = "none";
    const startHead = e.direction === "backward" || e.direction === "both" ? e.arrowHead : none;
    const endHead = e.direction === "forward" || e.direction === "both" ? e.arrowHead : none;
    const wps = e.waypoints ?? [];
    const ortho = e.routing === "orthogonal" && wps.length > 0;
    const fromPort = ortho ? portFor(e.from, wps[0]!) : undefined;
    const toPort = ortho ? portFor(e.to, wps[wps.length - 1]!) : undefined;
    const base = {
      strokeStyle: e.stroke,
      arrowEnd: endHead,
      arrowStart: startHead,
      routing: e.routing,
    };
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.curve !== undefined ? { curve: e.curve } : {}),
      ...(wps.length > 0 ? { waypoints: wps } : {}),
      ...(fromPort !== undefined ? { fromPort } : {}),
      ...(toPort !== undefined ? { toPort } : {}),
      ...(e.labelPos !== undefined ? { labelPos: e.labelPos } : {}),
      ...(e.labelOffset !== undefined ? { labelOff: e.labelOffset } : {}),
      style: e.interaction !== undefined ? connectorStyle(e.interaction, base) : base,
    };
  });
  const edgeById = new Map(diagram.edges.map((e) => [e.id, e]));
  const edgeBetween = (a: string, b: string): string | undefined =>
    diagram.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))?.id;

  const order = scenario.events.map((ev, index) => ({ ev, index }));
  order.sort((a, b) => a.ev.t - b.ev.t || a.index - b.index);
  const steps: EngineStep[] = [];
  let usedFlow = false;
  for (const { ev } of order) {
    if (ev.flowId !== undefined) usedFlow = true;
    switch (ev.type) {
      case "packet": {
        const probe = ev.variant === "probe";
        steps.push({
          id: ev.id,
          type: "message",
          start: ev.t,
          duration: ev.durationMs,
          from: ev.from,
          to: ev.to,
          ...(ev.edgeId !== undefined ? { edgeId: ev.edgeId } : {}),
          variant: probe ? PROBE_PACKET.variant : ev.variant,
          label: ev.label ?? "",
          ...(probe
            ? {
                packet: ev.shape ?? PROBE_PACKET.packet,
                packetSize: PROBE_PACKET.packetSize,
                color: PROBE_PACKET.color,
                trail: PROBE_PACKET.trail,
              }
            : ev.shape !== undefined
              ? { packet: ev.shape }
              : {}),
          ...(ev.count !== undefined && ev.count > 1 ? { packetCount: ev.count } : {}),
        });
        // an explicitly asynchronous connector shows running dashes while the message travels
        const edgeId = ev.edgeId ?? edgeBetween(ev.from, ev.to);
        if (edgeId !== undefined && edgeById.get(edgeId)?.interaction === "async_message")
          steps.push({
            id: `${ev.id}~link`,
            type: "link",
            start: ev.t,
            duration: ev.durationMs,
            edgeId,
            anim: "flow",
            color: CONNECTOR_COLORS.async,
          });
        break;
      }
      case "node_state":
        steps.push({
          id: ev.id,
          type: "state",
          start: ev.t,
          duration: ev.durationMs,
          nodeId: ev.nodeId,
          state: ev.state,
          ...(ev.label !== undefined ? { label: ev.label } : {}),
        });
        break;
      case "timeout":
        steps.push({
          id: ev.id,
          type: "timer",
          start: ev.t,
          duration: ev.durationMs,
          nodeId: ev.nodeId,
          seconds: ev.durationMs / 1000,
          unit: "s",
          label: ev.label ?? "timeout",
        });
        break;
      case "note":
        steps.push({
          id: ev.id,
          type: "note",
          start: ev.t,
          duration: ev.durationMs,
          text: ev.text,
          x: ev.x,
          y: ev.y,
        });
        break;
    }
  }
  if (usedFlow)
    warnings.push({
      code: "info.flow_ids_not_rendered",
      path: "/scenario/flows",
      message: "flowId is kept in the canonical model only; the engine has no flow concept",
    });

  const document: EngineDocument = {
    version: ENGINE_DOCUMENT_VERSION,
    meta: {
      name: diagram.name,
      ...(diagram.description !== undefined ? { description: diagram.description } : {}),
      createdAt: 0,
    },
    view: { zoom: 1, panX: 0, panY: 0 },
    ...(diagram.background !== undefined ? { scene: { background: diagram.background } } : {}),
    nodes,
    edges,
    scenario: { duration: scenario.durationMs, userDuration: true, steps },
  };
  const dropped = assertEngineSafe(document);
  if (dropped.length > 0) return { ok: false, errors: dropped };
  return { ok: true, document, warnings };
}

/**
 * Defence in depth: the engine silently repairs or erases the cases below (unknown node
 * references, self-loops, out-of-range durations/counts). The validator already rejects them;
 * this re-checks the produced engine document so a validator regression can never reach the
 * renderer unnoticed.
 */
export function assertEngineSafe(doc: EngineDocument): AdaptError[] {
  const out: AdaptError[] = [];
  const bad = (path: string, message: string): void => {
    out.push({ code: "adapter.engine_would_drop", path, message });
  };
  const nodes = new Set(doc.nodes.map((n) => n.id));
  doc.edges.forEach((e, i) => {
    if (!nodes.has(e.from) || !nodes.has(e.to))
      bad(`/edges/${i}`, "edge references an unknown node");
    if (e.from === e.to) bad(`/edges/${i}`, "self-loop edge");
  });
  const ids = new Set<string>();
  doc.scenario.steps.forEach((s, i) => {
    const p = `/scenario/steps/${i}`;
    if (ids.has(s.id)) bad(p, "duplicate step id");
    ids.add(s.id);
    if (!(s.duration >= 1)) bad(p, "duration below 1 ms");
    if (s.start + s.duration > doc.scenario.duration) bad(p, "step ends after the scenario");
    if (s.type === "message" && (!nodes.has(s.from) || !nodes.has(s.to)))
      bad(p, "message references an unknown node");
    if ((s.type === "state" || s.type === "timer") && !nodes.has(s.nodeId))
      bad(p, "step references an unknown node");
    if (s.type === "link" && !doc.edges.some((e) => e.id === s.edgeId))
      bad(p, "edge animation references an unknown edge");
  });
  return out;
}

/** Deterministic serialisation (stable key order is guaranteed by construction above). */
export function serializeEngineDocument(doc: EngineDocument): string {
  return JSON.stringify(doc);
}

/** Minimum title size the adapter will use; below this the title is left to overflow. */
export const MIN_TITLE_PX = 9;

/**
 * Titles are drawn bold 15 px by the engine. When a box from fixed geometry (draw.io, JSON) is
 * too narrow, choose the largest size (in 0.5 px steps, >= 9 px) that fits. Boxes that fit keep
 * the engine default, so their output is unchanged. With `measure`, real font widths decide;
 * without it, the deterministic estimate does.
 */
export function fitTitle(
  label: string,
  kind: string,
  w: number,
  measure?: TitleMeasurer,
): { style?: { fontSize: number } } {
  const room = titleRoom(kind, w);
  const width = measure ?? ((text: string, px: number) => titleWidth(text, px));
  const need = width(label, TITLE_FONT_PX);
  if (need <= room) return {};
  let px = Math.max(MIN_TITLE_PX, Math.floor(((TITLE_FONT_PX * room) / need) * 2) / 2);
  // real text does not scale exactly linearly (hinting, rounding): confirm and step down
  while (px > MIN_TITLE_PX && width(label, px) > room) px -= 0.5;
  return { style: { fontSize: px } };
}
