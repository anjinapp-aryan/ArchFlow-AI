import type { Interaction } from "@archflow/canonical-model";
import type { EngineEdgeStyle } from "./engine-document.ts";
import type { ConnectorPalette } from "./themes.ts";

/**
 * Visual language for connector semantics (canonical `interaction`, minor 2). Applied only when a
 * document states the interaction explicitly, so documents without it render exactly as before.
 *
 *   sync_request   solid line, triangle head                (request packets: capsules)
 *   async_message  dotted line; running dashes while a message is in flight (packets: envelopes)
 *   monitoring     thin dashed teal line, open head         (probes: small teal dots, no trail)
 *   response       dashed slate line, open head             (an explicitly drawn return path)
 */
export const CONNECTOR_COLORS = {
  async: "#c084fc",
  monitoring: "#2dd4bf",
  monitoringLabel: "#5eead4",
  response: "#94a3b8",
} as const;

export function connectorStyle(
  interaction: Interaction,
  base: EngineEdgeStyle,
  colors: ConnectorPalette = CONNECTOR_COLORS,
): EngineEdgeStyle {
  switch (interaction) {
    case "sync_request":
      return { ...base, strokeStyle: "solid" };
    case "async_message":
      return { ...base, strokeStyle: "dotted" };
    case "monitoring":
      return {
        ...base,
        strokeStyle: "dashed",
        ...(base.arrowEnd !== "none" ? { arrowEnd: "open" } : {}),
        color: colors.monitoring,
        width: 1.5,
        labelColor: colors.monitoringLabel,
      };
    case "response":
      return {
        ...base,
        strokeStyle: "dashed",
        ...(base.arrowEnd !== "none" ? { arrowEnd: "open" } : {}),
        color: colors.response,
      };
  }
}

/** Health-check probe packet: small teal dot without a trail. */
export const PROBE_PACKET = {
  variant: "request",
  packet: "dot",
  packetSize: 0.8,
  color: CONNECTOR_COLORS.monitoring,
  trail: false,
} as const;
