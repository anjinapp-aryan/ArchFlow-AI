import {
  LABEL_MIN_PX,
  cameraBoundsAt,
  heldNotesAt,
  labelScale,
  type Bounds,
  type LabelBoost,
  type CameraPlan,
  type EndingSummary,
} from "@archflow/renderer-adapter";

/**
 * The world rectangle painted at instant `t`, shared by playback and video export so both frame
 * every instant identically: the automatic camera when a plan is active, otherwise the whole
 * diagram (`content`, the engine's bounds).
 */
export function cameraFrameBounds(
  content: Bounds,
  plan: CameraPlan | undefined,
  t: number,
): Bounds {
  return plan?.enabled ? cameraBoundsAt(plan, t) : content;
}

/**
 * Note cards held at full opacity at instant `t` (the ending summary, to the last frame), shared
 * by playback and video export. Independent of the camera: it applies with or without it.
 */
export function heldNotes(
  summary: EndingSummary | undefined,
  t: number,
): readonly { x: number; y: number }[] {
  return heldNotesAt(summary, t);
}

/**
 * The painter's connector-label scale function for these boosts (see renderer-adapter
 * `labels.ts`), shared by playback and export. `dpr` converts the target size to device px.
 */
export function labelScaler(
  boosts: readonly LabelBoost[],
  dpr = 1,
  minPx = LABEL_MIN_PX,
): ((text: string, x: number, y: number, sizePx: number) => number) | undefined {
  if (boosts.length === 0) return undefined;
  const byText = new Map<string, LabelBoost[]>();
  for (const b of boosts) byText.set(b.text, [...(byText.get(b.text) ?? []), b]);
  return (text, x, y, sizePx) => {
    const b = byText
      .get(text)
      ?.find((c) => Math.abs(c.cx - x) <= c.w / 2 && Math.abs(c.cy - y) <= c.h);
    return b ? labelScale(b, sizePx, minPx * dpr) : 1;
  };
}

/** Plans are made per aspect ratio; this key decides when playback must re-plan after a resize. */
export const aspectKey = (width: number, height: number): string =>
  (width / Math.max(1, height)).toFixed(3);
