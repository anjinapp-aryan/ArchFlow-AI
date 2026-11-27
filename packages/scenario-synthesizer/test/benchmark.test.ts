import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument, CanonicalEvent, PacketEvent } from "@archflow/canonical-model";
import { importMermaid } from "@archflow/diagram-importers";
import { synthesizeScenario, textToAnimation } from "../src/index.ts";

const bench = (f: string): string =>
  readFileSync(new URL(`../../../fixtures/benchmark/${f}`, import.meta.url), "utf8");

function fromMermaid(): CanonicalDocument {
  const imp = importMermaid(bench("order-flow.mmd"));
  if (!imp.ok) throw new Error(JSON.stringify(imp.errors));
  const r = synthesizeScenario(imp.document, {
    failures: [{ from: "Consumer 1", to: "PostgreSQL" }],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.document;
}
function fromText(file: string): CanonicalDocument {
  const r = textToAnimation(bench(file));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.document;
}

/** The nine required beats of the P1.5 benchmark, checked on the generated scenario. */
function checkBenchmark(doc: CanonicalDocument): void {
  const label = new Map(doc.diagram.nodes.map((n) => [n.id, n.label]));
  const ev = doc.scenario!.events;
  const packets = ev.filter((e): e is PacketEvent => e.type === "packet");
  const hop = (p: PacketEvent) => `${label.get(p.from)}>${label.get(p.to)}`;
  const first = (h: string, variant?: string) =>
    packets.find((p) => hop(p) === h && (variant === undefined || p.variant === variant));
  const states = (who: string, s: string) =>
    ev.filter(
      (e): e is Extract<CanonicalEvent, { type: "node_state" }> =>
        e.type === "node_state" && label.get(e.nodeId) === who && e.state === s,
    );

  // 1. user sends a request
  const r1 = first("User>API Gateway", "request")!;
  expect(r1).toBeDefined();
  expect(Math.min(...packets.map((p) => p.t))).toBe(r1.t);
  // 2. gateway receives and forwards it (auth first, then order)
  const auth = first("API Gateway>Authentication Service", "request")!;
  const fwd = first("API Gateway>Order Service", "request")!;
  expect(auth.t).toBeGreaterThanOrEqual(r1.t + r1.durationMs);
  expect(states("API Gateway", "active").length).toBeGreaterThan(0);
  // 3. authentication validates and answers before the gateway forwards
  const authOk = packets.find((p) => p.respondsTo === auth.id)!;
  expect(hop(authOk)).toBe("Authentication Service>API Gateway");
  expect(fwd.t).toBeGreaterThanOrEqual(authOk.t + authOk.durationMs);
  // 4. order service processes it
  expect(states("Order Service", "active").some((s) => s.t >= fwd.t)).toBe(true);
  // 5. order service publishes to Kafka (async event)
  const pub = first("Order Service>Kafka")!;
  expect(pub.variant).toBe("event");
  // 6. two consumers in parallel: same start, separate flows
  const c1 = first("Kafka>Consumer 1")!;
  const c2 = first("Kafka>Consumer 2")!;
  expect(c1.t).toBe(c2.t);
  expect(c1.flowId).not.toBe(c2.flowId);
  // 7. one consumer writes to the database
  const writes = packets.filter((p) => hop(p) === "Consumer 1>PostgreSQL");
  expect(writes.length).toBeGreaterThanOrEqual(2);
  // 8. one failure and a retry, clearly distinct
  const timeout = ev.find((e) => e.type === "timeout" && e.waitingFor === writes[0]!.id);
  expect(timeout).toBeDefined();
  const retry = writes.find((p) => p.variant === "retry")!;
  expect(retry).toMatchObject({ attempt: 2, retryOf: writes[0]!.id });
  expect(states("Consumer 1", "warn")).toHaveLength(1);
  expect(packets.some((p) => p.respondsTo === retry.id && hop(p) === "PostgreSQL>Consumer 1")).toBe(
    true,
  );
  // 9. successful response along the response path: order -> gateway -> user, then success
  const ordOk = packets.find((p) => p.respondsTo === fwd.id)!;
  expect(hop(ordOk)).toBe("Order Service>API Gateway");
  const userOk = packets.find((p) => p.respondsTo === r1.id)!;
  expect(hop(userOk)).toBe("API Gateway>User");
  expect(userOk.t).toBeGreaterThan(ordOk.t);
  expect(states("User", "success").some((s) => s.t >= userOk.t)).toBe(true);
  // the client does not wait for the asynchronous consumers
  expect(ordOk.t).toBeLessThan(retry.t);
}

describe("P1.5 order-flow benchmark", () => {
  it("from Mermaid + failure option", () => checkBenchmark(fromMermaid()));
  it("from the arrow text description", () => checkBenchmark(fromText("order-flow.txt")));
  it("from plain English sentences", () => checkBenchmark(fromText("order-flow.sentences.txt")));

  it("text and sentence descriptions produce the same architecture", () => {
    const a = fromText("order-flow.txt");
    const b = fromText("order-flow.sentences.txt");
    const shape = (d: CanonicalDocument) =>
      d.diagram.edges.map((e) => {
        const l = new Map(d.diagram.nodes.map((n) => [n.id, n.label]));
        return `${l.get(e.from)}>${l.get(e.to)}:${e.stroke}`;
      });
    expect(shape(b)).toEqual(shape(a));
  });

  it("is deterministic", () => {
    expect(fromMermaid()).toEqual(fromMermaid());
    expect(fromText("order-flow.txt")).toEqual(fromText("order-flow.txt"));
  });
});
