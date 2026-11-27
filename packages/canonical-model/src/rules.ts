import type {
  CanonicalDocument,
  CanonicalEdge,
  CanonicalEvent,
  NodeStateEvent,
  PacketEvent,
  TimeoutEvent,
} from "./schema.ts";

export interface Issue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationOptions {
  /**
   * How to treat a request/retry/event packet that travels against the connector's arrow
   * (`strict` = error, `warn` = warning, `off` = ignore). Default `strict`.
   */
  directionPolicy?: "strict" | "warn" | "off";
  /** Highest allowed retry attempt number. Default 10. */
  maxRetryAttempts?: number;
}

export interface Ctx {
  doc: CanonicalDocument;
  opts: Required<ValidationOptions>;
  error(code: string, path: string, message: string): void;
  warn(code: string, path: string, message: string): void;
}

const end = (e: CanonicalEvent): number => e.t + e.durationMs;
const FAILURE_STATES = new Set(["down", "warn", "disabled"]);
const RECOVERY_STATES = new Set(["ok", "active", "success"]);
const FORWARD_VARIANTS = new Set(["request", "retry", "event"]);

interface Indexed<T> {
  ev: T;
  index: number;
}

/** Cycle detection on a parent map; returns ids that sit on a cycle. */
function cyclic(parent: Map<string, string>): Set<string> {
  const bad = new Set<string>();
  for (const start of parent.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        if (cur === start) bad.add(start);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  return bad;
}

/** Run every semantic rule. Order of issues is deterministic (document order per rule). */
export function runRules(ctx: Ctx): void {
  const { doc } = ctx;
  const { nodes, edges, groups } = doc.diagram;

  // ---- identifiers & diagram references ----
  const nodeIdx = new Map<string, number>();
  nodes.forEach((n, i) => {
    if (nodeIdx.has(n.id))
      ctx.error("ref.duplicate_id", `/diagram/nodes/${i}/id`, `duplicate node id "${n.id}"`);
    else nodeIdx.set(n.id, i);
  });
  const edgeById = new Map<string, CanonicalEdge>();
  edges.forEach((e, i) => {
    if (edgeById.has(e.id))
      ctx.error("ref.duplicate_id", `/diagram/edges/${i}/id`, `duplicate edge id "${e.id}"`);
    else edgeById.set(e.id, e);
    if (!nodeIdx.has(e.from))
      ctx.error("ref.unknown_node", `/diagram/edges/${i}/from`, `unknown node "${e.from}"`);
    if (!nodeIdx.has(e.to))
      ctx.error("ref.unknown_node", `/diagram/edges/${i}/to`, `unknown node "${e.to}"`);
    if (e.from === e.to)
      ctx.error("edge.self_loop", `/diagram/edges/${i}`, "self-loop edges are not supported");
  });
  const groupIds = new Set<string>();
  groups.forEach((g, i) => {
    if (groupIds.has(g.id))
      ctx.error("ref.duplicate_id", `/diagram/groups/${i}/id`, `duplicate group id "${g.id}"`);
    groupIds.add(g.id);
  });
  const groupParent = new Map<string, string>();
  groups.forEach((g, i) => {
    if (g.parentId === undefined) return;
    if (!groupIds.has(g.parentId))
      ctx.error(
        "ref.unknown_group",
        `/diagram/groups/${i}/parentId`,
        `unknown group "${g.parentId}"`,
      );
    else groupParent.set(g.id, g.parentId);
  });
  const badGroups = cyclic(groupParent);
  groups.forEach((g, i) => {
    if (badGroups.has(g.id))
      ctx.error(
        "group.cycle",
        `/diagram/groups/${i}/parentId`,
        `group "${g.id}" is its own ancestor`,
      );
  });
  nodes.forEach((n, i) => {
    if (n.groupId !== undefined && !groupIds.has(n.groupId))
      ctx.error("ref.unknown_group", `/diagram/nodes/${i}/groupId`, `unknown group "${n.groupId}"`);
  });
  const frameOf = new Map(groups.filter((g) => g.frame).map((g) => [g.id, g.frame!]));
  const inside = (
    r: { x: number; y: number; w: number; h: number },
    f: { x: number; y: number; w: number; h: number },
  ): boolean => r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h;
  nodes.forEach((n, i) => {
    const f = n.groupId !== undefined ? frameOf.get(n.groupId) : undefined;
    if (f && !inside(n, f))
      ctx.warn(
        "geometry.node_outside_group",
        `/diagram/nodes/${i}`,
        `node "${n.id}" is not inside the frame of its group "${n.groupId}"`,
      );
  });
  groups.forEach((g, i) => {
    const f = g.frame;
    const pf = g.parentId !== undefined ? frameOf.get(g.parentId) : undefined;
    if (f && pf && !inside(f, pf))
      ctx.warn(
        "geometry.node_outside_group",
        `/diagram/groups/${i}/frame`,
        `group "${g.id}" is not inside the frame of its parent "${g.parentId}"`,
      );
  });
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        ctx.warn(
          "geometry.nodes_overlap",
          `/diagram/nodes/${j}`,
          `node "${b.id}" overlaps node "${a.id}"`,
        );
    }
  }

  const sc = doc.scenario;
  if (!sc) return;

  if (sc.diagramId !== undefined && sc.diagramId !== doc.diagram.id)
    ctx.error(
      "ref.diagram_mismatch",
      "/scenario/diagramId",
      `scenario targets diagram "${sc.diagramId}" but the document contains "${doc.diagram.id}"`,
    );

  // ---- flows ----
  const flowIdx = new Map<string, number>();
  sc.flows.forEach((f, i) => {
    if (flowIdx.has(f.id))
      ctx.error("ref.duplicate_id", `/scenario/flows/${i}/id`, `duplicate flow id "${f.id}"`);
    else flowIdx.set(f.id, i);
  });
  const flowParent = new Map<string, string>();
  sc.flows.forEach((f, i) => {
    if (f.parentFlowId === undefined) return;
    if (!flowIdx.has(f.parentFlowId))
      ctx.error(
        "ref.unknown_flow",
        `/scenario/flows/${i}/parentFlowId`,
        `unknown flow "${f.parentFlowId}"`,
      );
    else flowParent.set(f.id, f.parentFlowId);
  });
  const badFlows = cyclic(flowParent);
  sc.flows.forEach((f, i) => {
    if (badFlows.has(f.id))
      ctx.error(
        "flow.cycle",
        `/scenario/flows/${i}/parentFlowId`,
        `flow "${f.id}" is its own ancestor`,
      );
  });

  // ---- events: ids, timing ----
  const events = sc.events;
  const byId = new Map<string, Indexed<CanonicalEvent>>();
  let unsortedReported = false;
  events.forEach((ev, index) => {
    const base = `/scenario/events/${index}`;
    if (byId.has(ev.id))
      ctx.error("ref.duplicate_id", `${base}/id`, `duplicate event id "${ev.id}"`);
    else byId.set(ev.id, { ev, index });
    if (!(ev.durationMs >= 1))
      ctx.error("event.invalid_duration", `${base}/durationMs`, "duration must be at least 1 ms");
    if (end(ev) > sc.durationMs)
      ctx.error(
        "event.beyond_scenario",
        base,
        `event ends at ${end(ev)} ms, after scenario end ${sc.durationMs} ms`,
      );
    if (ev.flowId !== undefined && !flowIdx.has(ev.flowId))
      ctx.error("ref.unknown_flow", `${base}/flowId`, `unknown flow "${ev.flowId}"`);
    const prev = events[index - 1];
    if (!unsortedReported && prev && ev.t < prev.t) {
      unsortedReported = true;
      ctx.warn("event.unsorted", base, "events are not sorted by start time; they will be sorted");
    }
  });

  const packet = (id: string): Indexed<PacketEvent> | undefined => {
    const r = byId.get(id);
    return r && r.ev.type === "packet" ? (r as Indexed<PacketEvent>) : undefined;
  };
  const flowClash = (a: CanonicalEvent, b: CanonicalEvent, path: string): void => {
    if (a.flowId !== undefined && b.flowId !== undefined && a.flowId !== b.flowId)
      ctx.error(
        "flow.mismatch",
        path,
        `event "${a.id}" is in flow "${a.flowId}" but references "${b.id}" in flow "${b.flowId}"`,
      );
  };

  // timeouts that fire for a packet (waitingFor) -> earliest expiry
  const timeoutsFor = new Map<string, Indexed<TimeoutEvent>[]>();
  events.forEach((ev, index) => {
    if (ev.type === "timeout" && ev.waitingFor !== undefined) {
      const list = timeoutsFor.get(ev.waitingFor) ?? [];
      list.push({ ev, index });
      timeoutsFor.set(ev.waitingFor, list);
    }
  });
  /** Instant at which the packet is known to have failed, or undefined if it did not fail. */
  const failedAt = (p: PacketEvent): number | undefined => {
    const ends: number[] = [];
    if (p.variant === "error") ends.push(end(p));
    for (const t of timeoutsFor.get(p.id) ?? []) ends.push(end(t.ev));
    return ends.length > 0 ? Math.min(...ends) : undefined;
  };

  // ---- node state intervals ----
  const statesByNode = new Map<string, Indexed<NodeStateEvent>[]>();
  events.forEach((ev, index) => {
    if (ev.type !== "node_state") return;
    const list = statesByNode.get(ev.nodeId) ?? [];
    list.push({ ev, index });
    statesByNode.set(ev.nodeId, list);
  });

  const responded = new Map<string, string>();
  const retried = new Map<string, string>();

  events.forEach((ev, index) => {
    const base = `/scenario/events/${index}`;
    switch (ev.type) {
      case "packet":
        packetRules(ev, base);
        break;
      case "node_state": {
        if (!nodeIdx.has(ev.nodeId))
          ctx.error("ref.unknown_node", `${base}/nodeId`, `unknown node "${ev.nodeId}"`);
        if (ev.recovers !== undefined) recoverRules(ev, base);
        break;
      }
      case "timeout": {
        if (!nodeIdx.has(ev.nodeId))
          ctx.error("ref.unknown_node", `${base}/nodeId`, `unknown node "${ev.nodeId}"`);
        if (ev.waitingFor !== undefined) timeoutRules(ev, base);
        break;
      }
      case "note":
        break;
    }
  });

  function packetRules(ev: PacketEvent, base: string): void {
    const okFrom = nodeIdx.has(ev.from);
    const okTo = nodeIdx.has(ev.to);
    if (!okFrom) ctx.error("ref.unknown_node", `${base}/from`, `unknown node "${ev.from}"`);
    if (!okTo) ctx.error("ref.unknown_node", `${base}/to`, `unknown node "${ev.to}"`);
    if (okFrom && okTo && ev.from === ev.to)
      ctx.error("packet.same_endpoints", base, "packet source and destination must differ");

    let edge: CanonicalEdge | undefined;
    if (ev.edgeId !== undefined) {
      edge = edgeById.get(ev.edgeId);
      if (!edge) ctx.error("ref.unknown_edge", `${base}/edgeId`, `unknown edge "${ev.edgeId}"`);
      else if (!(
        (edge.from === ev.from && edge.to === ev.to) ||
        (edge.from === ev.to && edge.to === ev.from)
      )) {
        ctx.error(
          "packet.edge_mismatch",
          base,
          `edge "${ev.edgeId}" does not connect "${ev.from}" and "${ev.to}"`,
        );
        edge = undefined;
      }
    } else if (okFrom && okTo) {
      const matches = edges.filter(
        (e) => (e.from === ev.from && e.to === ev.to) || (e.from === ev.to && e.to === ev.from),
      );
      if (matches.length === 0)
        ctx.error("packet.no_connector", base, `no edge connects "${ev.from}" and "${ev.to}"`);
      else if (matches.length > 1)
        ctx.error(
          "packet.ambiguous_connector",
          base,
          `${matches.length} edges connect "${ev.from}" and "${ev.to}"; set edgeId`,
        );
      else edge = matches[0];
    }

    // direction vs arrowhead
    if (edge && FORWARD_VARIANTS.has(ev.variant) && ctx.opts.directionPolicy !== "off") {
      const follows =
        edge.direction === "both" ||
        edge.direction === "none" ||
        (edge.direction === "forward" && ev.from === edge.from) ||
        (edge.direction === "backward" && ev.from === edge.to);
      if (!follows) {
        const msg = `${ev.variant} packet from "${ev.from}" to "${ev.to}" travels against the arrow of edge "${edge.id}"`;
        if (ctx.opts.directionPolicy === "strict") ctx.error("packet.against_direction", base, msg);
        else ctx.warn("packet.against_direction", base, msg);
      }
    }

    // node state interplay
    for (const [role, nodeId] of [
      ["source", ev.from],
      ["destination", ev.to],
    ] as const) {
      for (const s of statesByNode.get(nodeId) ?? []) {
        if (s.ev.t < end(ev) && ev.t < end(s.ev)) {
          if (s.ev.state === "disabled")
            ctx.error(
              "state.disabled_node_used",
              base,
              `${role} "${nodeId}" is disabled during this packet (state "${s.ev.id}")`,
            );
          else if (s.ev.state === "down")
            ctx.warn(
              "state.down_node_used",
              base,
              `${role} "${nodeId}" is down during this packet (state "${s.ev.id}")`,
            );
        }
      }
    }

    // response semantics
    if (ev.variant === "response" && ev.respondsTo === undefined)
      ctx.error("response.missing_responds_to", base, 'a "response" packet must set respondsTo');
    if (ev.respondsTo !== undefined) {
      const tgt = packet(ev.respondsTo);
      const p = `${base}/respondsTo`;
      if (ev.respondsTo === ev.id)
        ctx.error("response.self_reference", p, "packet cannot answer itself");
      else if (!byId.has(ev.respondsTo))
        ctx.error("response.unknown_target", p, `unknown event "${ev.respondsTo}"`);
      else if (!tgt)
        ctx.error("response.target_not_packet", p, `"${ev.respondsTo}" is not a packet`);
      else {
        if (tgt.ev.from !== ev.to || tgt.ev.to !== ev.from)
          ctx.error(
            "response.endpoints_not_reversed",
            p,
            `response must travel "${tgt.ev.to}" -> "${tgt.ev.from}"`,
          );
        if (ev.t < end(tgt.ev))
          ctx.error(
            "response.before_request",
            p,
            `response starts at ${ev.t} ms, before request "${tgt.ev.id}" ends at ${end(tgt.ev)} ms`,
          );
        const other = responded.get(ev.respondsTo);
        if (other !== undefined)
          ctx.error(
            "response.duplicate",
            p,
            `request "${ev.respondsTo}" already answered by "${other}"`,
          );
        else responded.set(ev.respondsTo, ev.id);
        flowClash(ev, tgt.ev, p);
      }
    }

    // retry semantics
    if (ev.variant === "retry" && ev.retryOf === undefined)
      ctx.error("retry.missing_retry_of", base, 'a "retry" packet must set retryOf');
    if (ev.retryOf !== undefined) {
      const p = `${base}/retryOf`;
      if (ev.variant !== "retry")
        ctx.error("retry.unexpected_retry_of", p, 'retryOf is only allowed on "retry" packets');
      const tgt = packet(ev.retryOf);
      if (ev.retryOf === ev.id) ctx.error("retry.self_reference", p, "packet cannot retry itself");
      else if (!byId.has(ev.retryOf))
        ctx.error("retry.unknown_target", p, `unknown event "${ev.retryOf}"`);
      else if (!tgt) ctx.error("retry.target_not_packet", p, `"${ev.retryOf}" is not a packet`);
      else {
        if (tgt.ev.from !== ev.from || tgt.ev.to !== ev.to)
          ctx.error(
            "retry.endpoint_mismatch",
            p,
            `retry must repeat "${tgt.ev.from}" -> "${tgt.ev.to}"`,
          );
        const f = failedAt(tgt.ev);
        if (f === undefined)
          ctx.error(
            "retry.target_not_failed",
            p,
            `"${tgt.ev.id}" never fails (variant "error" or a timeout waiting for it)`,
          );
        else if (ev.t < f)
          ctx.error(
            "retry.before_failure",
            p,
            `retry starts at ${ev.t} ms, before the failure is known at ${f} ms`,
          );
        const expected = (tgt.ev.attempt ?? 1) + 1;
        if (ev.attempt !== expected)
          ctx.error(
            "retry.bad_attempt",
            `${base}/attempt`,
            `attempt must be ${expected} (target attempt + 1), got ${String(ev.attempt)}`,
          );
        const other = retried.get(ev.retryOf);
        if (other !== undefined)
          ctx.error("retry.duplicate", p, `"${ev.retryOf}" is already retried by "${other}"`);
        else retried.set(ev.retryOf, ev.id);
        flowClash(ev, tgt.ev, p);
      }
    }
    if (ev.attempt !== undefined && ev.attempt > ctx.opts.maxRetryAttempts)
      ctx.error(
        "retry.too_many_attempts",
        `${base}/attempt`,
        `attempt ${ev.attempt} exceeds the limit of ${ctx.opts.maxRetryAttempts}`,
      );

    // fallback semantics
    if (ev.fallbackOf !== undefined) {
      const p = `${base}/fallbackOf`;
      const tgt = packet(ev.fallbackOf);
      if (ev.fallbackOf === ev.id)
        ctx.error("fallback.self_reference", p, "packet cannot fall back on itself");
      else if (!byId.has(ev.fallbackOf))
        ctx.error("fallback.unknown_target", p, `unknown event "${ev.fallbackOf}"`);
      else if (!tgt)
        ctx.error("fallback.target_not_packet", p, `"${ev.fallbackOf}" is not a packet`);
      else {
        if (tgt.ev.from !== ev.from)
          ctx.error("fallback.source_mismatch", p, "fallback must start at the same source");
        if (tgt.ev.to === ev.to)
          ctx.error("fallback.same_destination", p, "fallback must target a different destination");
        const f = failedAt(tgt.ev);
        if (f === undefined)
          ctx.error("fallback.target_not_failed", p, `"${tgt.ev.id}" never fails`);
        else if (ev.t < f)
          ctx.error(
            "fallback.before_failure",
            p,
            `fallback starts at ${ev.t} ms, before the failure is known at ${f} ms`,
          );
        flowClash(ev, tgt.ev, p);
      }
    }
  }

  function timeoutRules(ev: TimeoutEvent, base: string): void {
    const p = `${base}/waitingFor`;
    const tgt = packet(ev.waitingFor!);
    if (!byId.has(ev.waitingFor!))
      ctx.error("timeout.unknown_packet", p, `unknown event "${ev.waitingFor}"`);
    else if (!tgt) ctx.error("timeout.target_not_packet", p, `"${ev.waitingFor}" is not a packet`);
    else {
      if (tgt.ev.from !== ev.nodeId)
        ctx.error(
          "timeout.node_mismatch",
          `${base}/nodeId`,
          `timeout must be on the waiting node "${tgt.ev.from}"`,
        );
      if (ev.t < tgt.ev.t)
        ctx.error(
          "timeout.before_packet",
          base,
          `timeout starts at ${ev.t} ms, before packet "${tgt.ev.id}" starts at ${tgt.ev.t} ms`,
        );
      flowClash(ev, tgt.ev, p);
      for (const r of events) {
        if (r.type === "packet" && r.respondsTo === tgt.ev.id && end(r) < end(ev))
          ctx.error(
            "timeout.response_before_expiry",
            base,
            `response "${r.id}" arrives at ${end(r)} ms, before the timeout expires at ${end(ev)} ms`,
          );
      }
    }
  }

  function recoverRules(ev: NodeStateEvent, base: string): void {
    const p = `${base}/recovers`;
    const tgt = byId.get(ev.recovers!);
    if (!tgt) ctx.error("recover.unknown_target", p, `unknown event "${ev.recovers}"`);
    else if (tgt.ev.type !== "node_state")
      ctx.error("recover.target_not_state", p, `"${ev.recovers}" is not a node_state event`);
    else {
      if (tgt.ev.nodeId !== ev.nodeId)
        ctx.error("recover.node_mismatch", p, `"${tgt.ev.id}" is on node "${tgt.ev.nodeId}"`);
      if (!FAILURE_STATES.has(tgt.ev.state))
        ctx.error("recover.target_not_failure", p, `"${tgt.ev.state}" is not a failure state`);
      if (!RECOVERY_STATES.has(ev.state))
        ctx.error("recover.bad_state", `${base}/state`, `"${ev.state}" is not a recovery state`);
      if (ev.t < end(tgt.ev))
        ctx.error(
          "recover.before_failure_end",
          p,
          `recovery starts at ${ev.t} ms, before the failure ends at ${end(tgt.ev)} ms`,
        );
      flowClash(ev, tgt.ev, p);
    }
  }

  // contradictory / redundant overlapping states on one node
  for (const list of statesByNode.values()) {
    const sorted = [...list].sort((a, b) => a.ev.t - b.ev.t || a.index - b.index);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (b.ev.t >= end(a.ev)) break;
        const path = `/scenario/events/${b.index}`;
        if (a.ev.state !== b.ev.state)
          ctx.error(
            "state.contradictory_overlap",
            path,
            `node "${b.ev.nodeId}" is "${a.ev.state}" (${a.ev.id}) and "${b.ev.state}" at the same time`,
          );
        else
          ctx.warn(
            "state.redundant_overlap",
            path,
            `node "${b.ev.nodeId}" has overlapping "${b.ev.state}" states (${a.ev.id}, ${b.ev.id})`,
          );
      }
    }
  }

  // flow start ordering and empties
  const flowStart = new Map<string, number>();
  for (const ev of events)
    if (ev.flowId !== undefined)
      flowStart.set(ev.flowId, Math.min(flowStart.get(ev.flowId) ?? Infinity, ev.t));
  sc.flows.forEach((f, i) => {
    const mine = flowStart.get(f.id);
    if (mine === undefined) {
      ctx.warn("flow.empty", `/scenario/flows/${i}`, `flow "${f.id}" has no events`);
      return;
    }
    if (f.parentFlowId === undefined) return;
    const parent = flowStart.get(f.parentFlowId);
    if (parent !== undefined && mine < parent)
      ctx.error(
        "flow.starts_before_parent",
        `/scenario/flows/${i}`,
        `flow "${f.id}" starts at ${mine} ms, before parent "${f.parentFlowId}" at ${parent} ms`,
      );
  });
}
