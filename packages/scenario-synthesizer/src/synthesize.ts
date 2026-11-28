import {
  LIMITS,
  edgeInteraction,
  validateCanonical,
  type CanonicalDocument,
  type CanonicalEdge,
  type CanonicalEvent,
  type CanonicalNode,
  type PacketEvent,
} from "@archflow/canonical-model";
import { NOTE_H, diagramBox, noteObstacles, noteWidth, placeNote } from "./notes.ts";

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
 * - Monitoring connectors (health checks) are never request hops. They get their own flows:
 *   periodic probe rounds, independent of request timing. Each probe is answered "healthy"
 *   (success) or, when a failure is injected on that connector, times out / errors and marks
 *   the target "unhealthy". Intervals written in labels ("every 30s") are kept as text only.
 * - Routing components choose ONE outgoing call per request instead of calling every callee:
 *   rule routers (connector labels state conditions: path patterns like `/api/*`, `host x`,
 *   `default`) pick the first connector, in document order (rule priority), whose condition
 *   matches the request (`request` option), else the default rule; balancers (load balancers,
 *   target groups, "round-robin" connectors) pick the next healthy target.
 * - Explicit `response` connectors carry the responses of the call they answer.
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
  /**
   * The request the entry sends, e.g. `GET /api/orders` or `https://auth.app/login`. Rule
   * routers match its path and host against their connector conditions. Without it, a rule
   * router takes its default rule (reported).
   */
  request?: string;
}

/** Connector conditions of a rule router: path patterns, host patterns, default rule. */
export interface RouteRule {
  paths: string[];
  hosts: string[];
  isDefault: boolean;
}
const PATH_TOKEN = /(?:^|[\s(,;])(\/[^\s,;)]*)/g;
const HOST_TOKEN = /\bhost(?:\s+header)?\s*[:=]?\s*([^\s,;)]+)/gi;
const DEFAULT_WORD = /\b(default|fallback|catch[\s-]*all|otherwise)\b/i;
const BALANCE_WORD =
  /\b(round[\s-]*robin|weighted|least[\s-]*(?:conn\w*|outstanding\w*)|healthy\s+targets?|load[\s-]*balanc\w*)\b/i;
const BALANCER_NAME =
  /\b(load[\s-]*balancers?|[ae]lb|nlb|target[\s-]*groups?|tg|reverse[\s-]*proxy)\b/i;

/** The condition a connector label states (empty when it states none). */
export function parseRouteRule(label: string | undefined): RouteRule {
  const s = label ?? "";
  const paths = [...s.matchAll(PATH_TOKEN)].map((m) => m[1]!).filter((p) => p.length > 0);
  const hosts = [...s.matchAll(HOST_TOKEN)].map((m) => m[1]!.toLowerCase());
  return {
    paths,
    hosts,
    isDefault: paths.length === 0 && hosts.length === 0 && DEFAULT_WORD.test(s),
  };
}

const glob = (pattern: string, caseless: boolean): RegExp =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    caseless ? "i" : "",
  );

/** Path and host of a request (`GET /api/orders`, `https://auth.app/login`, `/x host a.b`). */
export function parseRequest(request: string): { path?: string; host?: string } {
  const url = /\b[a-z][a-z0-9+.-]*:\/\/([^/\s]+)(\/\S*)?/i.exec(request);
  if (url) return { host: url[1]!.toLowerCase(), path: url[2] ?? "/" };
  const path = /(?:^|\s)(\/\S*)/.exec(request)?.[1];
  const host = /\bhost\s*[:=]?\s*(\S+)/i.exec(request)?.[1]?.toLowerCase();
  return { ...(path ? { path } : {}), ...(host ? { host } : {}) };
}

/**
 * Does a connector condition match the request? Path patterns are case-sensitive, host
 * patterns are not (as in ALB listener rules); `*` and `?` are wildcards. A label naming
 * several conditions ("/auth* or host auth.app") matches when any of them does.
 */
export function ruleMatches(rule: RouteRule, req: { path?: string; host?: string }): boolean {
  return (
    (req.path !== undefined && rule.paths.some((p) => glob(p, false).test(req.path!))) ||
    (req.host !== undefined && rule.hosts.some((h) => glob(h, true).test(req.host!)))
  );
}

