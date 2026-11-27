import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { fillPlayerTemplate } from "@archflow/engine-host";
import { findChrome } from "./chrome.ts";

export interface EngineArtifacts {
  engineJs: string;
  template: string;
  hostBundle: string;
  engineJsSha256: string;
}

export function loadArtifacts(repoRoot: string): EngineArtifacts {
  const engine = join(repoRoot, "build", "engine", "ad_player_engine.js");
  const template = join(repoRoot, "build", "engine", "player-template.html");
  const host = join(repoRoot, "packages", "engine-host", "dist", "engine-host.iife.js");
  for (const [f, how] of [
    [engine, "npm run engine:build"],
    [template, "npm run engine:build"],
    [host, "npm run build"],
  ] as const)
    if (!existsSync(f)) throw new Error(`missing ${f}; run: ${how}`);
  const engineJs = readFileSync(engine, "utf8");
  return {
    engineJs,
    template: readFileSync(template, "utf8"),
    hostBundle: readFileSync(host, "utf8"),
    engineJsSha256: createHash("sha256").update(engineJs).digest("hex"),
  };
}

export async function launch(): Promise<{ browser: Browser; envId: string; version: string }> {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
    ],
  });
  const version = await browser.version(); // e.g. "HeadlessChrome/131.0.6778.85"
  const major = /\/(\d+)\./.exec(version)?.[1] ?? "unknown";
  return { browser, envId: `${process.platform}-${process.arch}-chrome${major}`, version };
}

const sha256 = (...parts: Uint8Array[]): string => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};

/** What the page-side bundle exposes (structurally typed; the page cannot import our types). */
interface PageHost {
  load(json: string): { ok: true; info: { durationMs: number } } | { ok: false; error: string };
  frame(t: number): { data: Float64Array; strings: Uint8Array };
}

export interface DisplayListFrame {
  t: number;
  sha256: string;
  doubles: number;
  stringBytes: number;
  /** Text content of the frame (for semantic assertions). */
  text: string;
}
export interface DisplayListRun {
  ok: true;
  durationMs: number;
  frames: DisplayListFrame[];
}
export interface EngineLoadFailure {
  ok: false;
  error: string;
}

/** Render display lists with deterministic text metrics in a fresh page (platform independent). */
export async function renderDisplayLists(
  browser: Browser,
  art: EngineArtifacts,
  engineDocumentJson: string,
  times: number[],
): Promise<DisplayListRun | EngineLoadFailure> {
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><meta charset=utf-8><title>qa</title>");
    await page.addScriptTag({ content: art.engineJs });
    await page.addScriptTag({ content: art.hostBundle });
    const raw = await page.evaluate(
      async (docJson: string, ts: number[]) => {
        const g = globalThis as unknown as {
          AdPlayerEngine: unknown;
          ArchFlowEngineHost: {
            EngineHost: { create(f: unknown, m: unknown): Promise<PageHost> };
            deterministicMeasureText: unknown;
          };
        };
        const host = await g.ArchFlowEngineHost.EngineHost.create(
          g.AdPlayerEngine,
          g.ArchFlowEngineHost.deterministicMeasureText,
        );
        const r = host.load(docJson);
        if (!r.ok) return { ok: false as const, error: String(r.error) };
        const b64 = (u8: Uint8Array): string => {
          let s = "";
          for (let i = 0; i < u8.length; i += 0x8000)
            s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          return btoa(s);
        };
        const frames = ts.map((t) => {
          const f = host.frame(t);
          return {
            t,
            data: b64(new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength)),
            strings: b64(f.strings),
          };
        });
        return { ok: true as const, durationMs: r.info.durationMs as number, frames };
      },
      engineDocumentJson,
      times,
    );
    if (!raw.ok) return raw;
    return {
      ok: true,
      durationMs: raw.durationMs,
      frames: raw.frames.map((f) => {
        const data = Buffer.from(f.data, "base64");
        const strings = Buffer.from(f.strings, "base64");
        return {
          t: f.t,
          sha256: sha256(data, Uint8Array.of(0), strings),
          doubles: data.length / 8,
          stringBytes: strings.length,
          text: strings.toString("utf8"),
        };
      }),
    };
  } finally {
    await page.close();
  }
}

export interface PixelFrame {
  t: number;
  sha256: string;
  width: number;
  height: number;
  png: Buffer;
}

export const VIEWPORT = { width: 1280, height: 560, deviceScaleFactor: 1 } as const;

/** Render pixels with the upstream canvas player (real browser fonts => environment specific). */
export async function renderPixels(
  browser: Browser,
  art: EngineArtifacts,
  engineDocumentJson: string,
  title: string,
  times: number[],
): Promise<PixelFrame[]> {
  const page: Page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setContent(fillPlayerTemplate(art.template, engineDocumentJson, title), {
      waitUntil: "load",
    });
    await page.waitForFunction(
      () => {
        const m = document.querySelector(".ad-message") as HTMLElement | null;
        return !!document.querySelector("canvas.ad-canvas") && (!m || m.hidden);
      },
      { timeout: 20_000 },
    );
    const out: PixelFrame[] = [];
    for (const t of times) {
      const r = await page.evaluate(async (time: number) => {
        window.postMessage({ type: "ad-player", action: "seek", time }, "*");
        await new Promise<void>((res) =>
          requestAnimationFrame(() => requestAnimationFrame(() => res())),
        );
        const c = document.querySelector("canvas.ad-canvas") as HTMLCanvasElement;
        const ctx = c.getContext("2d")!;
        const img = ctx.getImageData(0, 0, c.width, c.height);
        let s = "";
        const u8 = new Uint8Array(img.data.buffer);
        for (let i = 0; i < u8.length; i += 0x8000)
          s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return {
          w: c.width,
          h: c.height,
          rgba: btoa(s),
          png: c.toDataURL("image/png").split(",")[1] ?? "",
        };
      }, t);
      out.push({
        t,
        sha256: sha256(Buffer.from(r.rgba, "base64")),
        width: r.w,
        height: r.h,
        png: Buffer.from(r.png, "base64"),
      });
    }
    return out;
  } finally {
    await page.close();
  }
}
