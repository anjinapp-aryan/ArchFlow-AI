import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  edgeInteraction,
  type CanonicalDocument,
  type PacketEvent,
} from "@archflow/canonical-model";
import { parseDescription, synthesizeScenario } from "../src/index.ts";

/** Health checks: periodic probes on monitoring connectors, never request routing. */
const ALB = readFileSync(
  new URL("../../../fixtures/regression/aws-alb.txt", import.meta.url),
  "utf8",
);

function run(text: string): { doc: CanonicalDocument; warnings: string[] } {
  const d = parseDescription(text);
  if (!d.ok || !d.document) throw new Error(JSON.stringify(d.errors));
  const s = synthesizeScenario(d.document, d.options);
  if (!s.ok) throw new Error(JSON.stringify(s.errors));
  return { doc: s.document, warnings: [...d.warnings, ...s.warnings].map((w) => w.code) };
}

const packets = (doc: CanonicalDocument): PacketEvent[] =>
  doc.scenario!.events.filter((e): e is PacketEvent => e.type === "packet");
const label = (doc: CanonicalDocument, id: string): string =>
  doc.diagram.nodes.find((n) => n.id === id)!.label;

describe("health checks", () => {
  const { doc, warnings } = run(ALB);
  const monitoring = new Set(
    doc.diagram.edges.filter((e) => edgeInteraction(e) === "monitoring").map((e) => e.id),
  );

  it("never routes application traffic over a monitoring connector", () => {
    expect(monitoring.size).toBe(3);
    for (const p of packets(doc))
      if (["request", "retry", "event", "response"].includes(p.variant))
        expect(monitoring.has(p.edgeId!)).toBe(false);
  });

  it("probes only along monitoring connectors, from the checker to its targets", () => {
    const probes = packets(doc).filter((p) => p.variant === "probe");
    expect(probes.length).toBeGreaterThanOrEqual(3 * 2); // >= 2 rounds x 3 targets
    for (const p of probes) {
      expect(monitoring.has(p.edgeId!)).toBe(true);
      expect(label(doc, p.from)).toBe("ALB Health Check");
    }
  });

  it("runs in its own flows, independent of the request flow", () => {
    const sc = doc.scenario!;
    const healthFlows = sc.flows.filter((f) => f.label?.startsWith("Health check round"));
    expect(healthFlows.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(healthFlows.map((f) => f.id));
    for (const p of packets(doc).filter((x) => x.variant === "probe"))
      expect(ids.has(p.flowId!)).toBe(true);
    // the request flow still starts at the client, never at the health checker
    const first = packets(doc).find((p) => !ids.has(p.flowId!))!;
    expect(label(doc, first.from)).toBe("Client");
  });

  it("shows healthy and unhealthy results; the injected failure makes Order API unhealthy", () => {
    const states = doc.scenario!.events.filter((e) => e.type === "node_state");
    const unhealthy = states
      .filter((s) => s.label === "unhealthy")
      .map((s) => label(doc, s.nodeId));
    const healthy = states.filter((s) => s.label === "healthy").map((s) => label(doc, s.nodeId));
    expect(new Set(unhealthy)).toEqual(new Set(["Order API"]));
    expect(healthy).toContain("Payment API");
    expect(healthy).toContain("Frontend ECS");
    expect(healthy).not.toContain("Order API");
    // a timed-out probe shows a timer on the checker, waiting for that probe
    const timeouts = doc.scenario!.events.filter((e) => e.type === "timeout");
    expect(timeouts.length).toBeGreaterThan(0);
    for (const t of timeouts) expect(label(doc, t.nodeId)).toBe("ALB Health Check");
    // the healthy targets answer on the same connector
    const answers = packets(doc).filter(
      (p) => p.variant === "success" && monitoring.has(p.edgeId!),
    );
    expect(answers.length).toBeGreaterThan(0);
  });

  it("does not invent configuration: interval text stays a label, no packet repeats it", () => {
    for (const p of packets(doc).filter((x) => x.variant === "probe"))
      expect(p.label).toBeUndefined();
    expect(doc.diagram.edges.filter((e) => monitoring.has(e.id)).map((e) => e.label)).toEqual([
      "GET /health every 30s",
      "GET /health every 30s",
      "GET /health every 30s",
    ]);
  });

  it("is deterministic and warning-free apart from the reported inference", () => {
    expect(JSON.stringify(run(ALB).doc)).toBe(JSON.stringify(doc));
    expect(warnings).toEqual(["text.monitoring_inferred"]);
  });

  it("warns when retries are asked for on a health check", () => {
    const { warnings: w } = run(ALB.replace("timeout retries 1", "timeout retries 3"));
    expect(w).toContain("synth.probe_retries_ignored");
  });

  it("a diagram without monitoring connectors gets no probes", () => {
    const { doc: plain } = run("Client -> API -> DB");
    expect(packets(plain).some((p) => p.variant === "probe")).toBe(false);
  });

  describe("routing around unhealthy targets (phase 2)", () => {
    const { doc } = run(ALB);
    const id = (l: string): string => doc.diagram.nodes.find((n) => n.label === l)!.id;
    const states = doc.scenario!.events.filter((e) => e.type === "node_state");
    const firstUnhealthy = Math.min(
      ...states
        .filter((s) => s.label === "unhealthy" && s.nodeId === id("Order API"))
        .map((s) => s.t),
    );

    it("sends no request to a target once health checks marked it unhealthy", () => {
      const toOrder = packets(doc).filter(
        (p) => p.to === id("Order API") && ["request", "retry"].includes(p.variant),
      );
      for (const p of toOrder) expect(p.t).toBeLessThan(firstUnhealthy);
    });

    it("sends the request to a healthy alternative instead, and says why", () => {
      const toPayment = packets(doc).filter(
        (p) => p.from === id("API TG") && p.to === id("Payment API") && p.variant === "request",
      );
      expect(toPayment.length).toBe(1);
      const notes = doc.scenario!.events.filter((e) => e.type === "note");
      expect(notes.map((n) => (n.type === "note" ? n.text : ""))).toEqual([
        "Order API skipped: unhealthy",
      ]);
      expect(notes[0]!.t).toBeGreaterThanOrEqual(firstUnhealthy);
    });

    it("still sends traffic when no healthy alternative remains", () => {
      const { doc: d } = run(
        ALB.replace(
          "fail: ALB Health Check -> Order API timeout retries 1",
          "fail: ALB Health Check -> Frontend ECS timeout",
        ),
      );
      const fe = d.diagram.nodes.find((n) => n.label === "Frontend ECS")!.id;
      expect(packets(d).some((p) => p.to === fe && p.variant === "request")).toBe(true);
      expect(d.scenario!.events.some((e) => e.type === "note")).toBe(false);
    });

    it("without a failing health check, every target gets traffic", () => {
      const { doc: d } = run(
        ALB.replace("fail: ALB Health Check -> Order API timeout retries 1", ""),
      );
      const order = d.diagram.nodes.find((n) => n.label === "Order API")!.id;
      expect(packets(d).some((p) => p.to === order && p.variant === "request")).toBe(true);
    });
  });
});
