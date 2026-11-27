import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importDrawio } from "@archflow/diagram-importers";
import { CORPUS, scoreImport, summarize, toOutcome, type DiagramScore } from "../src/index.ts";
import {
  importGenericSvg,
  renderDrawioSvg,
  renderMermaidLikeSvg,
  renderPlainSvg,
} from "../src/spikes/svg.ts";

/** P1.6 SVG spike measurements (recorded in docs/research/SVG_IMPORT_SPIKE.md). */
const entries = CORPUS.filter((c) => c.formats.drawio && !c.raw && !c.formats.drawioCompressed);

describe("SVG spike", () => {
  it("measures the three SVG kinds over the generated corpus", async () => {
    const results: Record<string, DiagramScore[]> = { drawioSvg: [], plain: [], mermaidLike: [] };
    for (const e of entries) {
      results["drawioSvg"]!.push(
        scoreImport(e, "drawio", toOutcome(await importDrawio(renderDrawioSvg(e)))),
      );
      results["plain"]!.push(scoreImport(e, "drawio", importGenericSvg(renderPlainSvg(e))));
      results["mermaidLike"]!.push(
        scoreImport(e, "drawio", importGenericSvg(renderMermaidLikeSvg(e))),
      );
    }
    const summary = Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        { ...summarize(v), failing: v.filter((s) => !s.pass).map((s) => s.id) },
      ]),
    );
    mkdirSync(new URL("../../../artifacts/spikes/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../../artifacts/spikes/svg-results.json", import.meta.url),
      JSON.stringify(summary, null, 2),
    );
    // draw.io SVG with an embedded diagram is exact (it is the draw.io importer)
    expect(summary["drawioSvg"]!.passed).toBe(entries.length);
  });
});
