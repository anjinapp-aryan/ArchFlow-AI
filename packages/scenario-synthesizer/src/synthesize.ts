import {
  LIMITS,
  validateCanonical,
  type CanonicalDocument,
  type CanonicalEdge,
  type CanonicalEvent,
  type CanonicalNode,
  type PacketEvent,
} from "@archflow/canonical-model";

/**
 * Deterministic scenario synthesizer: diagram -> animation scenario.
 *
 * Rules (documented in docs/architecture/SYNTHESIZER.md):
 * - Traffic starts at the entry component and follows connectors in their arrow direction
 *   (`none`/`both` connectors may be used either way).
 * - Calls to ordinary components are synchronous: request, the callee does its own work, then a
 *   response travels back on the same connector (`respondsTo`).
 * - Calls into or out of a queue/stream/topic component (or along dashed connectors) are
 *   asynchronous: an `event` packet, nobody waits; several consumers start at the same instant
 *   (parallel flows).
 * - Optional failures turn one call into a failed attempt (timeout or error), followed by
 *   retries; the caller shows `warn` while waiting and recovers.
 * - No randomness, no clock: same diagram + options = same scenario.
 */

export interface FailureSpec {
  /** Caller: node id or label. */
  from: string;
  /** Callee: node id or label. */
  to: string;
  /** `timeout` (default): the caller waits, then gives up. `error`: the call fails visibly. */
  mode?: "timeout" | "error";
  /** Number of retries; the last one succeeds. Default 1. */
  retries?: number;
}

export interface SynthesisOptions {
  /** Entry component (id or label). Default: first user/client, else first node without inbound traffic. */
  entry?: string;
  failures?: FailureSpec[];
  /** Send responses back along synchronous calls. Default true. */
  responses?: boolean;
  packetMs?: number;
  gapMs?: number;
  timeoutMs?: number;
}

export interface SynthesisIssue {
  code: string;
  message: string;
}
export type SynthesisResult =
  | { ok: true; document: CanonicalDocument; warnings: SynthesisIssue[] }
  | { ok: false; errors: SynthesisIssue[] };

const QUEUE_RE =
  /\b(kafka|queue|rabbit\s*mq|rabbitmq|sqs|sns|pub\s*\/?\s*sub|kinesis|event\s*(bus|hub|grid|stream)|topic|nats|stream|broker|mq)\b/i;

export const isQueueLike = (n: CanonicalNode): boolean =>
  n.kind === "queue" || QUEUE_RE.test(n.label);

const MAX_PACKETS = 1500;
/** Stop adding traffic past this instant so the scenario stays within the 10-minute limit. */
const TIME_CAP_MS = LIMITS.maxDurationMs - 120_000;

