import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { launch } from "@archflow/qa";
import {
  availability,
  runArchflowCorpus,
  runCogniflowCorpus,
  runNativeCorpus,
  type CorpusResults,
  type ImporterResult,
} from "../src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baselinePath = resolve(repoRoot, "fixtures", "diagrams", "results.json");
const update = process.env["ARCHFLOW_IMPORT_REPORT"] === "1";
const have = availability(repoRoot);

const collected: ImporterResult[] = [];
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (have.cogniflow) {
    const l = await launch();
    browser = l.browser;
    page = await browser.newPage();
  }
});
afterAll(async () => {
  await browser?.close();
  if (collected.length === 0) return;
  const results: CorpusResults = { results: collected };
  const text = JSON.stringify(results, null, 2) + "\n";
  mkdirSync(resolve(repoRoot, "artifacts", "importer-eval"), { recursive: true });
  writeFileSync(resolve(repoRoot, "artifacts", "importer-eval", "results.json"), text);
  if (update && collected.length === 3) {
    collected.sort((a, b) => a.importer.localeCompare(b.importer));
    writeFileSync(baselinePath, JSON.stringify({ results: collected }, null, 2) + "\n");
  }
});

function baseline(id: string): ImporterResult | undefined {
  if (!existsSync(baselinePath)) return undefined;
  const all = JSON.parse(readFileSync(baselinePath, "utf8")) as CorpusResults;
  return all.results.find((r) => r.importer === id);
}

describe.skipIf(!have.native)("importer fidelity: native AnimatedDiagrams (reference)", () => {
  it("results match the recorded baseline", () => {
    const r = runNativeCorpus(repoRoot);
    collected.push(r);
    expect(r.scores.length).toBeGreaterThanOrEqual(20);
    if (!update) expect(r).toEqual(baseline(r.importer));
  }, 300_000);
});

describe.skipIf(!have.cogniflow)(
  "importer fidelity: CogniFlow TypeScript importers (candidate)",
  () => {
    it("results match the recorded baseline", async () => {
      const r = await runCogniflowCorpus(repoRoot, page!);
      collected.push(r);
      expect(r.scores.length).toBeGreaterThanOrEqual(20);
      if (!update) expect(r).toEqual(baseline(r.importer));
    }, 300_000);
  },
);

describe("importer fidelity: ArchFlow importers (shipped)", () => {
  it("results match the recorded baseline", async () => {
    const r = await runArchflowCorpus(repoRoot);
    collected.push(r);
    if (!update) expect(r).toEqual(baseline(r.importer));
  }, 300_000);
});
