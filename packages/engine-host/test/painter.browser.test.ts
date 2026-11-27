import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer-core";
import { launch, loadArtifacts, VIEWPORT } from "@archflow/qa";
import { serializeEngineDocument, toEngineDocument } from "@archflow/renderer-adapter";
import { fillPlayerTemplate } from "../src/index.ts";

/**
 * Pixel parity: ArchFlow's TypeScript painter must draw exactly what the upstream player draws
 * for the same display list, fonts and canvas size (it is a port; this guards the port).
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let browser: Browser;
beforeAll(async () => {
  browser = (await launch()).browser;
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe("painter parity with the upstream player", () => {
  it.each(["order-flow", "linear-3"])(
    "%s: identical pixels at several instants",
    async (name) => {
      const art = loadArtifacts(repoRoot);
      const doc = JSON.parse(
        readFileSync(resolve(repoRoot, `fixtures/scenarios/${name}.canonical.json`), "utf8"),
      ) as unknown;
      const a = toEngineDocument(doc);
      if (!a.ok) throw new Error("adapt");
      const json = serializeEngineDocument(a.document);
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      await page.setContent(fillPlayerTemplate(art.template, json, name), { waitUntil: "load" });
      await page.waitForFunction(() => {
        const m = document.querySelector(".ad-message") as HTMLElement | null;
        return !!document.querySelector("canvas.ad-canvas") && (!m || m.hidden);
      });
      await page.addScriptTag({ content: art.hostBundle });
      const times = [0, 1500, 5500, 7700, 11000];
      const diffs = await page.evaluate(
        async (docJson: string, ts: number[]) => {
          type Host = {
            EngineHost: {
              create(
                f: unknown,
                m: unknown,
              ): Promise<{
                load(j: string): { ok: boolean };
                frame(t: number): unknown;
                loaded: { bounds: [number, number, number, number]; background: string };
              }>;
            };
            BrowserText: new (ctx: CanvasRenderingContext2D) => { measure: unknown };
            paintFrame(
              ctx: CanvasRenderingContext2D,
              list: unknown,
              framing: unknown,
              text: unknown,
            ): void;
          };
          const g = globalThis as unknown as { AdPlayerEngine: unknown; ArchFlowEngineHost: Host };
          const H = g.ArchFlowEngineHost;
          const text = new H.BrowserText(document.createElement("canvas").getContext("2d")!);
          const host = await H.EngineHost.create(g.AdPlayerEngine, text.measure);
          host.load(docJson);
          const up = document.querySelector("canvas.ad-canvas") as HTMLCanvasElement;
          const mine = document.createElement("canvas");
          const out: number[] = [];
          for (const t of ts) {
            window.postMessage({ type: "ad-player", action: "seek", time: t }, "*");
            await new Promise<void>((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => r())),
            );
            mine.width = up.width;
            mine.height = up.height;
            const ctx = mine.getContext("2d")!;
            H.paintFrame(
              ctx,
              host.frame(t),
              {
                width: up.width,
                height: up.height,
                bounds: host.loaded.bounds,
                background: host.loaded.background || "#0a111f",
              },
              text,
            );
            const a1 = up.getContext("2d")!.getImageData(0, 0, up.width, up.height).data;
            const a2 = ctx.getImageData(0, 0, up.width, up.height).data;
            let d = 0;
            for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) d++;
            out.push(d);
          }
          return out;
        },
        json,
        times,
      );
      await page.close();
      expect(diffs).toEqual(times.map(() => 0));
    },
    120_000,
  );
});
