import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Direction, Routing, Stroke } from "./corpus.ts";
import type { ImportOutcome, Imported } from "./score.ts";

/**
 * Reference importer: the native AnimatedDiagrams v2.2.0 CLI (`--convert`). It is a dev/oracle
 * tool only (Qt, not shippable to the browser). Located under `research/binaries/` after the
 * Phase 0 download; absent in CI, where its tests skip and the committed baseline is used.
 */
export function findNativeBinDir(repoRoot: string): string | undefined {
  const dir = resolve(
    repoRoot,
    "research/binaries/animated-diagrams-2.2.0/x/animated-diagrams-2.2.0-win64/bin",
  );
  return existsSync(join(dir, "animated-diagrams.exe")) ? dir : undefined;
}

interface EngineNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface EngineEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: { strokeStyle?: string; arrowStart?: string; arrowEnd?: string; routing?: string } | null;
}
interface EngineStep {
  type: string;
  from?: string;
  to?: string;
  label?: string;
  variant?: string;
}
interface EngineDoc {
  nodes: EngineNode[];
  edges: EngineEdge[];
  scenario?: { steps?: EngineStep[] };
}

/** Engine defaults observed in v2.2.0 output: arrowEnd = triangle, arrowStart = none. */
export function engineToImported(doc: EngineDoc, warnings: string[]): Imported {
  const label = new Map(doc.nodes.map((n) => [n.id, n.label]));
  return {
    nodes: doc.nodes.map((n) => ({ label: n.label, x: n.x, y: n.y, w: n.w, h: n.h })),
    edges: doc.edges.map((e) => {
      const start = e.style?.arrowStart ?? "none";
      const end = e.style?.arrowEnd ?? "triangle";
      const direction: Direction =
        start !== "none" && end !== "none"
          ? "both"
          : end !== "none"
            ? "forward"
            : start !== "none"
              ? "backward"
              : "none";
      const stroke = e.style?.strokeStyle;
      const routing = e.style?.routing;
      return {
        from: label.get(e.from) ?? e.from,
        to: label.get(e.to) ?? e.to,
        ...(e.label !== undefined ? { label: e.label } : {}),
        direction,
        stroke: (stroke === "dashed" ? "dashed" : "solid") as Stroke,
        ...(routing === "straight" || routing === "curved" || routing === "orthogonal"
          ? { routing: routing as Routing }
          : {}),
      };
    }),
    // Sequence diagrams arrive as ordered message steps (replies are success/response variants).
    messages: (doc.scenario?.steps ?? [])
      .filter((st) => st.type === "message" && st.from !== undefined && st.to !== undefined)
      .map((st) => ({
        from: label.get(st.from!) ?? st.from!,
        to: label.get(st.to!) ?? st.to!,
        ...(st.label ? { label: st.label } : {}),
        reply: st.variant === "success" || st.variant === "response",
      })),
    // The engine document v3 has no group concept: groups are dropped (reported via warnings).
    groups: [],
    warnings,
  };
}

export function runNative(binDir: string, scratch: string, inputPath: string): ImportOutcome {
  mkdirSync(scratch, { recursive: true });
  const out = join(scratch, `${basename(inputPath)}.json`);
  rmSync(out, { force: true });
  const r = spawnSync(
    join(binDir, "animated-diagrams.exe"),
    ["--convert", out, resolve(inputPath)],
    {
      cwd: binDir, // Windows: the exe loads Qt DLLs from its own directory
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const log = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const warnings = log
    .split(/\r?\n/)
    .filter((l) => /^(warning|warn)/i.test(l.trim()))
    .map((l) => l.trim());
  if (r.error) return { ok: false, error: `spawn failed: ${r.error.message}` };
  if (r.status !== 0 || !existsSync(out)) {
    const msg = log.split(/\r?\n/).find((l) => /error/i.test(l)) ?? `exit ${String(r.status)}`;
    return { ok: false, error: msg.trim() };
  }
  const doc = JSON.parse(readFileSync(out, "utf8")) as EngineDoc;
  return { ok: true, imported: engineToImported(doc, warnings) };
}
