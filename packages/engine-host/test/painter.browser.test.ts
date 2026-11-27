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
  // aws-alb covers ports, orthogonal waypoints, label anchors, probes and edge animations
  it.each(["order-flow", "linear-3", "aws-alb"])(
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
            portMarkerKeys(json: string): Set<string>;
          };
          const g = globalThis as unknown as { AdPlayerEngine: unknown; ArchFlowEngineHost: Host };
          const H = g.ArchFlowEngineHost;
          const text = new H.BrowserText(document.createElement("canvas").getContext("2d")!);
          const host = await H.EngineHost.create(g.AdPlayerEngine, text.measure);
          host.load(docJson);
          const up = document.querySelector("canvas.ad-canvas") as HTMLCanvasElement;
          const mine = document.createElement("canvas");
          const out: number[] = [];
          const hidden = H.portMarkerKeys(docJson);
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
            if (hidden.size > 0) {
              // with port markers hidden, pixels may differ only right around the ports
              const [bx, by, bw, bh] = host.loaded.bounds;
              const k = Math.min(up.width / bw, up.height / bh);
              const ox = (up.width - bw * k) / 2 - bx * k;
              const oy = (up.height - bh * k) / 2 - by * k;
              H.paintFrame(
                ctx,
                host.frame(t),
                {
                  width: up.width,
                  height: up.height,
                  bounds: host.loaded.bounds,
                  background: host.loaded.background || "#0a111f",
                  hiddenMarkers: hidden,
                },
                text,
              );
              const a3 = ctx.getImageData(0, 0, up.width, up.height).data;
              const ports = [...hidden].map((key) => key.split(",").map((v) => Number(v) / 4));
              let changed = 0;
              let outside = 0;
              for (let i = 0; i < a1.length; i += 4) {
                if (a1[i] === a3[i] && a1[i + 1] === a3[i + 1] && a1[i + 2] === a3[i + 2]) continue;
                changed++;
                const px = (((i / 4) % up.width) - ox) / k;
                const py = (Math.floor(i / 4 / up.width) - oy) / k;
                if (!ports.some(([x, y]) => Math.hypot(px - x!, py - y!) <= 8)) outside++;
              }
              out.push(changed > 0 ? 0 : -1, outside);
            }
          }
          return out;
        },
        json,
        times,
      );
      await page.close();
      // every entry is 0: identical pixels, and (with ports) hidden markers changed pixels only at ports
      expect(diffs.every((d) => d === 0)).toBe(true);
    },
    120_000,
  );
});
