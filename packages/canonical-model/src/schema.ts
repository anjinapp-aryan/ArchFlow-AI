import * as z from "zod/mini";

/**
 * ArchFlow canonical model, version 1.
 *
 * Renderer-independent description of an architecture diagram plus an optional animation
 * scenario. It is plain JSON data. Anything an AI produces must fit this schema; there is no
 * field that carries code, expressions, URLs or file paths.
 *
 * Time is in integer-or-fractional milliseconds from scenario start. Geometry is in diagram
 * pixels (origin top-left, y down).
 */
export const CANONICAL_SCHEMA_ID = "archflow/canonical@1" as const;
/** Major version (breaking changes). Encoded in the `schema` string. */
export const CANONICAL_SCHEMA_MAJOR = 1;
/** Minor version (additive, backwards-compatible changes). Encoded in `schemaMinor`. */
export const CANONICAL_SCHEMA_MINOR = 2;

/** Hard limits: protect the engine and the browser from oversized/hostile input. */
export const LIMITS = {
  maxNodes: 500,
  maxEdges: 1500,
  maxGroups: 100,
  maxEvents: 5000,
  maxWaypoints: 32,
  maxLabelLength: 200,
  maxIdLength: 64,
  maxDurationMs: 600_000,
  minNodeSize: 20,
  maxCoordinate: 100_000,
} as const;

const finite = z.number().check(z.refine((n) => Number.isFinite(n), "must be finite"));
const coord = finite.check(z.gte(-LIMITS.maxCoordinate), z.lte(LIMITS.maxCoordinate));
const ms = finite.check(z.gte(0), z.lte(LIMITS.maxDurationMs));

/** Identifier: letters, digits, `_`, `-`, `.`, `:`; no whitespace, no markup. */
export const IdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(LIMITS.maxIdLength), z.regex(/^[A-Za-z0-9_.:-]+$/));
const Label = z.string().check(z.maxLength(LIMITS.maxLabelLength));

export const NODE_KINDS = [
  "service",
  "client",
  "gateway",
  "balancer",
  "external",
  "user",
  "db",
  "queue",
  "cache",
  "document",
  "cloud",
  "decision",
] as const;
export const NODE_STATES = ["ok", "active", "busy", "warn", "down", "success", "disabled"] as const;
export const PACKET_VARIANTS = [
  "request",
  "response",
  "retry",
  "error",
  "success",
  "event",
  /** Health-check / monitoring probe (minor 2). Travels only along `monitoring` connectors. */
  "probe",
] as const;
export const ARROW_HEADS = ["triangle", "open", "diamond", "circle", "none"] as const;
export const STROKES = ["solid", "dashed", "dotted"] as const;
export const ROUTINGS = ["curved", "straight", "orthogonal"] as const;
/**
 * What a connector means (minor 2). Absent = inferred (see `edgeInteraction`):
 * - `sync_request`: caller waits for an answer (request/response).
 * - `async_message`: fire-and-forget message or event; nobody waits.
 * - `monitoring`: periodic probe (health check, heartbeat); never part of request routing.
 * - `response`: an explicit return path drawn as its own connector.
 */
export const INTERACTIONS = ["sync_request", "async_message", "monitoring", "response"] as const;
export const PACKET_SHAPES = ["capsule", "dot", "square", "diamond", "envelope", "arrow"] as const;

export const PointSchema = z.strictObject({ x: coord, y: coord });

export const NodeSchema = z.strictObject({
  id: IdSchema,
  label: Label,
  subtitle: z.optional(Label),
  kind: z._default(z.enum(NODE_KINDS), "service"),
  x: coord,
  y: coord,
  w: finite.check(z.gte(LIMITS.minNodeSize), z.lte(2000)),
  h: finite.check(z.gte(LIMITS.minNodeSize), z.lte(2000)),
  groupId: z.optional(IdSchema),
});

export const EdgeSchema = z.strictObject({
  id: IdSchema,
  from: IdSchema,
  to: IdSchema,
  label: z.optional(Label),
  /** Which ends carry an arrowhead. `forward` = at `to`. */
  direction: z._default(z.enum(["forward", "backward", "both", "none"]), "forward"),
  arrowHead: z._default(z.enum(ARROW_HEADS), "triangle"),
  stroke: z._default(z.enum(STROKES), "solid"),
  routing: z._default(z.enum(ROUTINGS), "curved"),
  /** Curvature offset (engine units); only meaningful for `curved`. */
  curve: z.optional(finite.check(z.gte(-1), z.lte(1))),
  waypoints: z.optional(z.array(PointSchema).check(z.maxLength(LIMITS.maxWaypoints))),
  /** Connector semantics (minor 2). */
  interaction: z.optional(z.enum(INTERACTIONS)),
  /** Label anchor: fraction along the drawn path (0..1) and perpendicular offset (minor 2). */
  labelPos: z.optional(finite.check(z.gte(0), z.lte(1))),
  labelOffset: z.optional(finite.check(z.gte(-200), z.lte(200))),
});

/** Absolute rectangle (diagram pixels). Added in minor 1. */
export const FrameSchema = z.strictObject({
  x: coord,
  y: coord,
  w: finite.check(z.gt(0), z.lte(2 * LIMITS.maxCoordinate)),
  h: finite.check(z.gt(0), z.lte(2 * LIMITS.maxCoordinate)),
});

export const GroupSchema = z.strictObject({
  id: IdSchema,
  label: Label,
  parentId: z.optional(IdSchema),
  /** Container rectangle as drawn in the source diagram (minor 1, optional). */
  frame: z.optional(FrameSchema),
});

