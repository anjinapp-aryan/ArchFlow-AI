import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCanonical } from "../src/index.ts";

const root = new URL("../../../fixtures/scenarios/", import.meta.url);
const load = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), "utf8"));

describe("canonical model: valid fixtures", () => {
  it.each(["order-flow.canonical.json", "linear-3.canonical.json"])("%s validates", (f) => {
    const r = validateCanonical(load(f));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("applies defaults (kind, direction, stroke, routing, groups)", () => {
    const r = validateCanonical({
      schema: "archflow/canonical@1",
      diagram: {
        id: "d",
        name: "d",
        nodes: [
          { id: "a", label: "A", x: 0, y: 0, w: 100, h: 50 },
          { id: "b", label: "B", x: 200, y: 0, w: 100, h: 50 },
        ],
        edges: [{ id: "e", from: "a", to: "b" }],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.diagram.nodes[0]?.kind).toBe("service");
      expect(r.value.diagram.edges[0]).toMatchObject({
        direction: "forward",
        stroke: "solid",
        routing: "curved",
      });
      expect(r.value.diagram.groups).toEqual([]);
    }
  });
});

describe("canonical model: invalid fixtures are rejected with machine-readable codes", () => {
  const expected: Record<string, string> = {
    "unknown-node.json": "ref.unknown_node",
    "unknown-edge.json": "ref.unknown_edge",
    "no-connector.json": "packet.no_connector",
    "negative-duration.json": "schema.too_small",
    "zero-duration.json": "event.invalid_duration",
    "beyond-scenario.json": "event.beyond_scenario",
    "unknown-key.json": "schema.unrecognized_keys",
    "bad-id.json": "schema.invalid_format",
    "duplicate-id.json": "ref.duplicate_id",
    "edge-self-loop.json": "edge.self_loop",
    "huge-coordinate.json": "schema.too_big",
  };
  for (const [file, code] of Object.entries(expected)) {
    it(`${file} -> ${code}`, () => {
      const r = validateCanonical(load(`invalid/${file}`));
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => e.code)).toContain(code);
      for (const e of r.errors) {
        expect(typeof e.path).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  }

  it("every invalid fixture is covered by a test", () => {
    const files = readdirSync(fileURLToPath(new URL("invalid/", root))).sort();
    const covered = new Set([...Object.keys(expected), "groups-unsupported.json"]);
    expect(files.filter((f) => !covered.has(f))).toEqual([]);
  });

  it.each([null, undefined, 42, "x", [], {}])("rejects non-document input %j", (input) => {
    expect(validateCanonical(input).ok).toBe(false);
  });

  it("rejects oversized event lists", () => {
    const doc = load("linear-3.canonical.json") as { scenario: { events: unknown[] } };
    const ev = doc.scenario.events[0];
    doc.scenario.events = Array.from({ length: 5001 }, (_, i) => ({
      ...(ev as object),
      id: `e${i}`,
    }));
    const r = validateCanonical(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "schema.too_big")).toBe(true);
  });
});
