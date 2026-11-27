import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Rect } from "@archflow/canonical-model";
import { prepare, type SourceKind } from "../src/pipeline.ts";
import { routingReport } from "./routing-report.ts";

/**
 * Regression tests for auto-layout and connector routing, over every fixture whose geometry
 * ArchFlow generates (text descriptions, Mermaid flowcharts, PlantUML component diagrams):
 * orthogonal connectors, no connector through a node, labels clear of nodes and of each other,
 * bounded crossings, deterministic output. The AWS ALB diagram is the visual regression fixture.
 */
const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

const CORPUS = [
  "01-linear",
  "02-branching",
  "03-parallel-consumers",
  "04-multiple-connectors",
  "05-bidirectional",
  "06-nested-groups",
  "07-labeled-connectors",
  "08-dashed-curved",
  "09-ambiguous-direction",
  "10-order-flow",
];

const SAMPLES: [string, SourceKind, string][] = [
  ["aws-alb.txt", "text", fx("regression/aws-alb.txt")],
  ["order-flow.txt", "text", fx("benchmark/order-flow.txt")],
  ["order-flow.sentences.txt", "text", fx("benchmark/order-flow.sentences.txt")],
  ["order-flow.mmd", "mermaid", fx("benchmark/order-flow.mmd")],
  ["14-mermaid-syntax.mmd", "mermaid", fx("diagrams/14-mermaid-syntax.mmd")],
  ["16-plantuml-component.puml", "plantuml", fx("diagrams/16-plantuml-component.puml")],
  ...CORPUS.map((n): [string, SourceKind, string] => [
    `${n}.mmd`,
    "mermaid",
    fx(`diagrams/${n}.mmd`),
  ]),
  ...CORPUS.map((n): [string, SourceKind, string] => [
    `${n}.puml`,
    "plantuml",
    fx(`diagrams/${n}.puml`),
  ]),
];

/** Crossings allowed per fixture (today's layout; fewer is fine, more is a regression). */
const MAX_CROSSINGS: Record<string, number> = {};

describe("auto-layout routing (every generated-geometry fixture)", () => {
  it.each(SAMPLES)("%s", async (name, kind, text) => {
    const r = await prepare(kind, text);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const routed = r.document.diagram.edges.filter((e) => e.routing === "orthogonal");
    expect(routed.length).toBeGreaterThan(0);
    const rep = routingReport(r.document);
    expect(rep.nonOrthogonal).toEqual([]);
    expect(rep.throughNodes).toEqual([]);
    expect(rep.labelOnNode).toEqual([]);
    expect(rep.labelOnLabel).toEqual([]);
    expect(rep.labelOnOwnPackets).toEqual([]);
    // a generated packet never repeats its connector's label (it would ride over it)
    const edgeLabel = new Map(r.document.diagram.edges.map((e) => [e.id, e.label]));
    for (const ev of r.document.scenario!.events)
      if (ev.type === "packet" && ev.edgeId !== undefined && edgeLabel.get(ev.edgeId) !== undefined)
        expect(ev.label).not.toBe(edgeLabel.get(ev.edgeId));
    expect(rep.crossings).toBeLessThanOrEqual(MAX_CROSSINGS[name] ?? 0);
    // deterministic: same input, byte-identical engine document
    const again = await prepare(kind, text);
    expect(again.ok && again.engineJson).toBe(r.engineJson);
  });
});

describe("AWS ALB regression fixture", () => {
  it("routes left to right and keeps health checks in their own band", async () => {
    const r = await prepare("text", fx("regression/aws-alb.txt"));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const d = r.document.diagram;
    const at = (label: string): Rect => d.nodes.find((n) => n.label === label)!;
    const leftOf = (a: string, b: string): boolean => at(a).x + at(a).w < at(b).x;
    expect(leftOf("Client", "ALB Listener 443")).toBe(true);
    expect(leftOf("ALB Listener 443", "Rule Engine")).toBe(true);
    for (const tg of ["Auth TG", "API TG", "Web TG"]) expect(leftOf("Rule Engine", tg)).toBe(true);
    for (const [tg, svc] of [
      ["Auth TG", "Auth Service"],
      ["API TG", "Order API"],
      ["API TG", "Payment API"],
      ["Web TG", "Frontend ECS"],
    ] as const)
      expect(leftOf(tg, svc)).toBe(true);
    // the health checker sits below every request component
    const hc = d.nodes.find((n) => n.label === "ALB Health Check")!;
    const requestBottom = Math.max(...d.nodes.filter((n) => n !== hc).map((n) => n.y + n.h));
    expect(hc.y).toBeGreaterThan(requestBottom);
    // its connectors are monitoring, never request routing
    expect(d.edges.filter((e) => e.from === hc.id).map((e) => e.interaction)).toEqual([
      "monitoring",
      "monitoring",
      "monitoring",
    ]);
    expect(routingReport(r.document).crossings).toBe(0);
    // the inference is reported, never silent
    expect(r.issues.map((i) => i.code)).toContain("text.monitoring_inferred");
  });

  it("explicit monitor: lines need no inference", async () => {
    const text = fx("regression/aws-alb.txt").replace(
      "ALB Health Check ->",
      "monitor: ALB Health Check ->",
    );
    const r = await prepare("text", text);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues.map((i) => i.code)).not.toContain("text.monitoring_inferred");
    expect(r.document.diagram.edges.filter((e) => e.interaction === "monitoring")).toHaveLength(3);
  });
});