export interface SynthesisIssue {
  code: string;
  message: string;
}
/** One routing decision: router `router` sent the request of `flowId` to `to` only. */
export interface RoutingDecision {
  router: string;
  to: string;
  edgeId: string;
  flowId: string;
  /** `rule`: a condition matched; `default`: default (or first) rule; `balance`: next healthy target. */
  how: "rule" | "default" | "balance";
  t: number;
}
export type SynthesisResult =
  | {
      ok: true;
      document: CanonicalDocument;
      warnings: SynthesisIssue[];
      routing: RoutingDecision[];
    }
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
  const isMonitoring = (e: CanonicalEdge): boolean => edgeInteraction(e) === "monitoring";
  const isResponseEdge = (e: CanonicalEdge): boolean => edgeInteraction(e) === "response";
  const monitorEdges = edges.filter(isMonitoring);
  for (const e of edges) {
    if (isMonitoring(e) || isResponseEdge(e)) continue;
    if (e.direction === "forward") add(e.from, e.to, e);
    else if (e.direction === "backward") add(e.to, e.from, e);
    else {
      add(e.from, e.to, e);
      add(e.to, e.from, e);
    }
  }
  const inbound = new Set<string>();
  for (const e of edges) {
    if (isMonitoring(e) || isResponseEdge(e)) continue;
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
  const probeFailures = new Map<string, "timeout" | "error">();
  for (const f of options.failures ?? []) {
    const a = resolve(f.from, "failure caller");
    const b = resolve(f.to, "failure callee");
    if (a === undefined || b === undefined) continue;
    if (monitorEdges.some((e) => e.from === a && e.to === b)) {
      // a failing health check: the probes to this target fail; there is no request to retry
      probeFailures.set(`${a}>${b}`, f.mode ?? "timeout");
      if ((f.retries ?? 1) > 1)
        warnings.push({
          code: "synth.probe_retries_ignored",
          message: `"${byId.get(a)!.label} -> ${byId.get(b)!.label}" is a health check: retries do not apply (every probe round checks again)`,
        });
      continue;
    }
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
  /**
   * A packet repeats its connector's label only when the connector has none: the engine draws a
   * packet's label riding just above it, so a copy of the connector label would only cover it.
   */
  const packetLabel = (e: CanonicalEdge, fallback: string): { label?: string } =>
    e.label ? {} : { label: fallback };
  const isAsync = (a: string, b: string, e: CanonicalEdge): boolean =>
    edgeInteraction(e) === "async_message" ||
    isQueueLike(byId.get(a)!) ||
    isQueueLike(byId.get(b)!);
  /** Explicit return connector b -> a, if the diagram draws one. */
  const responseEdge = (a: string, b: string, fallback: CanonicalEdge): string =>
    edges.find(
      (e) =>
        isResponseEdge(e) &&
        ((e.from === b && e.to === a && e.direction !== "backward") ||
          (e.from === a && e.to === b && e.direction === "backward")),
    )?.id ?? fallback.id;
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
    const unhealthyAt = (id: string, at: number): boolean =>
      (unhealthySince.get(id) ?? Number.POSITIVE_INFINITY) <= at;
    const syncCalls = route(
      n,
      calls.filter((c) => !isAsync(n, c.to, c.edge)),
      cur,
      flow,
      unhealthyAt,
    );
    for (const c of syncCalls) {
      // like a load balancer: skip a target known to be unhealthy while a healthy one remains
      if (unhealthyAt(c.to, cur) && syncCalls.some((o) => o !== c && !unhealthyAt(o.to, cur))) {
        skipped(c.to, cur, flow);
        continue;
      }
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
          ...packetLabel(c.edge, "event"),
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

  type Hop = { to: string; edge: CanonicalEdge };
  /** How a component routes: rule router, balancer, or none (it calls every callee in turn). */
  const routeKind = (n: string, calls: Hop[]): "rules" | "balance" | undefined => {
    if (calls.length < 2) return undefined;
    const rules = calls.map((c) => parseRouteRule(c.edge.label));
    if (rules.some((r) => r.paths.length > 0 || r.hosts.length > 0 || r.isDefault)) return "rules";
    if (
      calls.some((c) => BALANCE_WORD.test(c.edge.label ?? "")) ||
      BALANCER_NAME.test(byId.get(n)!.label)
    )
      return "balance";
    return undefined;
  };
  const request = options.request !== undefined ? parseRequest(options.request) : undefined;
  const routeWarned = new Set<string>();
  /** Every routing decision taken (reported with the result). */
  const routing: RoutingDecision[] = [];
  /** Next target per balancer (round-robin across requests). */
  const turn = new Map<string, number>();
  /** The calls a component makes for this request: one for routers, all for other components. */
  const route = (
    n: string,
    calls: Hop[],
    t: number,
    flow: string,
    unhealthyAt: (id: string, at: number) => boolean,
  ): Hop[] => {
    const kind = routeKind(n, calls);
    if (!kind) return calls;
    const router = byId.get(n)!;
    if (kind === "rules") {
      const rules = calls.map((c) => ({ c, rule: parseRouteRule(c.edge.label) }));
      const matched = request ? rules.find((r) => ruleMatches(r.rule, request)) : undefined;
      const chosen =
        matched ?? rules.find((r) => r.rule.isDefault) ?? (request ? undefined : rules[0]);
      if (!request && !routeWarned.has(n)) {
        routeWarned.add(n);
        warnings.push({
          code: "synth.route_default",
          message: `no request given (request: GET /path): "${router.label}" sends it to "${byId.get(chosen!.c.to)!.label}" (${chosen!.rule.isDefault ? "default rule" : "first rule"})`,
        });
      }
      if (!chosen) {
        warnings.push({
          code: "synth.no_rule_matched",
          message: `no rule of "${router.label}" matches "${options.request}" and there is no default rule`,
        });
        note(`${router.label}: no rule matches`.slice(0, 500), t, 1600, flow, router);
        return [];
      }
      const cond = matched
        ? [...chosen.rule.paths, ...chosen.rule.hosts.map((h) => `host ${h}`)].join(" or ")
        : chosen.rule.isDefault
          ? "default rule"
          : "first rule";
      routing.push({
        router: n,
        to: chosen.c.to,
        edgeId: chosen.c.edge.id,
        flowId: flow,
        how: matched ? "rule" : "default",
        t,
      });
      note(`${cond} → ${byId.get(chosen.c.to)!.label}`.slice(0, 500), t, 1600, flow, router);
      return [chosen.c];
    }
    // balancer: the next target in turn that is healthy (none healthy: fail open, use it anyway)
    const k = turn.get(n) ?? 0;
    const order = calls.map((_, i) => calls[(k + i) % calls.length]!);
    const chosen = order.find((c) => !unhealthyAt(c.to, t)) ?? order[0]!;
    for (const c of order) {
      if (c === chosen) break;
      skipped(c.to, t, flow);
    }
    turn.set(n, (calls.indexOf(chosen) + 1) % calls.length);
    routing.push({
      router: n,
      to: chosen.to,
      edgeId: chosen.edge.id,
      flowId: flow,
      how: "balance",
      t,
    });
    return [chosen];
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
                : (packetLabel(e, "request").label ?? ""),
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
      ...(previous ? { label: "retry" } : packetLabel(e, "request")),
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
      edgeId: responseEdge(a, b, e),
      variant: "response",
      label: "ok",
      flowId: flow,
      respondsTo: req.id,
    });
    return respondAt + packetMs + gapMs;
  };

  const start = 300;
  const probeMs = Math.round(packetMs * 0.8);
  /** First probe round: when the probe on monitoring connector #j starts. */
  const firstProbeAt = (j: number): number => start + 200 + j * 150;
  /**
   * A target becomes known-unhealthy when its first failed probe concludes (timeout expired, or
   * the error answer arrived). Request traffic reaching it later avoids it if it can.
   */
  const unhealthySince = new Map<string, number>();
  monitorEdges.forEach((e, j) => {
    const [src, dst] = e.direction === "backward" ? [e.to, e.from] : [e.from, e.to];
    const mode = probeFailures.get(`${src}>${dst}`);
    if (!mode) return;
    const known = firstProbeAt(j) + (mode === "timeout" ? timeoutMs : 2 * probeMs + 100);
    unhealthySince.set(dst, Math.min(unhealthySince.get(dst) ?? known, known));
  });
  const obstacles = noteObstacles(doc);
  const box = diagramBox(doc);
  /** Notes already placed, with their time span (a new note avoids those shown at the same time). */
  const placed: { t0: number; t1: number; r: { x: number; y: number; w: number; h: number } }[] =
    [];
  const note = (
    text: string,
    t: number,
    durationMs: number,
    flow: string,
    near?: CanonicalNode,
  ): void => {
    const taken = placed.filter((q) => q.t0 < t + durationMs && t < q.t1).map((q) => q.r);
    const at = placeNote(text, near, obstacles, taken, box, doc.diagram.nodes.length);
    placed.push({ t0: t, t1: t + durationMs, r: { ...at, w: noteWidth(text), h: NOTE_H } });
    events.push({ type: "note", id: nextId("n"), t, durationMs, flowId: flow, text, ...at });
  };
  const skippedTargets = new Set<string>();
  const skipped = (target: string, t: number, flow: string): void => {
    const n = byId.get(target)!;
    skippedTargets.add(target);
    note(`${n.label} skipped: unhealthy`.slice(0, 500), t, 1600, flow, n);
  };
  const mainFlow = newFlow(
    `${byId.get(entry!)!.label} request${options.request ? ` ${options.request}` : ""}`,
  );
  if (options.request) note(options.request.slice(0, 500), start, 1600, mainFlow, byId.get(entry!));
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
  const succeeded = packetCount > 0 && responses && !truncated;
  // --- health checks: periodic probe rounds, independent of request traffic -------------------
  const monitorOnly = new Set(
    nodes
      .filter((n) => {
        const touching = edges.filter((e) => e.from === n.id || e.to === n.id);
        return touching.length > 0 && touching.every((e) => isMonitoring(e) && e.from === n.id);
      })
      .map((n) => n.id),
  );
  /** First moment each failing target is shown unhealthy (the state then lasts to the end). */
  const downFrom = new Map<string, { t: number; flow: string }>();
  let healthFlows = new Set<string>();
  if (monitorEdges.length > 0) {
    const reqEnd = Math.max(end, start + 4000);
    const rounds = Math.max(2, Math.min(4, Math.round((reqEnd - start) / 5000)));
    const period = Math.max(probeMs * 3 + 600, Math.floor((reqEnd - start) / rounds));
    // node states must not overlap (validator rule), so a status flash takes the next free slot
    const busy = (nodeId: string, t0: number, t1: number): number | undefined => {
      let clash: number | undefined;
      for (const ev of events) {
        const touches =
          (ev.type === "node_state" && ev.nodeId === nodeId) ||
          // request traffic at this node: an "unhealthy" flash then would contradict it
          (ev.type === "packet" &&
            !healthFlows.has(ev.flowId ?? "") &&
            (ev.from === nodeId || ev.to === nodeId));
        if (touches && ev.t < t1 && t0 < ev.t + ev.durationMs)
          clash = Math.max(clash ?? 0, ev.t + ev.durationMs);
      }
      return clash;
    };
    const freeSlot = (
      nodeId: string,
      t: number,
      dur: number,
      maxSlip: number,
    ): number | undefined => {
      let at = t;
      for (let i = 0; i < 50; i++) {
        const c = busy(nodeId, at, at + dur);
        if (c === undefined) return at;
        at = c;
        if (at - t > maxSlip) return undefined;
      }
      return undefined;
    };
    healthFlows = new Set<string>();
    for (let k = 0; k < rounds; k++) {
      const flow = newFlow(`Health check round ${k + 1}`);
      healthFlows.add(flow);
      monitorEdges.forEach((e, j) => {
        const [src, dst] = e.direction === "backward" ? [e.to, e.from] : [e.from, e.to];
        reached.add(src);
        const t = firstProbeAt(j) + k * period;
        reached.add(dst);
        const probe = packet({
          t,
          durationMs: probeMs,
          from: src,
          to: dst,
          edgeId: e.id,
          variant: "probe",
          // no packet label: the connector already says what the probe is
          flowId: flow,
        });
        const arrive = t + probeMs;
        const mode = probeFailures.get(`${src}>${dst}`);
        if (mode === "timeout") {
          events.push({
            type: "timeout",
            id: nextId("t"),
            t,
            durationMs: timeoutMs,
            flowId: flow,
            nodeId: src,
            waitingFor: probe.id,
            label: "no answer",
          });
        } else {
          packet({
            t: arrive + 100,
            durationMs: probeMs,
            from: dst,
            to: src,
            edgeId: e.id,
            variant: mode === "error" ? "error" : "success",
            ...(k === 0 ? { label: mode === "error" ? "unhealthy" : "healthy" } : {}),
            flowId: flow,
            respondsTo: probe.id,
          });
        }
        const flashAt = mode === "timeout" ? t + timeoutMs : arrive;
        if (mode) {
          // an unhealthy target stays unhealthy: one state from the first failed probe onwards
          if (!downFrom.has(dst)) {
            const at = freeSlot(dst, flashAt, 900, 1200);
            if (at !== undefined) downFrom.set(dst, { t: at, flow });
          }
          return;
        }
        const flash = freeSlot(dst, flashAt, 900, 1200);
        if (flash !== undefined)
          events.push({
            type: "node_state",
            id: nextId("s"),
            t: flash,
            durationMs: 900,
            flowId: flow,
            nodeId: dst,
            state: mode ? "down" : "success",
            label: mode ? "unhealthy" : "healthy",
          });
      });
    }
    for (const id of monitorOnly) reached.add(id);
  }

  // --- ending: final states held, and the outcome on the whole diagram -----------------------
  if (packetCount > 0) {
    const busyEnd = Math.max(start, ...events.map((e) => e.t + e.durationMs));
    const summaryAt = busyEnd + 300;
    const summaryMs = 3600;
    const finalEnd = summaryAt + summaryMs;
    const retried = [...failures.entries()].filter(([, f]) => f.used);
    const parts: string[] = [];
    const answered = events.some(
      (e) => e.type === "packet" && e.variant === "response" && e.to === entry,
    );
    if (succeeded && answered)
      parts.push(`✓ Success: ${byId.get(entry!)!.label} received its response`);
    else if (
      responses &&
      !answered &&
      events.some((e) => e.type === "packet" && e.from === entry && e.variant !== "event")
    )
      parts.push(`✗ Failed: ${byId.get(entry!)!.label} received no response`);
    else parts.push("✓ Done: every message was delivered");
    if (retried.length > 0)
      parts.push(
        retried
          .map(([k, f]) => {
            const [a, b] = k.split(">");
            return `${byId.get(a!)!.label} → ${byId.get(b!)!.label}: ${f.mode}, recovered after ${f.retries} retr${f.retries === 1 ? "y" : "ies"}`;
          })
          .join("; "),
      );
    const unhealthy = [...downFrom.keys()].map((id) => byId.get(id)!.label);
    if (unhealthy.length > 0)
      parts.push(
        `unhealthy: ${unhealthy.join(", ")}${[...skippedTargets].some((id) => downFrom.has(id)) ? " (traffic routed around it)" : ""}`,
      );
    note(parts.join(" · ").slice(0, 500), summaryAt, summaryMs, mainFlow);
    if (succeeded && answered) state(entry!, "success", end, finalEnd, mainFlow);
    for (const [id, d] of downFrom) {
      // until the end, or until the component is used again (fail-open traffic)
      let until = finalEnd;
      for (const ev of events) {
        const touches =
          (ev.type === "node_state" && ev.nodeId === id) ||
          (ev.type === "packet" &&
            !healthFlows.has(ev.flowId ?? "") &&
            (ev.from === id || ev.to === id));
        if (touches && ev.t + ev.durationMs > d.t) until = Math.min(until, Math.max(d.t + 1, ev.t));
      }
      events.push({
        type: "node_state",
        id: nextId("s"),
        t: d.t,
        durationMs: Math.max(1, until - d.t),
        flowId: d.flow,
        nodeId: id,
        state: "down",
        label: "unhealthy",
      });
    }
  }

  for (const f of failures.values())
    if (!f.used)
      warnings.push({
        code: "synth.failure_not_reached",
        message: "a requested failure is on a call the traffic never makes",
      });
  // components a router could send to, but this request does not use, are not "unreached"
  const reachable = new Set<string>([entry!]);
  for (let todo = [entry!]; todo.length > 0;) {
    const n = todo.pop()!;
    for (const h of hops.get(n) ?? [])
      if (!reachable.has(h.to)) {
        reachable.add(h.to);
        todo.push(h.to);
      }
  }
  const notTaken = nodes.filter((n) => !reached.has(n.id) && reachable.has(n.id));
  if (notTaken.length > 0 && routing.length > 0)
    warnings.push({
      code: "info.routes_not_taken",
      message: `this request is routed past ${notTaken.map((n) => `"${n.label}"`).join(", ")} (other rules or targets)`,
    });
  for (const n of nodes)
    if (!reached.has(n.id) && !(routing.length > 0 && reachable.has(n.id)))
      warnings.push({
        code: "synth.unreached",
        message: `"${n.label}" receives no traffic from the entry component`,
      });

  events.sort((p, q) => p.t - q.t);
  const last = Math.max(start, ...events.map((e) => e.t + e.durationMs));
  const durationMs = Math.min(
    LIMITS.maxDurationMs,
    // with an ending summary the animation ends with it (the summary holds the last frame)
    Math.max(1000, Math.ceil((last + (packetCount > 0 ? 0 : 1000)) / 100) * 100),
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
    routing,
    warnings: [
      ...warnings,
      ...v.warnings.map((w) => ({ code: `validation.${w.code}`, message: w.message })),
    ],
  };
}
