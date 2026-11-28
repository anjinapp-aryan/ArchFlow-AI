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

/** Health-check probe packet: small teal arrow (points where it travels), no trail. */
export const PROBE_PACKET = {
  variant: "request",
  packet: "arrow",
  packetSize: 0.9,
  color: CONNECTOR_COLORS.monitoring,
  trail: false,
} as const;

/**
 * Packet look per meaning, so kinds never differ by colour alone (shape, trail pattern, label):
 *
 *   synchronous request   capsule, solid trail                 (engine variant colour)
 *   response              dot, solid trail, label "ok"
 *   asynchronous message  envelope, dotted trail (engine "event" variant)
 *   health-check probe    small arrow, no trail
 *   health answer         small diamond, no trail, label "healthy" / "unhealthy" on the first round
 *   failure               square, dotted trail (engine "error" variant), label "error"
 *   retry                 capsule, dashed trail (engine "retry" variant), label "retry"
 *
 * Applied only to documents that state connector interactions explicitly, like the connector
 * styles, so older documents render exactly as before. An event's own `shape` always wins.
 */
export function packetLook(
  variant: string,
  interaction: Interaction | undefined,
): { packet?: string; packetSize?: number; trail?: boolean } {
  if (interaction === "monitoring")
    return variant === "success" || variant === "error"
      ? { packet: "diamond", packetSize: 0.8, trail: false }
      : {};
  switch (variant) {
    case "response":
      return { packet: "dot" };
    case "event":
      return { packet: "envelope" };
    case "error":
      return { packet: "square" };
    default:
      return {};
  }
}
