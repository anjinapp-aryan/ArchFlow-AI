import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, loadArtifacts, renderDisplayLists } from "@archflow/qa";
import { toEngineDocument, serializeEngineDocument } from "@archflow/renderer-adapter";
import { detectFormat, importDiagram } from "../src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dir = resolve(repoRoot, "fixtures", "diagrams");
const corpus = readdirSync(dir)
  .filter((f) => /\.(drawio|mmd|puml)$/.test(f))
  .sort()
  .map((f) => ({ f, text: readFileSync(resolve(dir, f), "utf8") }));

let browser: Browser;
let page: Page;
let bundle = "";

beforeAll(async () => {
  const r = await build({
    entryPoints: [resolve(repoRoot, "packages/diagram-importers/src/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "ArchFlowImporters",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
    logLevel: "silent",
  });
  bundle = r.outputFiles[0]!.text;
  browser = (await launch()).browser;
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><title>importers</title>");
  await page.addScriptTag({ content: bundle });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

describe("importers in a real browser", () => {
  it("the browser bundle is small and has no eval/new Function", () => {
    const gz = gzipSync(bundle).length;
    expect(gz).toBeLessThan(60_000);
    expect(bundle).not.toMatch(/\beval\(|new Function\(/);
  });

  it("produce byte-identical results to Node for every corpus file", async () => {
    for (const { f, text } of corpus) {
      const fmt = detectFormat(text, f)!;
      const node = JSON.stringify(await importDiagram(text, fmt));
      const web = await page.evaluate(
        async (src: string, format: string) => {
          const g = globalThis as unknown as {
            ArchFlowImporters: { importDiagram(t: string, f: string): Promise<unknown> };
          };
          return JSON.stringify(await g.ArchFlowImporters.importDiagram(src, format));
        },
        text,
        fmt,
      );
      expect(web, f).toBe(node);
    }
  }, 120_000);
});

describe("end to end: import -> validate -> adapt -> WASM engine", () => {
  it("every imported corpus diagram loads in the engine and draws its components", async () => {
    const art = loadArtifacts(repoRoot);
    for (const { f, text } of corpus) {
      const r = await importDiagram(text, detectFormat(text, f)!);
      expect(r.ok, f).toBe(true);
      if (!r.ok) continue;
      const doc = r.document.scenario
        ? r.document
        : { ...r.document, scenario: { id: "static", durationMs: 1000, flows: [], events: [] } };
      const a = toEngineDocument(doc, { groups: "flatten" });
      expect(a.ok, `${f}: ${JSON.stringify(a.ok ? [] : a.errors)}`).toBe(true);
      if (!a.ok) continue;
      const run = await renderDisplayLists(browser, art, serializeEngineDocument(a.document), [0]);
      expect(run.ok, f).toBe(true);
      if (!run.ok) continue;
      const shown = run.frames[0]!.text;
      for (const n of r.document.diagram.nodes)
        expect(shown, `${f}: "${n.label}"`).toContain(n.label.split(" ")[0]!);
    }
  }, 300_000);

  it("a Mermaid sequence diagram animates its messages at the imported times", async () => {
    const art = loadArtifacts(repoRoot);
    const text = readFileSync(resolve(dir, "15-sequence-rich.mmd"), "utf8");
    const r = await importDiagram(text, "mermaid");
    if (!r.ok) throw new Error("import failed");
    const first = r.document.scenario!.events.find((e) => e.type === "packet")!;
    const a = toEngineDocument(r.document, { groups: "flatten" });
    if (!a.ok) throw new Error(JSON.stringify(a.errors));
    const mid = first.t + first.durationMs / 2;
    const run = await renderDisplayLists(browser, art, serializeEngineDocument(a.document), [mid]);
    if (!run.ok) throw new Error(run.error);
    expect(run.frames[0]!.text).toContain("POST /orders");
  }, 120_000);
});
