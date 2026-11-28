import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  edgeInteraction,
  type CanonicalDocument,
  type PacketEvent,
} from "@archflow/canonical-model";
import { parseDescription, synthesizeScenario } from "../src/index.ts";
import { NOTE_H, noteWidth } from "../src/notes.ts";

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
    // the rule engine sends this request to one target group only: the others are reported
    expect(warnings).toEqual(["text.monitoring_inferred", "info.routes_not_taken"]);
  });

  it("warns when retries are asked for on a health check", () => {
    const { warnings: w } = run(ALB.replace("timeout retries 1", "timeout retries 3"));
    expect(w).toContain("synth.probe_retries_ignored");
  });

  it("a diagram without monitoring connectors gets no probes", () => {
    const { doc: plain } = run("Client -> API -> DB");
    expect(packets(plain).some((p) => p.variant === "probe")).toBe(false);
  });

  describe("ending and health states (AWS ALB benchmark)", () => {
    const end = doc.scenario!.durationMs;
    const order = doc.diagram.nodes.find((n) => n.label === "Order API")!.id;
    const client = doc.diagram.nodes.find((n) => n.label === "Client")!.id;

    it("an unhealthy target stays unhealthy until the end (no flashing back to normal)", () => {
      const down = doc.scenario!.events.filter(
        (e) => e.type === "node_state" && e.nodeId === order && e.state === "down",
      );
      expect(down).toHaveLength(1);
      expect(down[0]!.t + down[0]!.durationMs).toBe(end);
      expect(down[0]!.type === "node_state" && down[0]!.label).toBe("unhealthy");
    });

    it("ends with the entry's final state and a summary that states the outcome in words", () => {
      const ok = doc.scenario!.events.find(
        (e) => e.type === "node_state" && e.nodeId === client && e.state === "success",
      )!;
      expect(ok.t + ok.durationMs).toBe(end);
      const summary = doc.scenario!.events.filter((e) => e.type === "note").at(-1)!;
      if (summary.type !== "note") throw new Error("no summary");
      expect(summary.text).toMatch(/^✓ Success: Client received its response/);
      expect(summary.text).toContain("unhealthy: Order API (traffic routed around it)");
      // it is the last thing that starts, and it lasts to the end
      expect(Math.max(...doc.scenario!.events.map((e) => e.t))).toBe(summary.t);
      expect(summary.t + summary.durationMs).toBe(end);
    });

    it("reports a recovered failure in the summary", () => {
      const { doc: d } = run("A -> B -> C\nfail: B -> C timeout retries 2\n");
      const s = d.scenario!.events.filter((e) => e.type === "note").at(-1)!;
      expect(s.type === "note" && s.text).toMatch(
        /^✓ Success: A received its response · B → C: timeout, recovered after 2 retries/,
      );
    });

    it("an asynchronous-only scenario ends with a delivery summary", () => {
      const { doc: d } = run("Producer ..> Queue\nQueue ..> Worker\n");
      const s = d.scenario!.events.filter((e) => e.type === "note").at(-1)!;
      expect(s.type === "note" && s.text).toMatch(/^✓ Done: every message was delivered/);
    });

    it("notes cover no component, stay on screen and never overlap each other", () => {
      const notes = doc.scenario!.events.filter((e) => e.type === "note");
      const ns = doc.diagram.nodes;
      const wx = doc.diagram.edges.flatMap((e) => (e.waypoints ?? []).map((p) => p.x));
      const wy = doc.diagram.edges.flatMap((e) => (e.waypoints ?? []).map((p) => p.y));
      const box = {
        x0: Math.min(...ns.map((n) => n.x), ...wx) - 60,
        y0: Math.min(...ns.map((n) => n.y), ...wy) - 60,
        x1: Math.max(...ns.map((n) => n.x + n.w), ...wx) + 60,
        y1: Math.max(...ns.map((n) => n.y + n.h), ...wy) + 60,
      };
      const rects = notes.map((n) => {
        if (n.type !== "note") throw new Error("not a note");
        return { x: n.x, y: n.y, w: noteWidth(n.text), h: NOTE_H, t0: n.t, t1: n.t + n.durationMs };
      });
      expect(rects.length).toBeGreaterThanOrEqual(2);
      for (const r of rects) {
        expect(r.x >= box.x0 && r.y >= box.y0 && r.x + r.w <= box.x1 && r.y + r.h <= box.y1).toBe(
          true,
        );
        for (const n of ns)
          expect(
            r.x < n.x + n.w && n.x < r.x + r.w && r.y < n.y + n.h && n.y < r.y + r.h,
            n.id,
          ).toBe(false);
      }
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!;
          const b = rects[j]!;
          const sameTime = a.t0 < b.t1 && b.t0 < a.t1;
          const meet = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(sameTime && meet).toBe(false);
        }
    });
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
      // the other notes: the request, the matched rule and the ending summary
      const notes = doc.scenario!.events.filter((e) => e.type === "note");
      expect(notes.map((n) => (n.type === "note" ? n.text : ""))).toEqual([
        "GET /api/orders",
        "/api/* → API TG",
        "Order API skipped: unhealthy",
        "✓ Success: Client received its response · unhealthy: Order API (traffic routed around it)",
      ]);
      expect(notes[2]!.t).toBeGreaterThanOrEqual(firstUnhealthy);
    });

    it("still sends traffic when no healthy alternative remains", () => {
      // GET / takes the default rule to Web TG, whose only target is Frontend ECS
      const { doc: d } = run(
        ALB.replace("request: GET /api/orders", "request: GET /").replace(
          "fail: ALB Health Check -> Order API timeout retries 1",
          "fail: ALB Health Check -> Frontend ECS timeout",
        ),
      );
      const fe = d.diagram.nodes.find((n) => n.label === "Frontend ECS")!.id;
      expect(packets(d).some((p) => p.to === fe && p.variant === "request")).toBe(true);
      expect(d.scenario!.events.some((e) => e.type === "note" && e.text.includes("skipped"))).toBe(
        false,
      );
    });

    it("without a failing health check, the first target in turn gets the request", () => {
      const { doc: d } = run(
        ALB.replace("fail: ALB Health Check -> Order API timeout retries 1", ""),
      );
      const order = d.diagram.nodes.find((n) => n.label === "Order API")!.id;
      expect(packets(d).some((p) => p.to === order && p.variant === "request")).toBe(true);
    });
  });
});
