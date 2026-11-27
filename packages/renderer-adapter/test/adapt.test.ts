import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertEngineSafe, serializeEngineDocument, toEngineDocument } from "../src/index.ts";

const root = new URL("../../../fixtures/scenarios/", import.meta.url);
const load = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), "utf8"));

describe("renderer adapter", () => {
  it("maps the order-flow fixture to an engine v3 document", () => {
    const r = toEngineDocument(load("order-flow.canonical.json"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.document;
    expect(d.version).toBe(3);
    expect(d.nodes).toHaveLength(8);
    expect(d.edges).toHaveLength(8);
    expect(d.scenario.steps).toHaveLength(17);
    expect(d.scenario.duration).toBe(16000);
    expect(d.edges[0]?.style).toEqual({
      strokeStyle: "solid",
      arrowEnd: "triangle",
      arrowStart: "none",
      routing: "curved",
    });
    const starts = d.scenario.steps.map((s) => s.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(r.warnings.map((w) => w.code)).toEqual(["info.flow_ids_not_rendered"]);
  });

  it("is deterministic: identical input gives identical bytes", () => {
    const a = toEngineDocument(load("order-flow.canonical.json"));
    const b = toEngineDocument(structuredClone(load("order-flow.canonical.json")));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok)
      expect(serializeEngineDocument(a.document)).toBe(serializeEngineDocument(b.document));
  });

  it("maps arrow directions", () => {
    const base = load("linear-3.canonical.json") as {
      diagram: { edges: Record<string, unknown>[] };
    };
    for (const [direction, start, end] of [
      ["forward", "none", "triangle"],
      ["backward", "triangle", "none"],
      ["both", "triangle", "triangle"],
      ["none", "none", "none"],
    ] as const) {
      const d = structuredClone(base);
      d.diagram.edges[0]!.direction = direction;
      // the scenario sends requests a -> b; this test is about arrow mapping only
      const r = toEngineDocument(d, { directionPolicy: "off" });
      expect(r.ok).toBe(true);
      if (r.ok)
        expect(r.document.edges[0]?.style).toMatchObject({ arrowStart: start, arrowEnd: end });
    }
  });

  it("rejects groups explicitly instead of letting the engine drop them", () => {
    const r = toEngineDocument(load("invalid/groups-unsupported.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("unsupported.groups");
  });

  it("rejects a document without a scenario", () => {
    const d = load("linear-3.canonical.json") as Record<string, unknown>;
    delete d["scenario"];
    const r = toEngineDocument(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported.no_scenario");
  });

  it("reports validation failures with the validation.* prefix", () => {
    const r = toEngineDocument(load("invalid/unknown-node.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => e.code.startsWith("validation."))).toBe(true);
  });

  it("maps timeout events to timers and treats label text as inert data", () => {
    const d = load("linear-3.canonical.json") as { scenario: { events: unknown[] } };
    d.scenario.events.push({
      type: "timeout",
      id: "t1",
      t: 100,
      durationMs: 2000,
      nodeId: "a",
      label: "<img onerror=x>",
    });
    const r = toEngineDocument(d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = r.document.scenario.steps.find((s) => s.id === "t1");
      expect(t).toMatchObject({ type: "timer", seconds: 2, unit: "s", label: "<img onerror=x>" });
    }
  });
});

describe("engine safety net (defence in depth behind the validator)", () => {
  const good = (): ReturnType<typeof structuredClone<import("../src/index.ts").EngineDocument>> => {
    const r = toEngineDocument(load("linear-3.canonical.json"));
    if (!r.ok) throw new Error("fixture must adapt");
    return structuredClone(r.document);
  };
  it("accepts adapter output", () => {
    expect(assertEngineSafe(good())).toEqual([]);
  });
  it.each([
    ["edge to unknown node", (d: ReturnType<typeof good>) => void (d.edges[0]!.to = "ghost")],
    ["self loop", (d: ReturnType<typeof good>) => void (d.edges[0]!.to = d.edges[0]!.from)],
    ["tiny duration", (d: ReturnType<typeof good>) => void (d.scenario.steps[0]!.duration = 0)],
    [
      "step after scenario",
      (d: ReturnType<typeof good>) => void (d.scenario.steps[0]!.start = 99999),
    ],
    [
      "duplicate step id",
      (d: ReturnType<typeof good>) => void (d.scenario.steps[1]!.id = d.scenario.steps[0]!.id),
    ],
  ])("flags: %s", (_n, mutate) => {
    const d = good();
    mutate(d);
    const errs = assertEngineSafe(d);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.every((e) => e.code === "adapter.engine_would_drop")).toBe(true);
  });
});

describe("groups: explicit flatten option", () => {
  it("flatten renders the components and reports the loss; default still rejects", () => {
    const doc = load("invalid/groups-unsupported.json");
    expect(toEngineDocument(doc).ok).toBe(false);
    const r = toEngineDocument(doc, { groups: "flatten" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toContain("info.groups_flattened");
      expect(r.document.nodes).toHaveLength(3);
    }
  });
  it("flatten does not change output for documents without groups", () => {
    const a = toEngineDocument(load("order-flow.canonical.json"));
    const b = toEngineDocument(load("order-flow.canonical.json"), { groups: "flatten" });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(serializeEngineDocument(b.document)).toBe(serializeEngineDocument(a.document));
      expect(b.warnings).toEqual(a.warnings);
    }
  });
});
