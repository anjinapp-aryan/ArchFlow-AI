import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertEngineSafe,
  fitTitle,
  MIN_TITLE_PX,
  serializeEngineDocument,
  toEngineDocument,
} from "../src/index.ts";

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

describe("fitTitle with a real font measurer", () => {
  // a font 30% wider than the estimate, like a wide fallback font on another OS
  const wide = (label: string, px: number): number => label.length * 9 * 1.3 * (px / 15);

  it("keeps the engine default when the measured title fits", () => {
    expect(fitTitle("API", "service", 200, wide)).toEqual({});
  });

  it("shrinks until the measured width fits the room", () => {
    const fit = fitTitle("Authentication Service", "service", 220, wide);
    const px = fit.style!.fontSize;
    expect(px).toBeLessThan(15);
    expect(px).toBeGreaterThanOrEqual(MIN_TITLE_PX);
    expect(wide("Authentication Service", px)).toBeLessThanOrEqual(220 - 50);
    expect(wide("Authentication Service", px + 0.5)).toBeGreaterThan(220 - 50);
  });

  it("never goes below the minimum size", () => {
    expect(fitTitle("x".repeat(200), "service", 120, wide)).toEqual({
      style: { fontSize: MIN_TITLE_PX },
    });
  });

  it("is used by toEngineDocument", () => {
    const doc = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/scenarios/order-flow.canonical.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const plain = toEngineDocument(doc);
    const measured = toEngineDocument(doc, { measureTitle: () => 10_000 });
    if (!plain.ok || !measured.ok) throw new Error("adapt failed");
    expect(measured.document.nodes.every((n) => n.style?.fontSize === MIN_TITLE_PX)).toBe(true);
    expect(plain.document.nodes.some((n) => n.style === undefined)).toBe(true);
  });
});

describe("connector semantics (canonical minor 2)", () => {
  const node = (id: string, x: number, y = 0): Record<string, unknown> => ({
    id,
    label: id,
    x,
    y,
    w: 100,
    h: 60,
  });
  const doc = (extra: Record<string, unknown>[] = []): Record<string, unknown> => ({
    schema: "archflow/canonical@1",
    schemaMinor: 2,
    diagram: {
      id: "d",
      name: "d",
      nodes: [node("a", 0), node("b", 300), node("c", 300, 200), node("m", 0, 300)],
      edges: [
        { id: "plain", from: "a", to: "b" },
        { id: "sync", from: "a", to: "c", interaction: "sync_request" },
        { id: "async", from: "b", to: "c", interaction: "async_message" },
        { id: "mon", from: "m", to: "c", interaction: "monitoring" },
        { id: "resp", from: "c", to: "a", interaction: "response" },
      ],
    },
    scenario: { id: "s", durationMs: 10000, events: extra },
  });
  const adapt = (d: Record<string, unknown>) => {
    const r = toEngineDocument(d);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.document;
  };

  it("styles connectors by interaction; edges without one render as before", () => {
    const e = new Map(adapt(doc()).edges.map((x) => [x.id, x.style]));
    expect(e.get("plain")).toEqual({
      strokeStyle: "solid",
      arrowEnd: "triangle",
      arrowStart: "none",
      routing: "curved",
    });
    expect(e.get("sync")!.strokeStyle).toBe("solid");
    expect(e.get("async")!.strokeStyle).toBe("dotted");
    expect(e.get("mon")).toMatchObject({ strokeStyle: "dashed", arrowEnd: "open" });
    expect(e.get("mon")!.color).toBeDefined();
    expect(e.get("resp")).toMatchObject({ strokeStyle: "dashed", arrowEnd: "open" });
    expect(e.get("resp")!.color).not.toBe(e.get("mon")!.color);
  });

  it("draws probes as small teal dots without a trail", () => {
    const d = adapt(
      doc([
        { type: "packet", id: "pr", t: 100, durationMs: 500, from: "m", to: "c", variant: "probe" },
      ]),
    );
    expect(d.scenario.steps[0]).toMatchObject({
      type: "message",
      variant: "request",
      packet: "dot",
      trail: false,
    });
  });

  it("animates an asynchronous connector only while its message travels", () => {
    const d = adapt(
      doc([
        { type: "packet", id: "ev", t: 100, durationMs: 500, from: "b", to: "c", variant: "event" },
        {
          type: "packet",
          id: "rq",
          t: 700,
          durationMs: 500,
          from: "a",
          to: "c",
          edgeId: "sync",
          variant: "request",
        },
      ]),
    );
    const links = d.scenario.steps.filter((s) => s.type === "link");
    expect(links).toEqual([
      expect.objectContaining({ edgeId: "async", start: 100, duration: 500, anim: "flow" }),
    ]);
  });

  it("turns off-centre axis-aligned end waypoints into document-unique ports", () => {
    const d = doc();
    const edges = (d.diagram as { edges: Record<string, unknown>[] }).edges;
    // a -> b leaves a's right side 15 px below centre; a -> c leaves 15 px above
    edges[0] = { ...edges[0], routing: "orthogonal", waypoints: [{ x: 200, y: 45 }] };
    edges[1] = {
      ...edges[1],
      routing: "orthogonal",
      waypoints: [
        { x: 150, y: 15 },
        { x: 150, y: 230 },
      ],
    };
    // centred waypoint: no port needed
    edges[2] = { ...edges[2], routing: "orthogonal", waypoints: [{ x: 350, y: 130 }] };
    const out = adapt(d);
    const ids = [
      ...out.nodes.flatMap((n) => [n.id, ...(n.ports ?? []).map((p) => p.id)]),
      ...out.edges.map((e) => e.id),
      ...out.scenario.steps.map((s) => s.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const a = out.nodes.find((n) => n.id === "a")!;
    expect(a.ports).toEqual([
      { id: expect.any(String), dx: 104, dy: 45 },
      { id: expect.any(String), dx: 104, dy: 15 },
    ]);
    const e = new Map(out.edges.map((x) => [x.id, x]));
    expect(e.get("plain")!.fromPort).toBe(a.ports![0]!.id);
    expect(e.get("sync")!.fromPort).toBe(a.ports![1]!.id);
    expect(e.get("async")!.fromPort).toBeUndefined();
    // every referenced port exists on its own node
    for (const x of out.edges) {
      if (x.fromPort)
        expect(out.nodes.find((n) => n.id === x.from)!.ports!.map((p) => p.id)).toContain(
          x.fromPort,
        );
      if (x.toPort)
        expect(out.nodes.find((n) => n.id === x.to)!.ports!.map((p) => p.id)).toContain(x.toPort);
    }
  });

  it("passes label anchors through", () => {
    const d = doc();
    const edges = (d.diagram as { edges: Record<string, unknown>[] }).edges;
    edges[0] = { ...edges[0], label: "x", labelPos: 0.25, labelOffset: -11 };
    const e = adapt(d).edges[0]!;
    expect([e.labelPos, e.labelOff]).toEqual([0.25, -11]);
  });
});
