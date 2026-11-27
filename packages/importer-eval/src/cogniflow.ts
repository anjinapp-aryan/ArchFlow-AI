import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import type { Page } from "puppeteer-core";
import type { Direction } from "./corpus.ts";
import type { ImportOutcome, Imported } from "./score.ts";

/**
 * Candidate browser importers: CogniFlow's `drawio.ts` / `mermaid.ts` (MIT, REFERENCE only; they
 * are read from `research/upstream/CogniFlow`, never copied into this repository). They run in a
 * real browser page because the draw.io importer needs `DOMParser`.
 */
export function findCogniflow(repoRoot: string): string | undefined {
  const dir = resolve(repoRoot, "research/upstream/CogniFlow/src/lib/studio");
  return existsSync(join(dir, "drawio.ts")) && existsSync(join(dir, "mermaid.ts"))
    ? dir
    : undefined;
}

export async function bundleCogniflow(repoRoot: string, studioDir: string): Promise<string> {
  const scratch = resolve(repoRoot, "artifacts", "importer-eval");
  mkdirSync(scratch, { recursive: true });
  const entry = join(scratch, "cogniflow-entry.ts");
  const posix = studioDir.replace(/\\/g, "/");
  writeFileSync(
    entry,
    `import { importDrawio } from "${posix}/drawio";\nimport { importMermaid } from "${posix}/mermaid";\n(globalThis as unknown as { CF: unknown }).CF = { importDrawio, importMermaid };\n`,
  );
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    target: "es2023",
    write: false,
    logLevel: "silent",
    nodePaths: [resolve(studioDir, "../../../node_modules")],
  });
  return r.outputFiles[0]!.text;
}

interface AirNode {
  id: string;
  label: string;
  position: { x: number; y: number };
  group_id?: string | null;
}
interface AirEdge {
  source_node_id: string;
  target_node_id: string;
  label?: string;
  direction: "forward" | "reverse" | "bidirectional";
}
interface AirGraph {
  nodes: AirNode[];
  edges: AirEdge[];
  groups?: { id: string; label: string }[];
}

/**
 * AIR has no stroke style, routing or node size that importers fill in (stroke/routing are not
 * evaluated as "provided"; size is undefined) and no group nesting. Those gaps show up in the
 * scores as "not provided" rather than being guessed here.
 */
export function airToImported(graph: AirGraph, warnings: string[]): Imported {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const groups = graph.groups ?? [];
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));
  const notes = [...warnings];
  if (graph.nodes.some((n) => n.group_id) && groups.length === 0)
    notes.push(
      "nodes carry group_id but the graph defines no groups (group titles are not available)",
    );
  return {
    nodes: graph.nodes.map((n) => ({
      label: n.label,
      x: n.position.x,
      y: n.position.y,
      ...(n.group_id && groupLabel.has(n.group_id) ? { group: groupLabel.get(n.group_id)! } : {}),
    })),
    edges: graph.edges.map((e) => {
      const direction: Direction =
        e.direction === "bidirectional"
          ? "both"
          : e.direction === "reverse"
            ? "backward"
            : "forward";
      return {
        from: label.get(e.source_node_id) ?? e.source_node_id,
        to: label.get(e.target_node_id) ?? e.target_node_id,
        ...(e.label ? { label: e.label } : {}),
        direction,
      };
    }),
    groups: groups.map((g) => ({ label: g.label })),
    warnings: notes,
  };
}

export async function installCogniflow(page: Page, bundle: string): Promise<void> {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundle });
}

export async function runCogniflow(
  page: Page,
  kind: "drawio" | "mermaid",
  text: string,
): Promise<ImportOutcome> {
  const r = await page.evaluate(
    (k: string, src: string) => {
      const cf = (
        globalThis as unknown as {
          CF: {
            importDrawio(s: string): { graph: unknown; warnings: string[] };
            importMermaid(s: string): { graph: unknown; warnings: string[] };
          };
        }
      ).CF;
      try {
        const res = k === "drawio" ? cf.importDrawio(src) : cf.importMermaid(src);
        return { ok: true as const, graph: res.graph, warnings: res.warnings };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    },
    kind,
    text,
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, imported: airToImported(r.graph as AirGraph, r.warnings) };
}
