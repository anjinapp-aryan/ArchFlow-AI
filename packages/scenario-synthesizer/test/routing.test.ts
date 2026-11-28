import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument, PacketEvent } from "@archflow/canonical-model";
import {
  parseDescription,
  parseRequest,
  parseRouteRule,
  ruleMatches,
  synthesizeScenario,
  type RoutingDecision,
} from "../src/index.ts";

/**
 * Routing semantics (AWS ALB regression benchmark): a request goes through exactly one listener
 * rule, one target group and one registered target; health checks run on their own.
 */
const fixture = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");
const ALB = fixture("regression/aws-alb.txt");

function run(text: string): {
  doc: CanonicalDocument;
  warnings: string[];
  routing: RoutingDecision[];
} {
  const d = parseDescription(text);
  if (!d.ok || !d.document) throw new Error(JSON.stringify(d.errors));
  const s = synthesizeScenario(d.document, d.options);
  if (!s.ok) throw new Error(JSON.stringify(s.errors));
  return {
    doc: s.document,
    warnings: [...d.warnings, ...s.warnings].map((w) => w.code),
    routing: s.routing,
  };
}
const packets = (doc: CanonicalDocument): PacketEvent[] =>
  doc.scenario!.events.filter((e): e is PacketEvent => e.type === "packet");
const named = (doc: CanonicalDocument) => {
  const label = new Map(doc.diagram.nodes.map((n) => [n.id, n.label]));
  return (id: string): string => label.get(id)!;
};
/** Request-path hops (requests and retries) as "From -> To", in time order. */
const requestHops = (doc: CanonicalDocument): string[] => {
  const n = named(doc);
  return packets(doc)
    .filter((p) => p.variant === "request" || p.variant === "retry")
    .map((p) => `${n(p.from)} -> ${n(p.to)}`);
};
const responseHops = (doc: CanonicalDocument): string[] => {
  const n = named(doc);
  return packets(doc)
    .filter((p) => p.variant === "response")
    .map((p) => `${n(p.from)} -> ${n(p.to)}`);
};
const withRequest = (req: string): string =>
  ALB.replace("request: GET /api/orders", `request: ${req}`);

describe("ALB routing: one request, one rule, one target group", () => {
  const { doc, routing } = run(ALB);
  const n = named(doc);

  it("the matching rule selects exactly one target group", () => {
    expect(requestHops(doc)).toEqual([
      "Client -> ALB Listener 443",
      "ALB Listener 443 -> Rule Engine",
      "Rule Engine -> API TG",
      "API TG -> Payment API",
    ]);
    const decisions = routing.map((r) => `${n(r.router)} -> ${n(r.to)} (${r.how})`);
    expect(decisions).toEqual(["Rule Engine -> API TG (rule)", "API TG -> Payment API (balance)"]);
  });

  it("unrelated target groups and their targets are not visited", () => {
    for (const other of ["Auth TG", "Web TG", "Auth Service", "Frontend ECS"]) {
      const id = doc.diagram.nodes.find((x) => x.label === other)!.id;
      const traffic = packets(doc).filter(
        (p) => p.variant !== "probe" && p.variant !== "success" && (p.from === id || p.to === id),
      );
      expect(traffic, other).toEqual([]);
      // no "working" state either: only health-check flashes may touch them
      const busy = doc.scenario!.events.filter(
        (e) => e.type === "node_state" && e.nodeId === id && e.state === "active",
      );
      expect(busy, other).toEqual([]);
    }
    // all three target groups stay in the diagram
    for (const tg of ["Auth TG", "API TG", "Web TG"])
      expect(doc.diagram.nodes.some((x) => x.label === tg)).toBe(true);
  });

  it("the response returns along the request path, hop by hop", () => {
    expect(responseHops(doc)).toEqual([
      "Payment API -> API TG",
      "API TG -> Rule Engine",
      "Rule Engine -> ALB Listener 443",
      "ALB Listener 443 -> Client",
    ]);
    const byId = new Map(packets(doc).map((p) => [p.id, p]));
    for (const r of packets(doc).filter((p) => p.variant === "response")) {
      const req = byId.get(r.respondsTo!)!;
      expect([req.from, req.to]).toEqual([r.to, r.from]);
      expect(r.t).toBeGreaterThanOrEqual(req.t + req.durationMs);
    }
  });

  it("states the request and the matched rule on screen", () => {
    const notes = doc.scenario!.events.flatMap((e) => (e.type === "note" ? [e.text] : []));
    expect(notes).toContain("GET /api/orders");
    expect(notes).toContain("/api/* → API TG");
  });

  it.each([
    ["GET /api/orders", "API TG"],
    ["GET /auth/login", "Auth TG"],
    ["https://auth.app/profile", "Auth TG"],
    ["GET /profile host AUTH.APP", "Auth TG"],
    ["GET /", "Web TG"],
    ["GET /static/app.js", "Web TG"],
    // ALB path patterns are case-sensitive: /API/x is not /api/*
    ["GET /API/orders", "Web TG"],
  ])("request %s goes to %s only", (req, tg) => {
    const r = run(withRequest(req));
    const fromRules = requestHops(r.doc).filter((h) => h.startsWith("Rule Engine -> "));
    expect(fromRules).toEqual([`Rule Engine -> ${tg}`]);
  });

  it("without a request, the default rule is used and reported", () => {
    const r = run(ALB.replace("request: GET /api/orders\n", ""));
    expect(requestHops(r.doc).filter((h) => h.startsWith("Rule Engine -> "))).toEqual([
      "Rule Engine -> Web TG",
    ]);
    expect(r.warnings).toContain("synth.route_default");
  });

  it("a request no rule matches, without a default rule, stops at the router (reported)", () => {
    const r = run(withRequest("GET /nothing").replace(" : default rule fallback", " : /web/*"));
    expect(requestHops(r.doc).some((h) => h.startsWith("Rule Engine -> "))).toBe(false);
    expect(r.warnings).toContain("synth.no_rule_matched");
  });
});

