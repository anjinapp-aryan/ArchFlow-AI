import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CORPUS, corpusFiles, renderDrawio } from "../src/index.ts";

const dir = new URL("../../../fixtures/diagrams/", import.meta.url);

describe("importer corpus", () => {
  it("has unique ids and unique labels (matching is by label)", () => {
    expect(new Set(CORPUS.map((c) => c.id)).size).toBe(CORPUS.length);
    for (const c of CORPUS) {
      const labels = [...c.nodes.map((n) => n.label), ...c.groups.map((g) => g.label)];
      expect(new Set(labels).size, c.id).toBe(labels.length);
      const keys = [...c.nodes.map((n) => n.key), ...c.groups.map((g) => g.key)];
      expect(new Set(keys).size, c.id).toBe(keys.length);
      for (const ed of c.edges) {
        expect(
          c.nodes.some((n) => n.key === ed.from),
          `${c.id}/${ed.key}`,
        ).toBe(true);
        expect(
          c.nodes.some((n) => n.key === ed.to),
          `${c.id}/${ed.key}`,
        ).toBe(true);
      }
      for (const nd of c.nodes)
        if (nd.group)
          expect(
            c.groups.some((g) => g.key === nd.group),
            c.id,
          ).toBe(true);
    }
  });

  it("has at least 10 draw.io and 10 Mermaid files", () => {
    expect(CORPUS.filter((c) => c.formats.drawio).length).toBeGreaterThanOrEqual(10);
    expect(CORPUS.filter((c) => c.formats.mermaid).length).toBeGreaterThanOrEqual(10);
  });

  it("covers every required category", () => {
    const have = new Set(CORPUS.flatMap((c) => c.categories));
    for (const need of [
      "linear",
      "branching",
      "parallel",
      "multiple-connectors",
      "bidirectional",
      "request-response",
      "nested-groups",
      "labeled-connectors",
      "dashed",
      "curved",
      "ambiguous-direction",
    ])
      expect(have.has(need), need).toBe(true);
    // curved and dashed connectors, and a missing arrow end, are actually drawn
    const edges = CORPUS.flatMap((c) => c.edges);
    expect(edges.some((e) => e.routing === "curved")).toBe(true);
    expect(edges.some((e) => e.stroke === "dashed")).toBe(true);
    expect(edges.some((e) => e.direction === "none")).toBe(true);
    expect(edges.some((e) => e.direction === "backward")).toBe(true);
    expect(CORPUS.some((c) => c.danglingEdges > 0)).toBe(true);
  });

  it("files on disk are exactly what the generator produces (run `node scripts/make-corpus.mjs`)", () => {
    const wanted = new Map<string, string>();
    for (const c of CORPUS) for (const [k, v] of Object.entries(corpusFiles(c))) wanted.set(k, v);
    const onDisk = readdirSync(dir).filter((f) => /\.(drawio|mmd|puml|truth\.json)$/.test(f));
    expect(onDisk.sort()).toEqual([...wanted.keys()].sort());
    for (const [name, text] of wanted)
      expect(readFileSync(new URL(name, dir), "utf8"), name).toBe(text);
  });

  it("the compressed draw.io page really is compressed and decodes to the same model", () => {
    const entry = CORPUS.find((c) => c.formats.drawioCompressed)!;
    const xml = renderDrawio(entry);
    expect(xml).not.toContain("<mxGraphModel");
    const body = />([A-Za-z0-9+/=]+)<\/diagram>/.exec(xml)![1]!;
    const model = decodeURIComponent(inflateRawSync(Buffer.from(body, "base64")).toString("utf8"));
    expect(model.startsWith("<mxGraphModel")).toBe(true);
    for (const n of entry.nodes) expect(model).toContain(`value="${n.label}"`);
  });

  it("nested draw.io children use parent-relative geometry (a real importer must convert it)", () => {
    const entry = CORPUS.find((c) => c.id === "06-nested-groups")!;
    const xml = renderDrawio(entry);
    const lb = entry.nodes.find((n) => n.key === "lb")!;
    expect(xml).toContain(`<mxGeometry x="${lb.x - 60}" y="${lb.y - 60}"`);
    expect(xml).toContain('id="priv"');
    expect(xml).toMatch(/id="priv"[^>]*parent="vpc"/);
  });

  it("dangling connectors are drawn without a target", () => {
    const entry = CORPUS.find((c) => c.danglingEdges > 0)!;
    const xml = renderDrawio(entry);
    expect(xml).toMatch(/id="dangling1"[^>]*source="[^"]+"><mxGeometry/);
    expect(xml).not.toMatch(/id="dangling1"[^>]*target=/);
  });

  it("Mermaid files exclude constructs Mermaid cannot express", () => {
    const entry = CORPUS.find((c) => c.mermaidExclude?.length)!;
    const mmd = readFileSync(new URL(`${entry.id}.mmd`, dir), "utf8");
    expect(mmd).not.toContain("arrow at source");
    expect(mmd).toContain("plain line");
  });
});
