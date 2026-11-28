import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument, PacketEvent } from "@archflow/canonical-model";
import { toEngineDocument } from "@archflow/renderer-adapter";
import { parseDescription, synthesizeScenario, textToAnimation } from "../src/index.ts";

/**
 * Ordered request lifecycles: a description that answers its calls explicitly plays every
 * written line, in order, as one packet on the connector between its components.
 */
const fixture = (p: string) =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

const REDIS_MISS = fixture("regression/redis-cache.txt");

const REDIS_HIT = `title: Redis cache hit
request: GET /api/products/101
Client -> Spring Boot API : HTTP request
Spring Boot API -> Redis : GET product:101
Redis -> Spring Boot API : cache hit
Spring Boot API -> Client : HTTP 200 response
`;

function animate(text: string): CanonicalDocument {
  const r = textToAnimation(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  expect(r.warnings).toEqual([]);
  return r.document;
}
const packets = (d: CanonicalDocument): PacketEvent[] =>
  d.scenario!.events.filter((e): e is PacketEvent => e.type === "packet");
/** "from>to variant/shape label" per packet, in time order. */
const timeline = (d: CanonicalDocument, flowIds?: Set<string>): string[] =>
  packets(d)
    .filter((p) => !flowIds || flowIds.has(p.flowId ?? ""))
    .map((p) => `${p.from}>${p.to} ${p.variant}/${p.shape ?? "-"} ${p.label ?? ""}`.trim());

describe("Redis cache-aside lifecycle", () => {
  it("cache miss: every written step animates once, in order, with its own look", () => {
    const d = animate(REDIS_MISS);
    expect(timeline(d)).toEqual([
      "client>spring-boot-api request/capsule", // label shown by the connector
      "spring-boot-api>redis request/diamond", // cache GET (connector label)
      "redis>spring-boot-api response/diamond cache miss",
      "spring-boot-api>postgresql request/capsule",
      "postgresql>spring-boot-api response/square product data",
      "spring-boot-api>redis request/diamond SET product:101 with TTL 300s",
      "spring-boot-api>client response/dot HTTP 200 response",
    ]);
    const p = packets(d);
    // replies answer the call they belong to
    expect(p[2]!.respondsTo).toBe(p[1]!.id);
    expect(p[4]!.respondsTo).toBe(p[3]!.id);
    expect(p[6]!.respondsTo).toBe(p[0]!.id);
    // the cache write is a call nobody answers in the description: no reply is invented
    expect(p.some((x) => x.respondsTo === p[5]!.id)).toBe(false);
    expect(
      d.scenario!.events.find((e) => e.type === "note" && e.text.startsWith("✓")),
    ).toBeTruthy();
  });

  it("cache hit: no database, no write", () => {
    const d = animate(REDIS_HIT);
    expect(d.diagram.nodes.map((n) => n.label)).toEqual(["Client", "Spring Boot API", "Redis"]);
    expect(timeline(d)).toEqual([
      "client>spring-boot-api request/capsule",
      "spring-boot-api>redis request/diamond",
      "redis>spring-boot-api response/diamond cache hit",
      "spring-boot-api>client response/dot HTTP 200 response",
    ]);
  });

  it("cache write with TTL rides the cache connector with its own label", () => {
    const d = animate(REDIS_MISS);
    const set = packets(d).find((x) => x.label === "SET product:101 with TTL 300s")!;
    const edge = d.diagram.edges.find((e) => e.id === set.edgeId)!;
    expect([edge.from, edge.to, edge.label]).toEqual([
      "spring-boot-api",
      "redis",
      "GET product:101",
    ]);
    expect([set.from, set.to, set.variant, set.shape]).toEqual([
      "spring-boot-api",
      "redis",
      "request",
      "diamond",
    ]);
  });

  it("requests and responses are strictly ordered and never overlap", () => {
    const p = packets(animate(REDIS_MISS));
    for (let i = 1; i < p.length; i++)
      expect(p[i]!.t).toBeGreaterThanOrEqual(p[i - 1]!.t + p[i - 1]!.durationMs);
    // a response never leaves before its request has arrived
    for (const r of p.filter((x) => x.respondsTo)) {
      const q = p.find((x) => x.id === r.respondsTo)!;
      expect(r.t).toBeGreaterThanOrEqual(q.t + q.durationMs);
      expect([r.from, r.to]).toEqual([q.to, q.from]);
    }
  });

  it("several events share one connector instead of duplicating it", () => {
    const d = animate(REDIS_MISS);
    expect(d.diagram.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      "client->spring-boot-api",
      "spring-boot-api->redis",
      "spring-boot-api->postgresql",
    ]);
    const perEdge = new Map<string, number>();
    for (const x of packets(d)) perEdge.set(x.edgeId!, (perEdge.get(x.edgeId!) ?? 0) + 1);
    expect(Object.fromEntries(perEdge)).toEqual({ e1: 2, e2: 3, e3: 2 });
  });

  it("is deterministic", () => {
    expect(JSON.stringify(animate(REDIS_MISS))).toBe(JSON.stringify(animate(REDIS_MISS)));
  });

  it("an injected failure on a step retries that step, then continues in order", () => {
    const d = animate(`${REDIS_MISS}fail: Spring Boot API -> PostgreSQL timeout retries 1\n`);
    expect(timeline(d)).toEqual([
      "client>spring-boot-api request/capsule",
      "spring-boot-api>redis request/diamond",
      "redis>spring-boot-api response/diamond cache miss",
      "spring-boot-api>postgresql request/-", // failed attempt (timeout)
      "spring-boot-api>postgresql retry/capsule retry",
      "postgresql>spring-boot-api response/square product data",
      "spring-boot-api>redis request/diamond SET product:101 with TTL 300s",
      "spring-boot-api>client response/dot HTTP 200 response",
    ]);
    const p = packets(d);
    expect(p[5]!.respondsTo).toBe(p[4]!.id); // the result answers the successful retry
    expect(d.scenario!.events.some((e) => e.type === "timeout")).toBe(true);
  });
});

