import type { CanonicalDocument } from "@archflow/canonical-model";
import type { EngineStep } from "./engine-document.ts";

/**
 * Dim inactive components: while something happens in the animation, components not involved in
 * it fade to 35 % opacity, and come back when they take part again.
 *
 * Built only from engine `effect` steps (node opacity keyframes): the built-in `fade-out` and
 * `fade-in` effects at intensity 0.65 (1 -> 0.35 and back) and one document-library effect that
 * holds 0.35. The engine applies effects to nodes only: connectors and packets keep full opacity.
 * A browser test proves ArchFlow's painter draws these effects exactly like the upstream player.
 */

export const DIM_OPACITY = 0.35;
export const DIM_FADE_MS = 200;
/** Shorter inactive spells are not dimmed (avoids flicker). */
export const DIM_MIN_MS = 800;

export const DIM_HOLD_EFFECT = {
  id: "archflow-dim-hold",
  label: "Dimmed (ArchFlow)",
  repeat: 1,
  tracks: [
    {
      property: "opacity",
      keys: [
        { t: 0, value: DIM_OPACITY },
        { t: 1, value: DIM_OPACITY },
      ],
    },
  ],
} as const;

type Span = [number, number];

const merge = (spans: Span[]): Span[] => {
  const s = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Span[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};

/** `outer` minus the union of `holes`. */
const subtract = (outer: Span[], holes: Span[]): Span[] => {
  const out: Span[] = [];
  for (const [a, b] of outer) {
    let cur = a;
    for (const [h0, h1] of holes) {
      if (h1 <= cur || h0 >= b) continue;
      if (h0 > cur) out.push([cur, h0]);
      cur = Math.max(cur, h1);
    }
    if (cur < b) out.push([cur, b]);
  }
  return out;
};

/**
 * Effect steps that dim each component while it is inactive and something else is active.
 * `reserve` receives every id used, so ids stay unique across the engine document.
 */
export function dimSteps(doc: CanonicalDocument, reserve: (id: string) => string): EngineStep[] {
  const events = doc.scenario?.events ?? [];
  const involved = (e: (typeof events)[number]): string[] =>
    e.type === "packet" ? [e.from, e.to] : e.type === "note" ? [] : [e.nodeId];
  const busy = merge(
    events.filter((e) => involved(e).length > 0).map((e): Span => [e.t, e.t + e.durationMs]),
  );
  const steps: EngineStep[] = [];
  for (const n of doc.diagram.nodes) {
    const own = merge(
      events.filter((e) => involved(e).includes(n.id)).map((e): Span => [e.t, e.t + e.durationMs]),
    );
    for (const [a, b] of subtract(busy, own)) {
      if (b - a < DIM_MIN_MS) continue;
      const base = `${n.id}~dim${a}`;
      steps.push(
        {
          id: reserve(`${base}-out`),
          type: "effect",
          start: a,
          duration: DIM_FADE_MS,
          nodeId: n.id,
          effect: "fade-out",
          intensity: 1 - DIM_OPACITY,
        },
        {
          id: reserve(`${base}-hold`),
          type: "effect",
          start: a + DIM_FADE_MS,
          duration: b - a - 2 * DIM_FADE_MS,
          nodeId: n.id,
          effect: DIM_HOLD_EFFECT.id,
        },
        {
          id: reserve(`${base}-in`),
          type: "effect",
          start: b - DIM_FADE_MS,
          duration: DIM_FADE_MS,
          nodeId: n.id,
          effect: "fade-in",
          intensity: 1 - DIM_OPACITY,
        },
      );
    }
  }
  return steps;
}