export const DiagramSchema = z.strictObject({
  id: IdSchema,
  name: Label,
  description: z.optional(z.string().check(z.maxLength(2000))),
  background: z.optional(z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/))),
  nodes: z.array(NodeSchema).check(z.maxLength(LIMITS.maxNodes)),
  edges: z.array(EdgeSchema).check(z.maxLength(LIMITS.maxEdges)),
  groups: z._default(z.array(GroupSchema).check(z.maxLength(LIMITS.maxGroups)), []),
});

const EventBase = {
  id: IdSchema,
  /** Start time (ms). */
  t: ms,
  /** Duration (ms). Must be > 0 (checked by the validator for a clear error code). */
  durationMs: ms,
  /** Logical flow this event belongs to; parallel flows overlap in time. */
  flowId: z.optional(IdSchema),
};

export const PacketEventSchema = z.strictObject({
  type: z.literal("packet"),
  ...EventBase,
  from: IdSchema,
  to: IdSchema,
  edgeId: z.optional(IdSchema),
  variant: z.enum(PACKET_VARIANTS),
  label: z.optional(Label),
  shape: z.optional(z.enum(PACKET_SHAPES)),
  /** 1..10 packets in a stream. */
  count: z.optional(z.int().check(z.gte(1), z.lte(10))),
  /** 1-based attempt number (first try = 1). A retry must be previous attempt + 1. */
  attempt: z.optional(z.int().check(z.gte(1), z.lte(50))),
  /** Packet this one answers (response/success/error). Endpoints must be reversed. */
  respondsTo: z.optional(IdSchema),
  /** Failed packet this one retries (variant `retry`). */
  retryOf: z.optional(IdSchema),
  /** Failed packet this one is a fallback for (same source, different destination). */
  fallbackOf: z.optional(IdSchema),
});

export const NodeStateEventSchema = z.strictObject({
  type: z.literal("node_state"),
  ...EventBase,
  nodeId: IdSchema,
  state: z.enum(NODE_STATES),
  label: z.optional(Label),
  /** Earlier failure state (down/warn/disabled) on the same node that this state recovers from. */
  recovers: z.optional(IdSchema),
});

export const TimeoutEventSchema = z.strictObject({
  type: z.literal("timeout"),
  ...EventBase,
  nodeId: IdSchema,
  /** Packet whose response this timeout is waiting for. */
  waitingFor: z.optional(IdSchema),
  label: z.optional(Label),
});

export const NoteEventSchema = z.strictObject({
  type: z.literal("note"),
  ...EventBase,
  text: z.string().check(z.maxLength(500)),
  x: coord,
  y: coord,
});

export const EventSchema = z.discriminatedUnion("type", [
  PacketEventSchema,
  NodeStateEventSchema,
  TimeoutEventSchema,
  NoteEventSchema,
]);

export const FlowSchema = z.strictObject({
  id: IdSchema,
  label: z.optional(Label),
  description: z.optional(z.string().check(z.maxLength(500))),
  /** Flow that spawned this one (e.g. a consumer flow spawned by a publish flow). */
  parentFlowId: z.optional(IdSchema),
});

export const ScenarioSchema = z.strictObject({
  id: IdSchema,
  name: z.optional(Label),
  /** Diagram this scenario animates; must equal `diagram.id` when present. */
  diagramId: z.optional(IdSchema),
  durationMs: finite.check(z.gte(1000), z.lte(LIMITS.maxDurationMs)),
  flows: z._default(z.array(FlowSchema).check(z.maxLength(200)), []),
  events: z.array(EventSchema).check(z.maxLength(LIMITS.maxEvents)),
});

export const CanonicalDocumentSchema = z.strictObject({
  schema: z.literal(CANONICAL_SCHEMA_ID),
  /** Additive revision within the major version. Absent = 0. */
  schemaMinor: z._default(z.int().check(z.gte(0), z.lte(CANONICAL_SCHEMA_MINOR)), 0),
  diagram: DiagramSchema,
  scenario: z.optional(ScenarioSchema),
});

export type Point = z.infer<typeof PointSchema>;
export type CanonicalNode = z.infer<typeof NodeSchema>;
export type CanonicalEdge = z.infer<typeof EdgeSchema>;
export type Interaction = (typeof INTERACTIONS)[number];

/**
 * Effective connector semantics: the explicit `interaction`, else dashed/dotted = asynchronous
 * (the behaviour before minor 2), else synchronous request.
 */
export function edgeInteraction(e: Pick<CanonicalEdge, "interaction" | "stroke">): Interaction {
  if (e.interaction !== undefined) return e.interaction;
  return e.stroke === "solid" ? "sync_request" : "async_message";
}
export type Frame = z.infer<typeof FrameSchema>;
export type CanonicalGroup = z.infer<typeof GroupSchema>;
export type CanonicalDiagram = z.infer<typeof DiagramSchema>;
export type CanonicalEvent = z.infer<typeof EventSchema>;
export type PacketEvent = z.infer<typeof PacketEventSchema>;
export type NodeStateEvent = z.infer<typeof NodeStateEventSchema>;
export type TimeoutEvent = z.infer<typeof TimeoutEventSchema>;
export type NoteEvent = z.infer<typeof NoteEventSchema>;
export type CanonicalScenario = z.infer<typeof ScenarioSchema>;
export type CanonicalDocument = z.infer<typeof CanonicalDocumentSchema>;
