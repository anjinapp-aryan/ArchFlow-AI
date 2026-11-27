import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCanonical } from "@archflow/canonical-model";
import {
  detectFormat,
  importDiagram,
  importDrawio,
  importMermaid,
  type ImportResult,
} from "../src/index.ts";

const dir = new URL("../../../fixtures/diagrams/", import.meta.url);
const corpus = readdirSync(dir)
  .filter((f) => /\.(drawio|mmd|puml)$/.test(f))
  .sort()
  .map((f) => ({ f, text: readFileSync(new URL(f, dir), "utf8") }));

/** mulberry32 */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function wellFormed(r: ImportResult): void {
  if (r.ok) {
    expect(validateCanonical(r.document).ok).toBe(true);
  } else {
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) expect(typeof e.code).toBe("string");
  }
}

describe("importers: robustness", () => {
  it("every corpus file imports and validates", async () => {
    for (const { f, text } of corpus) {
      const r = await importDiagram(text, detectFormat(text, f)!);
      expect(r.ok, `${f}: ${JSON.stringify(r.ok ? [] : r.errors)}`).toBe(true);
    }
  });

  it("is deterministic (same input, same document, same warnings)", async () => {
    for (const { f, text } of corpus) {
      const fmt = detectFormat(text, f)!;
      expect(await importDiagram(text, fmt)).toEqual(await importDiagram(text, fmt));
    }
  });

  it("never throws and never returns an invalid document on 1,200 seeded mutations", async () => {
    const rand = rng(20261126);
    const junk = [
      "<",
      ">",
      '"',
      "&",
      "]",
      "[",
      "-->",
      "|",
      "\n",
      "end",
      "subgraph",
      "&amp;",
      "<mxCell",
      "\u0000",
      "é",
      "%%",
    ];
    for (let i = 0; i < 1200; i++) {
      const { f, text } = corpus[Math.floor(rand() * corpus.length)]!;
      let s = text;
      for (let m = 0; m < 1 + Math.floor(rand() * 4); m++) {
        const at = Math.floor(rand() * s.length);
        const op = rand();
        if (op < 0.4) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rand() * 20));
        else if (op < 0.8)
          s = s.slice(0, at) + junk[Math.floor(rand() * junk.length)] + s.slice(at);
        else s = s.slice(0, at) + s.slice(at, at + 40) + s.slice(at);
      }
      const r = f.endsWith(".mmd") ? importMermaid(s) : await importDrawio(s);
      wellFormed(r);
    }
  });

  it("imports a 400-node / 1,000-edge Mermaid flowchart quickly", () => {
    const lines = ["flowchart LR"];
    for (let i = 0; i < 400; i++) lines.push(`n${i}[Node ${i}]`);
    for (let i = 0; i < 1000; i++) lines.push(`n${i % 400} --> n${(i * 7 + 1) % 400}`);
    const t0 = performance.now();
    const r = importMermaid(lines.join("\n"));
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document.diagram.edges.length).toBeGreaterThan(900);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);

  it("imports a 500-shape draw.io file and rejects 501", async () => {
    const mk = (n: number) =>
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${Array.from(
        { length: n },
        (_, i) =>
          `<mxCell id="v${i}" value="S${i}" style="" vertex="1" parent="1"><mxGeometry x="${(i % 25) * 150}" y="${Math.floor(i / 25) * 100}" width="120" height="60" as="geometry"/></mxCell>`,
      ).join("")}</root></mxGraphModel>`;
    expect((await importDrawio(mk(500))).ok).toBe(true);
    const r = await importDrawio(mk(501));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("drawio.too_many_nodes");
  });

  it("detects formats from names and content", () => {
    expect(detectFormat("", "a.drawio")).toBe("drawio");
    expect(detectFormat("", "a.mmd")).toBe("mermaid");
    expect(detectFormat("<mxfile/>")).toBe("drawio");
    expect(detectFormat("graph TD\nA-->B")).toBe("mermaid");
    expect(detectFormat("sequenceDiagram")).toBe("mermaid");
    expect(detectFormat("hello")).toBeUndefined();
  });
});
