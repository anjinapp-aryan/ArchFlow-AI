import type { MeasureText } from "./engine-module.ts";

/**
 * Platform-independent text metrics for golden display-list tests.
 *
 * The real player measures with the browser's fonts, which differ per OS. Using this
 * function makes the engine's display list a pure function of (document, time) on every
 * machine. It is NOT a visual approximation to ship; production uses `canvasMeasureText`.
 * Changing the constants invalidates the display-list goldens (bump METRICS_ID).
 */
export const METRICS_ID = "deterministic-v1";
export const deterministicMeasureText: MeasureText = (text, bold) => {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    units += cp < 0x80 ? (bold ? 60 : 56) : 100; // narrow ASCII, wide everything else
  }
  return units;
};
