import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { corpusInputs, diagramsDir, runArchflow, scoreImport } from "../src/index.ts";

/**
 * THE acceptance bar for ArchFlow's own importers: every applicable fidelity check on every
 * corpus file, no extra nodes, no invented edges. Runs in CI (no Chrome, no research/ needed).
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("ArchFlow importers pass the whole fidelity corpus", () => {
  it.each(corpusInputs().map((i) => [i.file, i] as const))("%s", async (_f, input) => {
    const outcome = await runArchflow(join(diagramsDir(repoRoot), input.file), input.ext);
    const s = scoreImport(input.entry, input.format, outcome);
    const failures = s.checks
      .filter((c) => c.applicable && c.matched !== c.expected)
      .map((c) => `${c.name}: ${c.details.join("; ")}`);
    expect({
      error: s.error,
      failures,
      extraNodes: s.extraNodes,
      extraEdges: s.extraEdges,
    }).toEqual({
      error: undefined,
      failures: [],
      extraNodes: [],
      extraEdges: [],
    });
    expect(s.pass).toBe(true);
  });
});
