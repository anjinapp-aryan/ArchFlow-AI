import { cameraBoundsAt, type Bounds, type CameraPlan } from "@archflow/renderer-adapter";

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

/** Plans are made per aspect ratio; this key decides when playback must re-plan after a resize. */
export const aspectKey = (width: number, height: number): string =>
  (width / Math.max(1, height)).toFixed(3);
