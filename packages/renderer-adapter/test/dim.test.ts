import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import {
  DIM_MIN_MS,
  serializeEngineDocument,
  toEngineDocument,
  type EngineStep,
} from "../src/index.ts";

const dir = new URL("../../../fixtures/scenarios/", import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".canonical.json"));
const load = (f: string): CanonicalDocument => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

describe("dim inactive components", () => {
  it.each(fixtures)(
    "%s: off by default (byte-identical); on: safe, unique, never dims a busy component",
    (f) => {
      const doc = load(f);
      const off = toEngineDocument(doc);
      const explicitOff = toEngineDocument(doc, { dimInactive: false });
      if (!off.ok || !explicitOff.ok) throw new Error("adapt");
      expect(serializeEngineDocument(explicitOff.document)).toBe(
        serializeEngineDocument(off.document),
      );
      expect(off.document.scenario.steps.some((s) => s.type === "effect")).toBe(false);

      const on = toEngineDocument(doc, { dimInactive: true });
      if (!on.ok) throw new Error(JSON.stringify(on.errors));
      const steps = on.document.scenario.steps;
      const fx = steps.filter(
        (s): s is Extract<EngineStep, { type: "effect" }> => s.type === "effect",
      );
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const s of fx) {
        expect(s.duration).toBeGreaterThanOrEqual(1);
        expect(s.start + s.duration).toBeLessThanOrEqual(on.document.scenario.duration);
      }
      // a component is never dimmed while one of its own events runs
      for (const ev of doc.scenario!.events) {
        const ids = ev.type === "packet" ? [ev.from, ev.to] : ev.type === "note" ? [] : [ev.nodeId];
        for (const s of fx)
          if (ids.includes(s.nodeId))
            expect(
              s.start + s.duration <= ev.t || s.start >= ev.t + ev.durationMs,
              `${s.id} vs ${ev.id}`,
            ).toBe(true);
      }
      // whole dim spells are at least DIM_MIN_MS long
      for (const s of fx.filter((x) => x.id.endsWith("-out"))) {
        const back = fx.find(
          (x) => x.nodeId === s.nodeId && x.id === s.id.replace(/-out$/, "-in"),
        )!;
        expect(back.start + back.duration - s.start).toBeGreaterThanOrEqual(DIM_MIN_MS);
      }
      if (fx.length > 0)
        expect(on.document.library?.effects?.[0]?.["id"]).toBe("archflow-dim-hold");
      // geometry unchanged
      expect(JSON.stringify(on.document.nodes)).toBe(JSON.stringify(off.document.nodes));
      expect(JSON.stringify(on.document.edges)).toBe(JSON.stringify(off.document.edges));
    },
  );

  it("dims something in the order flow", () => {
    const on = toEngineDocument(load("order-flow.canonical.json"), { dimInactive: true });
    if (!on.ok) throw new Error("adapt");
    expect(on.document.scenario.steps.filter((s) => s.type === "effect").length).toBeGreaterThan(0);
  });
});
