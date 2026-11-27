import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callPairs, detectKind, eventTimes, prepare, type SourceKind } from "../src/pipeline.ts";

const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

const SAMPLES: [string, SourceKind, string, Parameters<typeof prepare>[2]?][] = [
  ["bench text", "text", fx("benchmark/order-flow.txt")],
  ["bench sentences", "text", fx("benchmark/order-flow.sentences.txt")],
  [
    "bench mermaid",
    "mermaid",
    fx("benchmark/order-flow.mmd"),
    { failure: { from: "Consumer 1", to: "PostgreSQL" } },
  ],
  ["sequence", "mermaid", fx("diagrams/15-sequence-rich.mmd")],
  ["mermaid syntax", "mermaid", fx("diagrams/14-mermaid-syntax.mmd")],
  ["drawio order", "drawio", fx("diagrams/10-order-flow.drawio")],
  ["drawio real", "drawio", fx("diagrams/13-drawio-realworld.drawio")],
  ["puml component", "plantuml", fx("diagrams/16-plantuml-component.puml")],
  ["puml sequence", "plantuml", fx("diagrams/17-plantuml-sequence.puml")],
  ["canonical", "json", fx("scenarios/order-flow.canonical.json")],
];

describe("app pipeline", () => {
  it.each(SAMPLES)("%s prepares without errors", async (_n, kind, text, opts) => {
    const r = await prepare(kind, text, opts);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.document.scenario!.events.length).toBeGreaterThan(0);
    expect(JSON.parse(r.engineJson).version).toBe(3);
  });

  it("uses the source scenario unless asked to regenerate", async () => {
    const seq = fx("diagrams/15-sequence-rich.mmd");
    const a = await prepare("mermaid", seq);
    expect(a.ok && a.scenarioOrigin).toBe("source");
    const b = await prepare("mermaid", seq, { regenerate: true });
    expect(b.ok && b.scenarioOrigin).toBe("generated");
  });

  it("applies user options (entry + failure) to generated scenarios", async () => {
    const r = await prepare("text", "A -> B -> C", {
      failure: { from: "b", to: "c", mode: "error", retries: 2 },
    });
    if (!r.ok) throw new Error();
    expect(
      r.document.scenario!.events.filter((e) => e.type === "packet" && e.variant === "error"),
    ).toHaveLength(2);
  });

  it("reports errors for broken input", async () => {
    for (const [k, t] of [
      ["json", "{nope"],
      ["json", '{"schema":"archflow/canonical@9"}'],
      ["mermaid", "pie\n"],
      ["drawio", "<mxfile/>"],
      ["text", ""],
    ] as [SourceKind, string][]) {
      const r = await prepare(k, t);
      expect(r.ok, `${k}: ${t}`).toBe(false);
      expect(r.issues.some((i) => i.level === "error")).toBe(true);
    }
  });

  it("detects source kinds", () => {
    expect(detectKind("{}")).toBe("json");
    expect(detectKind("<mxfile/>")).toBe("drawio");
    expect(detectKind("graph TD\nA-->B")).toBe("mermaid");
    expect(detectKind("A -> B")).toBe("text");
    expect(detectKind("", "x.drawio")).toBe("drawio");
  });

  it("lists event times and callable pairs", async () => {
    const r = await prepare("text", "A -> B\nB <-> C");
    if (!r.ok) throw new Error();
    expect(eventTimes(r.document)[0]).toBe(0);
    expect(callPairs(r.diagram).map((p) => p.label)).toEqual(["A → B", "B → C", "C → B"]);
  });
});