export function synthesizeScenario(
  input: CanonicalDocument,
  options: SynthesisOptions = {},
): SynthesisResult {
  const warnings: SynthesisIssue[] = [];
  const errors: SynthesisIssue[] = [];
  const doc: CanonicalDocument = structuredClone(input);
  const { nodes, edges } = doc.diagram;
  const packetMs = options.packetMs ?? 800;
  const gapMs = options.gapMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 1500;
  const responses = options.responses ?? true;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resolve = (ref: string, what: string): string | undefined => {
    if (byId.has(ref)) return ref;
    const lower = ref.trim().toLowerCase();
    const hit = nodes.find((n) => n.label.trim().toLowerCase() === lower);
    if (!hit)
      errors.push({
        code: "synth.unknown_node",
        message: `${what} "${ref}" is not a component of the diagram`,
      });
    return hit?.id;
  };
  if (nodes.length === 0)
    return {
      ok: false,
      errors: [{ code: "synth.empty", message: "the diagram has no components" }],
    };

  // usable directed hops: from -> to via edge
  const hops = new Map<string, { to: string; edge: CanonicalEdge }[]>();
  const add = (a: string, b: string, e: CanonicalEdge): void => {
    hops.set(a, [...(hops.get(a) ?? []), { to: b, edge: e }]);
  };
  for (const e of edges) {
    if (e.direction === "forward") add(e.from, e.to, e);
    else if (e.direction === "backward") add(e.to, e.from, e);
    else {
      add(e.from, e.to, e);
      add(e.to, e.from, e);
    }
  }
  const inbound = new Set<string>();
  for (const e of edges) {
    if (e.direction === "forward") inbound.add(e.to);
    else if (e.direction === "backward") inbound.add(e.from);
  }

  let entry: string | undefined;
  if (options.entry !== undefined) entry = resolve(options.entry, "entry");
  else
    entry =
      nodes.find((n) => (n.kind === "user" || n.kind === "client") && hops.has(n.id))?.id ??
      nodes.find((n) => !inbound.has(n.id) && hops.has(n.id))?.id ??
      nodes.find((n) => hops.has(n.id))?.id ??
      nodes[0]!.id;

  const failures = new Map<string, { mode: "timeout" | "error"; retries: number; used: boolean }>();
  for (const f of options.failures ?? []) {
    const a = resolve(f.from, "failure caller");
    const b = resolve(f.to, "failure callee");
    if (a === undefined || b === undefined) continue;
    const retries = Math.max(1, Math.min(9, Math.floor(f.retries ?? 1)));
    failures.set(`${a}>${b}`, { mode: f.mode ?? "timeout", retries, used: false });
  }
  if (errors.length > 0) return { ok: false, errors };

  const events: CanonicalEvent[] = [];
  const flows: { id: string; parentFlowId?: string; label?: string }[] = [];
  let packetCount = 0;
  let truncated = false;
  let seq = 0;
  const nextId = (p: string): string => `${p}${++seq}`;
  const newFlow = (label: string, parent?: string): string => {
    const id = `f${flows.length + 1}`;
    flows.push({
      id,
      label: label.slice(0, LIMITS.maxLabelLength),
      ...(parent ? { parentFlowId: parent } : {}),
    });
    return id;
  };
  const packet = (
    p: Omit<PacketEvent, "type" | "id" | "durationMs"> & { durationMs?: number },
  ): PacketEvent => {
    packetCount++;
    const ev: PacketEvent = { type: "packet", id: nextId("p"), durationMs: packetMs, ...p };
    events.push(ev);
    return ev;
  };
  const state = (
    nodeId: string,
    s: "active" | "warn" | "success",
    t: number,
    end: number,
    flowId: string,
    recovers?: string,
  ): string => {
    const id = nextId("s");
    events.push({
      type: "node_state",
      id,
      t,
      durationMs: Math.max(1, end - t),
      flowId,
      nodeId,
      state: s,
      ...(recovers ? { recovers } : {}),
    });
    return id;
  };
  const isAsync = (a: string, b: string, e: CanonicalEdge): boolean =>
    e.stroke !== "solid" || isQueueLike(byId.get(a)!) || isQueueLike(byId.get(b)!);
  const reached = new Set<string>([entry!]);

  /** Node `n` received work at `t` in `flow`; returns when it is done (ready to answer). */
  const visit = (n: string, t: number, flow: string, path: Set<string>): number => {
    if (packetCount > MAX_PACKETS || t > TIME_CAP_MS) {
      truncated = true;
      return t;
    }
    const out = (hops.get(n) ?? []).filter((h) => !path.has(h.to));
    // one hop per callee (first connector in document order)
    const seen = new Set<string>();
    const calls = out.filter((h) => (seen.has(h.to) ? false : (seen.add(h.to), true)));
    let cur = t;
    const asyncCalls = calls.filter((c) => isAsync(n, c.to, c.edge));
    const syncCalls = calls.filter((c) => !isAsync(n, c.to, c.edge));
    for (const c of syncCalls) {
      reached.add(c.to);
      cur = call(n, c.to, c.edge, cur, flow, path);
    }
    if (asyncCalls.length > 0) {
      for (const c of asyncCalls) {
        reached.add(c.to);
        const child =
          asyncCalls.length > 1 || !isQueueLike(byId.get(n)!)
            ? newFlow(`${byId.get(n)!.label} → ${byId.get(c.to)!.label}`, flow)
            : flow;
        const p = packet({
          t: cur,
          from: n,
          to: c.to,
          edgeId: c.edge.id,
          variant: "event",
          label: c.edge.label ?? "event",
          // a publisher's message belongs to its own flow; a queue's deliveries start the child flows
          flowId: isQueueLike(byId.get(n)!) ? child : flow,
        });
        const arrive = p.t + packetMs;
        const busyUntil = visit(c.to, arrive, child, new Set([...path, c.to]));
        active(c.to, arrive, Math.max(arrive + packetMs / 2, busyUntil), child);
      }
      cur += packetMs + gapMs; // the publisher continues once its message is out
    }
    return cur;
  };

  /** Warn intervals per node (a caller waiting on a failed call). */
  const warns = new Map<string, { id: string; t: number; end: number }[]>();
  /** Emit "active" for [t0, t1) minus the node's warn intervals; a segment right after a warning recovers it. */
  const active = (nodeId: string, t0: number, t1: number, flow: string): void => {
    let cur = t0;
    const ws = (warns.get(nodeId) ?? [])
      .filter((w) => w.end > t0 && w.t < t1)
      .sort((x, y) => x.t - y.t);
    let lastWarn: string | undefined;
    for (const w of ws) {
      if (w.t > cur) state(nodeId, "active", cur, w.t, flow, lastWarn);
      cur = Math.max(cur, w.end);
      lastWarn = w.id;
    }
    if (t1 > cur) state(nodeId, "active", cur, t1, flow, lastWarn);
  };

  /** Synchronous call a -> b starting at t; returns the time a has its answer. */
  const call = (
    a: string,
    b: string,
    e: CanonicalEdge,
    t: number,
    flow: string,
    path: Set<string>,
  ): number => {
    const fail = failures.get(`${a}>${b}`);
    let attemptStart = t;
    let previous: PacketEvent | undefined;
    if (fail && !fail.used) {
      fail.used = true;
      for (let attempt = 1; attempt <= fail.retries; attempt++) {
        const retry = attempt > 1 && fail.mode === "timeout";
        const failed = packet({
          t: attemptStart,
          from: a,
          to: b,
          edgeId: e.id,
          variant: fail.mode === "error" ? "error" : retry ? "retry" : "request",
          label:
            fail.mode === "error"
              ? attempt === 1
                ? "error"
                : "retry failed"
              : retry
                ? "retry"
                : (e.label ?? "request"),
          flowId: flow,
          ...(attempt > 1 ? { attempt } : {}),
          ...(retry ? { retryOf: previous!.id } : {}),
        });
        let failedAt = failed.t + packetMs;
        if (fail.mode === "timeout") {
          events.push({
            type: "timeout",
            id: nextId("t"),
            t: failed.t,
            durationMs: timeoutMs,
            flowId: flow,
            nodeId: a,
            waitingFor: failed.id,
            label: "timeout",
          });
          failedAt = failed.t + timeoutMs;
        }
        previous = failed;
        attemptStart = failedAt + gapMs;
      }
      const w = { id: nextId("s"), t, end: attemptStart };
      warns.set(a, [...(warns.get(a) ?? []), w]);
      events.push({
        type: "node_state",
        id: w.id,
        t,
        durationMs: Math.max(1, w.end - t),
        flowId: flow,
        nodeId: a,
        state: "warn",
        label: "retrying",
      });
    }
    const req = packet({
      t: attemptStart,
      from: a,
      to: b,
      edgeId: e.id,
      variant: previous ? "retry" : "request",
      label: previous ? "retry" : (e.label ?? "request"),
      flowId: flow,
      ...(previous ? { attempt: (previous.attempt ?? 1) + 1, retryOf: previous.id } : {}),
    });
    const arrive = req.t + packetMs;
    const done = visit(b, arrive, flow, new Set([...path, b]));
    const respondAt = Math.max(done, arrive + gapMs);
    active(b, arrive, respondAt + (responses ? packetMs / 2 : 0), flow);
    if (!responses) return respondAt;
    packet({
      t: respondAt,
      from: b,
      to: a,
      edgeId: e.id,
      variant: "response",
      label: "ok",
      flowId: flow,
      respondsTo: req.id,
    });
    return respondAt + packetMs + gapMs;
  };

  const mainFlow = newFlow(`${byId.get(entry!)!.label} request`);
  const start = 300;
  const end = visit(entry!, start, mainFlow, new Set([entry!]));
  if (truncated)
    warnings.push({
      code: "synth.truncated",
      message: `traffic was cut (more than ${MAX_PACKETS} packets or 8 minutes; the diagram has too many paths)`,
    });
  if (packetCount === 0)
    warnings.push({
      code: "synth.no_traffic",
      message: `no connector leaves the entry component "${byId.get(entry!)!.label}"`,
    });
  else if (responses) state(entry!, "success", end, end + 1500, mainFlow);
  for (const f of failures.values())
    if (!f.used)
      warnings.push({
        code: "synth.failure_not_reached",
        message: "a requested failure is on a call the traffic never makes",
      });
  for (const n of nodes)
    if (!reached.has(n.id))
      warnings.push({
        code: "synth.unreached",
        message: `"${n.label}" receives no traffic from the entry component`,
      });

  events.sort((p, q) => p.t - q.t);
  const last = Math.max(start, ...events.map((e) => e.t + e.durationMs));
  const durationMs = Math.min(
    LIMITS.maxDurationMs,
    Math.max(1000, Math.ceil((last + 1000) / 100) * 100),
  );
  if (last > LIMITS.maxDurationMs)
    return {
      ok: false,
      errors: [{ code: "synth.too_long", message: "the animation would exceed 10 minutes" }],
    };
  doc.scenario = {
    id: "synthesized",
    name: `${doc.diagram.name} (generated)`,
    diagramId: doc.diagram.id,
    durationMs,
    flows: flows.filter((f) => events.some((e) => e.flowId === f.id)),
    events,
  };
  const v = validateCanonical(doc);
  if (!v.ok)
    return {
      ok: false,
      errors: v.errors.map((e) => ({
        code: `synth.invalid_output.${e.code}`,
        message: `${e.path}: ${e.message}`,
      })),
    };
  return {
    ok: true,
    document: v.value,
    warnings: [
      ...warnings,
      ...v.warnings.map((w) => ({ code: `validation.${w.code}`, message: w.message })),
    ],
  };
}
