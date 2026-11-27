import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS_ID } from "@archflow/engine-host";
import type { DisplayListFrame, PixelFrame } from "./session.ts";

/** Fixtures covered by golden tests and the instants (ms) captured for each. */
export const GOLDEN_CASES = [
  {
    id: "linear-3",
    file: "linear-3.canonical.json",
    times: [0, 500, 1000, 1500, 2600, 3800, 5000],
  },
  {
    id: "order-flow",
    file: "order-flow.canonical.json",
    times: [0, 700, 1700, 2500, 3400, 4400, 5400, 6500, 7900, 8800, 9900, 10900, 12000, 16000],
  },
  {
    // regression fixture: orthogonal routing, connector semantics, health-check probes
    id: "aws-alb",
    file: "aws-alb.canonical.json",
    times: [0, 900, 1500, 2100, 2700, 6500, 7400, 8100, 12300, 13500, 17500],
  },
] as const;

export interface DisplayListGolden {
  schema: "archflow/golden-displaylist@1";
  metrics: string;
  fixture: string;
  frames: Record<string, { sha256: string; doubles: number; stringBytes: number }>;
}
export interface PixelGolden {
  schema: "archflow/golden-pixels@1";
  fixture: string;
  environment: string;
  frames: Record<string, { sha256: string; width: number; height: number }>;
}

export const goldenDir = (root: string, fixture: string): string =>
  join(root, "fixtures", "golden", fixture);
export const displayListPath = (root: string, fixture: string): string =>
  join(goldenDir(root, fixture), "displaylist.json");
export const pixelDir = (root: string, fixture: string, env: string): string =>
  join(goldenDir(root, fixture), "pixels", env);

export function toDisplayListGolden(
  fixture: string,
  frames: DisplayListFrame[],
): DisplayListGolden {
  return {
    schema: "archflow/golden-displaylist@1",
    metrics: METRICS_ID,
    fixture,
    frames: Object.fromEntries(
      frames.map((f) => [
        String(f.t),
        { sha256: f.sha256, doubles: f.doubles, stringBytes: f.stringBytes },
      ]),
    ),
  };
}

export function diffDisplayList(expected: DisplayListGolden, actual: DisplayListGolden): string[] {
  const out: string[] = [];
  if (expected.metrics !== actual.metrics)
    out.push(`metrics id changed: ${expected.metrics} -> ${actual.metrics}`);
  for (const t of new Set([...Object.keys(expected.frames), ...Object.keys(actual.frames)])) {
    const e = expected.frames[t];
    const a = actual.frames[t];
    if (!e) out.push(`t=${t}: no golden`);
    else if (!a) out.push(`t=${t}: not rendered`);
    else if (e.sha256 !== a.sha256)
      out.push(
        `t=${t}: display list differs (doubles ${e.doubles}->${a.doubles}, stringBytes ${e.stringBytes}->${a.stringBytes})`,
      );
  }
  return out;
}

export function writeDisplayListGolden(root: string, g: DisplayListGolden): void {
  mkdirSync(goldenDir(root, g.fixture), { recursive: true });
  writeFileSync(displayListPath(root, g.fixture), JSON.stringify(g, null, 2) + "\n");
}
export function readDisplayListGolden(
  root: string,
  fixture: string,
): DisplayListGolden | undefined {
  const p = displayListPath(root, fixture);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as DisplayListGolden) : undefined;
}

export function toPixelGolden(fixture: string, env: string, frames: PixelFrame[]): PixelGolden {
  return {
    schema: "archflow/golden-pixels@1",
    fixture,
    environment: env,
    frames: Object.fromEntries(
      frames.map((f) => [String(f.t), { sha256: f.sha256, width: f.width, height: f.height }]),
    ),
  };
}
export function writePixelGolden(dir: string, g: PixelGolden, frames: PixelFrame[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(g, null, 2) + "\n");
  for (const f of frames) writeFileSync(join(dir, `t${f.t}.png`), f.png);
}
export function readPixelGolden(dir: string): PixelGolden | undefined {
  const p = join(dir, "manifest.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as PixelGolden) : undefined;
}
export function diffPixels(expected: PixelGolden, actual: PixelGolden): string[] {
  const out: string[] = [];
  for (const t of new Set([...Object.keys(expected.frames), ...Object.keys(actual.frames)])) {
    const e = expected.frames[t];
    const a = actual.frames[t];
    if (!e) out.push(`t=${t}: no golden`);
    else if (!a) out.push(`t=${t}: not rendered`);
    else if (e.sha256 !== a.sha256 || e.width !== a.width || e.height !== a.height)
      out.push(`t=${t}: pixels differ (${e.width}x${e.height} -> ${a.width}x${a.height})`);
  }
  return out;
}
