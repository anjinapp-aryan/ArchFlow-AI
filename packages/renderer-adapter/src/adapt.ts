import {
  TITLE_FONT_PX,
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
} from "./engine-document.ts";

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
}

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

  const nodes = diagram.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
    ...fitTitle(n.label, n.kind, n.w),
  }));

  const edges: EngineEdge[] = diagram.edges.map((e) => {
    const none = "none";
    const startHead = e.direction === "backward" || e.direction === "both" ? e.arrowHead : none;
    const endHead = e.direction === "forward" || e.direction === "both" ? e.arrowHead : none;
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.curve !== undefined ? { curve: e.curve } : {}),
      ...(e.waypoints !== undefined && e.waypoints.length > 0 ? { waypoints: e.waypoints } : {}),
      style: {
        strokeStyle: e.stroke,
        arrowEnd: endHead,
        arrowStart: startHead,
        routing: e.routing,
      },
    };
  });

  const order = scenario.events.map((ev, index) => ({ ev, index }));
  order.sort((a, b) => a.ev.t - b.ev.t || a.index - b.index);
  const steps: EngineStep[] = [];
  let usedFlow = false;
  for (const { ev } of order) {
    if (ev.flowId !== undefined) usedFlow = true;
    switch (ev.type) {
      case "packet":
        steps.push({
          id: ev.id,
          type: "message",
          start: ev.t,
          duration: ev.durationMs,
          from: ev.from,
          to: ev.to,
          ...(ev.edgeId !== undefined ? { edgeId: ev.edgeId } : {}),
          variant: ev.variant,
          label: ev.label ?? "",
          ...(ev.shape !== undefined ? { packet: ev.shape } : {}),
          ...(ev.count !== undefined && ev.count > 1 ? { packetCount: ev.count } : {}),
        });
        break;
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
 * the engine default, so their output is unchanged.
 */
export function fitTitle(label: string, kind: string, w: number): { style?: { fontSize: number } } {
  const room = titleRoom(kind, w);
  const need = titleWidth(label);
  if (need <= room) return {};
  const px = Math.max(MIN_TITLE_PX, Math.floor(((TITLE_FONT_PX * room) / need) * 2) / 2);
  return { style: { fontSize: px } };
}
