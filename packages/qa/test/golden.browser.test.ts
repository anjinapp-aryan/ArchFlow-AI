import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serializeEngineDocument, toEngineDocument } from "@archflow/renderer-adapter";
import {
  GOLDEN_CASES,
  diffDisplayList,
  diffPixels,
  launch,
  loadArtifacts,
  pixelDir,
  readDisplayListGolden,
  readPixelGolden,
  renderDisplayLists,
  renderPixels,
  toDisplayListGolden,
  toPixelGolden,
  writeDisplayListGolden,
  writePixelGolden,
  type EngineArtifacts,
} from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const UPDATE = process.env["ARCHFLOW_GOLDEN_UPDATE"] === "1";

function engineDoc(file: string): { json: string; title: string } {
  const canonical: unknown = JSON.parse(
    readFileSync(join(root, "fixtures", "scenarios", file), "utf8"),
  );
  const r = toEngineDocument(canonical);
  if (!r.ok) throw new Error(`adapter rejected ${file}: ${JSON.stringify(r.errors)}`);
  return { json: serializeEngineDocument(r.document), title: r.document.meta.name };
}

let browser: Browser;
let envId = "";
let art: EngineArtifacts;

beforeAll(async () => {
  // Fails loudly if Chrome or the engine build is missing: no silent skipping.
  art = loadArtifacts(root);
  const l = await launch();
  browser = l.browser;
  envId = l.envId;
  console.log(
    `[qa] environment ${envId}; browser ${l.version}; engine.js sha256 ${art.engineJsSha256}`,
  );
});
afterAll(async () => {
  await browser?.close();
});

describe("engine integration", () => {
  it("loads every adapter output (adapter + WASM engine agree)", async () => {
    for (const c of GOLDEN_CASES) {
      const r = await renderDisplayLists(browser, art, engineDoc(c.file).json, [0]);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  });

  it("reports a clear error for documents that are not engine documents", async () => {
    for (const bad of ["{}", "not json", "[]", '{"nodes":[]}']) {
      const r = await renderDisplayLists(browser, art, bad, [0]);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("documents the engine's permissiveness: it normalises bad data silently, so the adapter must validate", async () => {
    // Evidence for the design rule "never rely on the engine to reject": a step that references an
    // unknown node is silently erased by upstream NormalizeModel, and the document still loads.
    const doc = JSON.parse(engineDoc("linear-3.canonical.json").json);
    doc.scenario.steps[0].to = "does-not-exist";
    const r = await renderDisplayLists(browser, art, JSON.stringify(doc), [0, 600]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.frames[1]!.text).not.toContain("GET"); // the packet silently vanished
  });

  it("the animation changes over time and shows the right labels at the right moments", async () => {
    const times = [0, 4400, 5400, 6500, 7900, 8800, 16000];
    const r = await renderDisplayLists(
      browser,
      art,
      engineDoc("order-flow.canonical.json").json,
      times,
    );
    if (!r.ok) throw new Error(r.error);
    const at = Object.fromEntries(r.frames.map((f) => [f.t, f.text]));
    const count = (text: string, word: string): number => text.split(word).length - 1;
    expect(new Set(r.frames.map((f) => f.sha256)).size).toBeGreaterThanOrEqual(6);
    // t=0: idle diagram, no packet labels, nothing down
    for (const w of ["OrderCreated", "INSERT", "timeout", "retry", "ack", "Down"])
      expect(at[0]).not.toContain(w);
    // t=4400: Order Service -> Kafka publish in flight
    expect(at[4400]).toContain("OrderCreated");
    // t=5400: Kafka -> both consumers in parallel (two extra "consume" packet labels), Consumer 1 active, Consumer 2 down
    expect(count(at[5400]!, "consume") - count(at[0]!, "consume")).toBe(2);
    expect(at[5400]).toContain("Active");
    expect(at[5400]).toContain("Down");
    // t=6500: Consumer 1 writes while Consumer 2's write fails with a timeout
    expect(at[6500]).toContain("INSERT");
    expect(at[6500]).toContain("timeout");
    // t=7900: retry packet
    expect(at[7900]).toContain("retry");
    // t=8800: DB acknowledges; Consumer 2 recovered
    expect(at[8800]).toContain("ack");
    expect(at[8800]).toContain("Success");
    // end: back to an idle diagram
    for (const w of ["retry", "timeout", "Down"]) expect(at[16000]).not.toContain(w);
  });
});

describe.each(GOLDEN_CASES)("golden frames: $id", (c) => {
  const times = [...c.times];

  it("display-list golden (platform independent, mandatory)", async () => {
    const r = await renderDisplayLists(browser, art, engineDoc(c.file).json, times);
    if (!r.ok) throw new Error(r.error);
    const actual = toDisplayListGolden(c.id, r.frames);
    if (UPDATE) {
      writeDisplayListGolden(root, actual);
      console.log(`[qa] UPDATED display-list golden ${c.id}`);
      return;
    }
    const expected = readDisplayListGolden(root, c.id);
    expect(
      expected,
      `no display-list golden for ${c.id}; run: npm run golden:update`,
    ).toBeDefined();
    expect(diffDisplayList(expected!, actual)).toEqual([]);
  });

  it("display lists are reproducible across independent browser pages", async () => {
    const json = engineDoc(c.file).json;
    const a = await renderDisplayLists(browser, art, json, times);
    const b = await renderDisplayLists(browser, art, json, times);
    if (!a.ok || !b.ok) throw new Error("render failed");
    expect(b.frames.map((f) => f.sha256)).toEqual(a.frames.map((f) => f.sha256));
  });

  it("pixel golden (per browser/OS environment)", async (ctx) => {
    const { json, title } = engineDoc(c.file);
    const frames = await renderPixels(browser, art, json, title, times);
    const actual = toPixelGolden(c.id, envId, frames);
    const dir = pixelDir(root, c.id, envId);
    if (UPDATE) {
      writePixelGolden(dir, actual, frames);
      console.log(`[qa] UPDATED pixel golden ${c.id} for ${envId}`);
      return;
    }
    const expected = readPixelGolden(dir);
    if (!expected) {
      const cand = join(root, "artifacts", "golden-candidates", c.id, envId);
      mkdirSync(cand, { recursive: true });
      writePixelGolden(cand, actual, frames);
      writeFileSync(
        join(cand, "README.txt"),
        "Candidate goldens: review the PNGs, then run `npm run golden:update`.\n",
      );
      console.warn(
        `[qa] SKIPPED pixel golden for ${c.id}: none recorded for environment ${envId}. Candidates written to ${cand}`,
      );
      ctx.skip(`no pixel golden recorded for environment ${envId}`);
      return;
    }
    expect(diffPixels(expected, actual)).toEqual([]);
  });

  it("pixel rendering is reproducible within one environment", async () => {
    const { json, title } = engineDoc(c.file);
    const a = await renderPixels(browser, art, json, title, times);
    const b = await renderPixels(browser, art, json, title, times);
    expect(b.map((f) => f.sha256)).toEqual(a.map((f) => f.sha256));
  });
});