describe("ALB routing: health checks stay independent of requests", () => {
  const { doc } = run(ALB);
  const probeTimes = (d: CanonicalDocument): string[] =>
    packets(d)
      .filter((p) => p.variant === "probe" || p.variant === "success")
      .map((p) => `${p.t}:${p.from}>${p.to}:${p.variant}`);

  it("probes run on their own flows and never on request connectors", () => {
    const main = doc.scenario!.flows[0]!.id;
    const monitoring = new Set(
      doc.diagram.edges.filter((e) => e.interaction === "monitoring").map((e) => e.id),
    );
    for (const p of packets(doc)) {
      const probe = p.variant === "probe" || p.variant === "success";
      if (probe) {
        expect(p.flowId).not.toBe(main);
        expect(monitoring.has(p.edgeId!)).toBe(true);
      } else expect(monitoring.has(p.edgeId!)).toBe(false);
    }
  });

  it("probe timing does not depend on where the request is routed", () => {
    const other = run(withRequest("GET /"));
    // both scenarios have the same request length up to the target, so the same probe rounds
    expect(probeTimes(other.doc).length).toBeGreaterThan(0);
    expect(probeTimes(other.doc).slice(0, 6)).toEqual(probeTimes(doc).slice(0, 6));
  });

  it("an unhealthy target gets no request and stays unhealthy to the end", () => {
    const order = doc.diagram.nodes.find((x) => x.label === "Order API")!.id;
    expect(packets(doc).some((p) => p.to === order && p.variant === "request")).toBe(false);
    const down = doc.scenario!.events.filter(
      (e) => e.type === "node_state" && e.nodeId === order && e.state === "down",
    );
    expect(down).toHaveLength(1);
    expect(down[0]!.t + down[0]!.durationMs).toBe(doc.scenario!.durationMs);
  });

  it("with every target unhealthy, the balancer fails open and the state ends when traffic arrives", () => {
    const r = run(
      ALB.replace(
        "fail: ALB Health Check -> Order API timeout retries 1",
        "fail: ALB Health Check -> Order API timeout\nfail: ALB Health Check -> Payment API timeout",
      ),
    );
    const order = r.doc.diagram.nodes.find((x) => x.label === "Order API")!.id;
    const req = packets(r.doc).find((p) => p.to === order && p.variant === "request")!;
    expect(req).toBeDefined();
    const down = r.doc.scenario!.events.find(
      (e) => e.type === "node_state" && e.nodeId === order && e.state === "down",
    );
    // no "unhealthy" shown while it serves the request (from the request to its answer leaving)
    const answer = packets(r.doc).find((p) => p.respondsTo === req.id)!;
    expect(down).toBeDefined();
    const d = down!;
    const overlaps = d.t < answer.t + answer.durationMs && req.t < d.t + d.durationMs;
    expect(overlaps).toBe(false);
  });
});

describe("routing leaves other behaviour intact", () => {
  it("ordinary components still call every callee in turn (order-flow API Gateway)", () => {
    const { doc } = run(fixture("benchmark/order-flow.txt"));
    const hops = requestHops(doc);
    expect(hops).toContain("API Gateway -> Authentication Service");
    expect(hops).toContain("API Gateway -> Order Service");
  });

  it("parallel consumers and retries are unchanged (order-flow)", () => {
    const { doc } = run(fixture("benchmark/order-flow.txt"));
    const n = named(doc);
    const deliveries = packets(doc).filter((p) => n(p.from) === "Kafka" && p.variant === "event");
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]!.t).toBe(deliveries[1]!.t);
    expect(new Set(deliveries.map((p) => p.flowId)).size).toBe(2);
    expect(packets(doc).some((p) => p.variant === "retry" && p.retryOf)).toBe(true);
  });

  it("a retry on the routed path still happens on the chosen target", () => {
    const { doc } = run(ALB + "\nfail: API TG -> Payment API timeout retries 2");
    const hops = requestHops(doc).filter((h) => h === "API TG -> Payment API");
    expect(hops).toHaveLength(3);
    const retries = packets(doc).filter((p) => p.variant === "retry");
    expect(retries.map((p) => p.attempt)).toEqual([2, 3]);
  });
});

describe("route conditions", () => {
  it("parses path, host and default conditions from connector labels", () => {
    expect(parseRouteRule("/auth* or host auth.app")).toEqual({
      paths: ["/auth*"],
      hosts: ["auth.app"],
      isDefault: false,
    });
    expect(parseRouteRule("/api/* path match")).toEqual({
      paths: ["/api/*"],
      hosts: [],
      isDefault: false,
    });
    expect(parseRouteRule("default rule fallback").isDefault).toBe(true);
    expect(parseRouteRule("round-robin healthy targets")).toEqual({
      paths: [],
      hosts: [],
      isDefault: false,
    });
  });

  it("matches like ALB listener rules", () => {
    const api = parseRouteRule("/api/*");
    expect(ruleMatches(api, parseRequest("GET /api/orders"))).toBe(true);
    expect(ruleMatches(api, parseRequest("GET /api"))).toBe(false);
    expect(ruleMatches(api, parseRequest("GET /API/orders"))).toBe(false);
    const host = parseRouteRule("host *.example.com");
    expect(ruleMatches(host, parseRequest("https://shop.EXAMPLE.com/x"))).toBe(true);
    expect(ruleMatches(host, parseRequest("https://example.com/x"))).toBe(false);
  });
});
