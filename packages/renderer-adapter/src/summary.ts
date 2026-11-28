import type { CanonicalDocument } from "@archflow/canonical-model";

/**
 * Ending summary: the note that states the outcome after all traffic (written by the scenario
 * synthesizer, or any note that starts after the last packet and timeout and lasts to the end).
 *
 * The engine fades every note in over the first 12 % of its duration and out over the last
 * 12 %, so a summary that lasts to the end would fade away on the final frames. The painter
 * therefore holds this one note at full opacity once its fade-in is over, up to and including
 * the last frame (`heldNotesAt`). Ordinary notes keep the engine's fade.
 */
export interface EndingSummary {
  id: string;
  text: string;
  /** Top-left of the engine's note card (world coordinates). */
  x: number;
  y: number;
  t0: number;
  t1: number;
}

/** The engine's note fade-in share (`_DrawNote`: 12 % in, 12 % out). */
export const NOTE_FADE = 0.12;

export function endingSummary(doc: CanonicalDocument): EndingSummary | undefined {
  const s = doc.scenario;
  if (!s) return undefined;
  const trafficEnd = Math.max(
    0,
    ...s.events
      .filter((e) => e.type === "packet" || e.type === "timeout")
      .map((e) => e.t + e.durationMs),
  );
  let best: EndingSummary | undefined;
  for (const e of s.events) {
    if (e.type !== "note" || e.t < trafficEnd || e.t + e.durationMs < s.durationMs) continue;
    if (!best || e.t > best.t0)
      best = { id: e.id, text: e.text, x: e.x, y: e.y, t0: e.t, t1: e.t + e.durationMs };
  }
  return best;
}

/** Note cards the painter keeps fully opaque at instant `t` (playback and export alike). */
export function heldNotesAt(
  summary: EndingSummary | undefined,
  t: number,
): readonly { x: number; y: number }[] {
  if (!summary) return NONE;
  const faded = summary.t0 + NOTE_FADE * (summary.t1 - summary.t0);
  return t >= faded && t <= summary.t1 ? [{ x: summary.x, y: summary.y }] : NONE;
}
const NONE: readonly { x: number; y: number }[] = Object.freeze([]);
