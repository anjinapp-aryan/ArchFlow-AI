import type { CanonicalDocument, CanonicalEdge, CanonicalNode } from "./schema.ts";

/**
 * Connector-semantics inference shared by every importer and the text parser.
 *
 * Explicit information always wins (an `interaction` already set, `monitor:` lines). These rules
 * only classify connectors that are clearly monitoring traffic. Every inferred decision is
 * reported by the caller, so nothing is reclassified silently.
 */

/** Connector labels that describe a probe rather than application traffic. */
const MONITORING_LABEL =
  /(\bhealth[\s_-]*checks?\b|\bhealthz\b|\/health\b|\/ready\b|\/live\b|\bliveness\b|\breadiness\b|\bheart[\s-]?beats?\b|\bprobes?\b|\bpings?\b)/i;
/** Components whose only job is monitoring other components. */
const MONITOR_NODE =
  /(\bhealth[\s_-]*check(er|s)?\b|\bmonitor(s|ing)?\b|\bheart[\s-]?beat\b|\bprober\b|\bwatchdog\b|\buptime\b|\bsynthetics?\b)/i;

export interface MonitoringReason {
  edgeId: string;
  reason: "label" | "source";
}

/** True when the connector label or its source component clearly denotes monitoring. */
export function looksLikeMonitoring(
  edgeLabel: string | undefined,
  source: Pick<CanonicalNode, "label">,
): MonitoringReason["reason"] | undefined {
  if (edgeLabel !== undefined && MONITORING_LABEL.test(edgeLabel)) return "label";
  if (MONITOR_NODE.test(source.label)) return "source";
  return undefined;
}

/**
 * Marks connectors without an explicit `interaction` as `monitoring` when the rules match.
 * Mutates `doc`; returns what was inferred so the caller can report it.
 */
export function inferMonitoringConnectors(doc: CanonicalDocument): MonitoringReason[] {
  const byId = new Map(doc.diagram.nodes.map((n) => [n.id, n]));
  const out: MonitoringReason[] = [];
  for (const e of doc.diagram.edges as CanonicalEdge[]) {
    if (e.interaction !== undefined) continue;
    const src = byId.get(e.from);
    if (!src) continue;
    const reason = looksLikeMonitoring(e.label, src);
    if (reason) {
      e.interaction = "monitoring";
      out.push({ edgeId: e.id, reason });
    }
  }
  return out;
}

/**
 * Nodes that only monitor: every connector touching them is a monitoring connector they start.
 * They are laid out in a separate band and never act as an entry point for request flows.
 */
export function monitorOnlyNodes(doc: CanonicalDocument): Set<string> {
  const touching = new Map<string, CanonicalEdge[]>();
  for (const e of doc.diagram.edges) {
    for (const id of [e.from, e.to]) touching.set(id, [...(touching.get(id) ?? []), e]);
  }
  const out = new Set<string>();
  for (const [id, es] of touching)
    if (es.every((e) => e.interaction === "monitoring" && e.from === id)) out.add(id);
  return out;
}
