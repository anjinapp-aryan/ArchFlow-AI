import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanonicalDocument, PacketEvent } from "@archflow/canonical-model";
import { importMermaid } from "@archflow/diagram-importers";
import { launch, loadArtifacts, renderDisplayLists } from "@archflow/qa";
import { serializeEngineDocument, toEngineDocument } from "@archflow/renderer-adapter";
import { synthesizeScenario, textToAnimation } from "../src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bench = (f: string): string =>
  readFileSync(resolve(repoRoot, "fixtures/benchmark", f), "utf8");
let browser: Browser;
beforeAll(async () => {
  browser = (await launch()).browser;
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function check(doc: CanonicalDocument): Promise<void> {
  const art = loadArtifacts(repoRoot);
  const a = toEngineDocument(doc, { groups: "flatten" });
  if (!a.ok) throw new Error(JSON.stringify(a.errors));
  const label = new Map(doc.diagram.nodes.map((n) => [n.id, n.label]));
  const packets = doc.scenario!.events.filter((e): e is PacketEvent => e.type === "packet");
  const mid = (p: PacketEvent) => p.t + p.durationMs / 2;
  const find = (from: string, to: string, variant: string) =>
    packets.find(
      (p) => label.get(p.from) === from && label.get(p.to) === to && p.variant === variant,
    )!;
  const request = find("User", "API Gateway", "request");
  const consume = find("Kafka", "Consumer 1", "event");
  const timeout = doc.scenario!.events.find((e) => e.type === "timeout")!;
  const retry = find("Consumer 1", "PostgreSQL", "retry");
  const final = packets.find((p) => p.respondsTo === request.id)!;
  const times = [
    mid(request),
    mid(consume),
    timeout.t + timeout.durationMs / 2,
    mid(retry),
    mid(final),
  ];
  const run = await renderDisplayLists(browser, art, serializeEngineDocument(a.document), times);
  if (!run.ok) throw new Error(run.error);
  const [t1, t2, t3, t4, t5] = run.frames.map((f) => f.text);
  expect(t1).toContain("POST /orders");
  expect(t2!.match(/consume/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // two consumers in parallel
  expect(t3).toContain("timeout");
  expect(t4).toContain("retry");
  expect(t5).toContain("ok");
  // frames differ over time and are reproducible
  expect(new Set(run.frames.map((f) => f.sha256)).size).toBe(times.length);
  const again = await renderDisplayLists(browser, art, serializeEngineDocument(a.document), times);
  if (!again.ok) throw new Error(again.error);
  expect(again.frames.map((f) => f.sha256)).toEqual(run.frames.map((f) => f.sha256));
}

describe("benchmark rendered by the WASM engine", () => {
  it("from Mermaid", async () => {
    const imp = importMermaid(bench("order-flow.mmd"));
    if (!imp.ok) throw new Error("import");
    const r = synthesizeScenario(imp.document, {
      failures: [{ from: "Consumer 1", to: "PostgreSQL" }],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    await check(r.document);
  }, 120_000);
  it("from a text description", async () => {
    const r = textToAnimation(bench("order-flow.txt"));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    await check(r.document);
  }, 120_000);
});
