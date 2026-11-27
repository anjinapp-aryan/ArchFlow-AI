import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { CORPUS, plantumlKind, type CorpusEntry, type Format } from "./corpus.ts";
import { bundleCogniflow, findCogniflow, installCogniflow, runCogniflow } from "./cogniflow.ts";
import { findNativeBinDir, runNative } from "./native.ts";
import { runArchflow } from "./archflow.ts";
import {
  scoreImport,
  summarize,
  type DiagramScore,
  type ImportOutcome,
  type Summary,
} from "./score.ts";

export type ImporterId = "native-animateddiagrams-2.2.0" | "cogniflow-ts" | "archflow-ts";

export interface ImporterResult {
  importer: ImporterId;
  scores: DiagramScore[];
  summary: { drawio: Summary; mermaid: Summary; plantuml: Summary };
}
export interface CorpusResults {
  results: ImporterResult[];
}

export const diagramsDir = (repoRoot: string): string => resolve(repoRoot, "fixtures", "diagrams");

export function formatOf(entry: CorpusEntry, ext: "drawio" | "mmd" | "puml"): Format {
  if (ext === "drawio") return "drawio";
  if (ext === "puml")
    return plantumlKind(entry) === "sequence" ? "plantuml-sequence" : "plantuml-component";
  return entry.formats.mermaid === "sequence" ? "mermaid-sequence" : "mermaid-flowchart";
}

export function corpusInputs(): {
  entry: CorpusEntry;
  ext: "drawio" | "mmd" | "puml";
  file: string;
  format: Format;
}[] {
  const out: {
    entry: CorpusEntry;
    ext: "drawio" | "mmd" | "puml";
    file: string;
    format: Format;
  }[] = [];
  for (const entry of CORPUS) {
    if (entry.formats.drawio)
      out.push({ entry, ext: "drawio", file: `${entry.id}.drawio`, format: "drawio" });
    if (entry.formats.mermaid)
      out.push({ entry, ext: "mmd", file: `${entry.id}.mmd`, format: formatOf(entry, "mmd") });
    if (plantumlKind(entry))
      out.push({ entry, ext: "puml", file: `${entry.id}.puml`, format: formatOf(entry, "puml") });
  }
  return out;
}

const split = (scores: DiagramScore[]): ImporterResult["summary"] => ({
  drawio: summarize(scores.filter((s) => s.format === "drawio")),
  mermaid: summarize(scores.filter((s) => s.format.startsWith("mermaid"))),
  plantuml: summarize(scores.filter((s) => s.format.startsWith("plantuml"))),
});

export function availability(repoRoot: string): { native: boolean; cogniflow: boolean } {
  return {
    native: findNativeBinDir(repoRoot) !== undefined,
    cogniflow: findCogniflow(repoRoot) !== undefined,
  };
}

export function runNativeCorpus(repoRoot: string): ImporterResult {
  const bin = findNativeBinDir(repoRoot);
  if (!bin) throw new Error("native AnimatedDiagrams binary not found under research/binaries");
  const scratch = resolve(repoRoot, "artifacts", "importer-eval", "native");
  const scores = corpusInputs().map(({ entry, ext, file, format }) =>
    scoreImport(
      entry,
      format,
      ext === "puml"
        ? { ok: false, error: "PlantUML is not supported by this importer" }
        : runNative(bin, scratch, join(diagramsDir(repoRoot), file)),
    ),
  );
  return { importer: "native-animateddiagrams-2.2.0", scores, summary: split(scores) };
}

export async function runCogniflowCorpus(repoRoot: string, page: Page): Promise<ImporterResult> {
  const studio = findCogniflow(repoRoot);
  if (!studio) throw new Error("CogniFlow sources not found under research/upstream");
  await installCogniflow(page, await bundleCogniflow(repoRoot, studio));
  const scores: DiagramScore[] = [];
  for (const { entry, ext, file, format } of corpusInputs()) {
    const text = readFileSync(join(diagramsDir(repoRoot), file), "utf8");
    let outcome: ImportOutcome;
    if (ext === "puml") {
      scores.push(
        scoreImport(entry, format, {
          ok: false,
          error: "PlantUML is not supported by this importer",
        }),
      );
      continue;
    }
    try {
      outcome = await runCogniflow(page, ext === "drawio" ? "drawio" : "mermaid", text);
    } catch (e) {
      outcome = {
        ok: false,
        error: `harness error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    scores.push(scoreImport(entry, format, outcome));
  }
  return { importer: "cogniflow-ts", scores, summary: split(scores) };
}

/** ArchFlow's own importers (Node; the browser parity test proves identical output in Chrome). */
export async function runArchflowCorpus(repoRoot: string): Promise<ImporterResult> {
  const scores: DiagramScore[] = [];
  for (const { entry, ext, file, format } of corpusInputs())
    scores.push(
      scoreImport(entry, format, await runArchflow(join(diagramsDir(repoRoot), file), ext)),
    );
  return { importer: "archflow-ts", scores, summary: split(scores) };
}