describe("health checks stay independent of an ordered request", () => {
  const MONITORED = `${REDIS_MISS}monitor: Health Check -> Spring Boot API : GET /health every 30s\n`;
  it("probes run on their own flows and do not shift request traffic", () => {
    const d = animate(MONITORED);
    const main = new Set([d.scenario!.flows[0]!.id]);
    expect(d.scenario!.flows[0]!.label).toContain("GET /api/products/101");
    // the request lifecycle is identical with and without health checks
    const plain = animate(REDIS_MISS);
    const strip = (x: CanonicalDocument) =>
      packets(x)
        .filter((q) => main.has(q.flowId ?? ""))
        .map((q) => [q.t, q.from, q.to, q.variant, q.label]);
    expect(strip(d)).toEqual(strip(plain));
    const probes = packets(d).filter((q) => q.variant === "probe");
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes.every((q) => !main.has(q.flowId ?? ""))).toBe(true);
    const monitor = d.diagram.edges.find((e) => e.interaction === "monitoring")!;
    expect(probes.every((q) => q.edgeId === monitor.id)).toBe(true);
  });
});

describe("compatibility", () => {
  it("descriptions without replies or repeated calls keep graph routing", () => {
    for (const f of ["regression/aws-alb.txt", "benchmark/order-flow.txt"])
      expect(parseDescription(fixture(f)).options.sequence).toBeUndefined();
    expect(parseDescription("User -> API -> DB").options.sequence).toBeUndefined();
  });

  it("ALB routing is unchanged: rule match, one target, health-check rounds", () => {
    const d = parseDescription(fixture("regression/aws-alb.txt"));
    const r = synthesizeScenario(d.document!, d.options);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.routing.map((x) => `${x.router}->${x.to}:${x.how}`)).toEqual([
      "rule-engine->api-tg:rule",
      "api-tg->payment-api:balance",
    ]);
  });

  it("a repeated call with a new label is a step too", () => {
    const d = parseDescription("API -> Redis : GET k\nAPI -> DB : SELECT\nAPI -> Redis : SET k");
    expect(d.options.sequence?.map((s) => s.label)).toEqual(["GET k", "SELECT", "SET k"]);
    expect(d.document!.diagram.edges).toHaveLength(2);
  });

  it("the adapter keeps every step and its shape for the engine (and so for export)", () => {
    const d = animate(REDIS_MISS);
    const a = toEngineDocument(d);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const steps = a.document.scenario.steps.filter((s) => s.type === "message");
    expect(steps.map((s) => [s.id, s.packet ?? "capsule", s.variant])).toEqual(
      packets(d).map((p) => [p.id, p.shape, p.variant]),
    );
  });
});
