import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";
import { GOLDEN_CASES, pixelDir, readPixelGolden } from "./golden.ts";

/**
 * Contact sheets: every selected golden frame of one case tiled into a single image, each with its
 * timestamp, under a header naming the case and scenario. For reviewing and approving goldens.
 *
 * Read-only with respect to the goldens: frames are read from `fixtures/golden/<case>/pixels/<env>`
 * and the sheet is returned as bytes; callers decide where to write it (never into `fixtures/`).
 * Layout is pure arithmetic; drawing happens on a canvas in Chrome, so the bytes are reproducible
 * within one browser/OS environment (fonts differ between environments, like pixel goldens).
 */

export interface ContactSheetFrame {
  /** Instant of the frame in milliseconds. */
  t: number;
  png: Buffer;
  width: number;
  height: number;
  /** Caption under the frame (default: the instant). */
  label?: string;
}

export interface ContactSheetSpec {
  title: string;
  /** Second header line, e.g. environment and frame count. */
  subtitle: string;
  frames: ContactSheetFrame[];
  /** Columns of the grid (default 3). */
  columns?: number;
  /** Width of one cell's image in pixels (default 420). */
  cellWidth?: number;
}

export interface CellBox {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  labelY: number;
}
export interface ContactSheetLayout {
  width: number;
  height: number;
  titleY: number;
  subtitleY: number;
  cells: CellBox[];
}

const MARGIN = 24;
const GAP = 16;
const HEADER = 76;
const LABEL = 26;

/** Grid positions for the frames (pure; the sheet is drawn exactly here). */
export function contactSheetLayout(spec: ContactSheetSpec): ContactSheetLayout {
  const cols = Math.max(1, Math.min(spec.columns ?? 3, spec.frames.length || 1));
  const cw = Math.round(spec.cellWidth ?? 420);
  const ratio = spec.frames.reduce((m, f) => Math.max(m, f.height / f.width), 0) || 0.5625;
  const ch = Math.round(cw * ratio);
  const rows = Math.max(1, Math.ceil(spec.frames.length / cols));
  const cells = spec.frames.map((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cw + GAP);
    const y = MARGIN + HEADER + row * (ch + LABEL + GAP);
    const h = Math.round((cw * f.height) / f.width);
    return { t: f.t, x, y, w: cw, h, labelY: y + ch + 18 };
  });
  return {
    width: MARGIN * 2 + cols * cw + (cols - 1) * GAP,
    height: MARGIN * 2 + HEADER + rows * (ch + LABEL) + (rows - 1) * GAP,
    titleY: MARGIN + 26,
    subtitleY: MARGIN + 54,
    cells,
  };
}

export const formatInstant = (t: number): string => `t = ${(t / 1000).toFixed(1)} s  (${t} ms)`;

/** Draw the sheet in a fresh page and return it as PNG bytes. */
export async function renderContactSheet(
  browser: Browser,
  spec: ContactSheetSpec,
): Promise<Buffer> {
  const layout = contactSheetLayout(spec);
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><meta charset=utf-8><title>contact sheet</title>");
    const b64 = await page.evaluate(
      async (
        l: ContactSheetLayout,
        title: string,
        subtitle: string,
        imgs: string[],
        labels: string[],
      ) => {
        const c = document.createElement("canvas");
        c.width = l.width;
        c.height = l.height;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, l.width, l.height);
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 22px Arial, Helvetica, sans-serif";
        ctx.fillText(title, 24, l.titleY);
        ctx.fillStyle = "#475569";
        ctx.font = "15px Arial, Helvetica, sans-serif";
        ctx.fillText(subtitle, 24, l.subtitleY);
        for (let i = 0; i < l.cells.length; i++) {
          const cell = l.cells[i]!;
          const img = new Image();
          img.src = `data:image/png;base64,${imgs[i]}`;
          await img.decode();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h);
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 1;
          ctx.strokeRect(cell.x - 0.5, cell.y - 0.5, cell.w + 1, cell.h + 1);
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 14px Arial, Helvetica, sans-serif";
          ctx.fillText(labels[i]!, cell.x, cell.labelY);
        }
        return c.toDataURL("image/png").split(",")[1] ?? "";
      },
      layout,
      spec.title,
      spec.subtitle,
      spec.frames.map((f) => f.png.toString("base64")),
      spec.frames.map((f) => f.label ?? formatInstant(f.t)),
    );
    return Buffer.from(b64, "base64");
  } finally {
    await page.close();
  }
}

export interface GoldenSheetSource {
  spec: ContactSheetSpec;
  /** sha256 of every source PNG, keyed by instant (lets callers prove the goldens were not touched). */
  sources: Record<string, string>;
}

/**
 * Collect the recorded pixel goldens of one case for `env` (all instants, or only `times`).
 * Throws when the case, the environment or a requested instant has no recorded golden.
 */
export function goldenSheetSource(
  root: string,
  caseId: string,
  env: string,
  times?: readonly number[],
): GoldenSheetSource {
  const c = GOLDEN_CASES.find((x) => x.id === caseId);
  if (!c)
    throw new Error(
      `unknown golden case ${caseId} (known: ${GOLDEN_CASES.map((x) => x.id).join(", ")})`,
    );
  const dir = pixelDir(root, caseId, env);
  const manifest = readPixelGolden(dir);
  if (!manifest) throw new Error(`no pixel goldens for ${caseId} in environment ${env} (${dir})`);
  const recorded = Object.keys(manifest.frames)
    .map(Number)
    .sort((a, b) => a - b);
  const wanted = times ? [...times] : recorded;
  const missing = wanted.filter((t) => !recorded.includes(t));
  if (missing.length > 0)
    throw new Error(
      `${caseId}: no golden frame at ${missing.join(", ")} ms (recorded: ${recorded.join(", ")})`,
    );
  const canonical = JSON.parse(
    readFileSync(join(root, "fixtures", "scenarios", c.file), "utf8"),
  ) as {
    diagram?: { name?: string };
  };
  const sources: Record<string, string> = {};
  const frames = wanted.map((t) => {
    const p = join(dir, `t${t}.png`);
    if (!existsSync(p)) throw new Error(`missing ${p}`);
    const png = readFileSync(p);
    const m = manifest.frames[String(t)]!;
    sources[String(t)] = createHash("sha256").update(png).digest("hex");
    return { t, png, width: m.width, height: m.height };
  });
  return {
    spec: {
      title: `${caseId} — ${canonical.diagram?.name ?? c.file}`,
      subtitle: `${frames.length} golden frame(s) · environment ${env} · fixture ${c.file}`,
      frames,
    },
    sources,
  };
}
