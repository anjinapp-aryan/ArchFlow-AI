import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer-core";
import { launch, loadArtifacts, VIEWPORT } from "@archflow/qa";
import { serializeEngineDocument, toEngineDocument } from "@archflow/renderer-adapter";
import { fillPlayerTemplate } from "../src/index.ts";

/**
 * Prerequisite for dimming inactive components: engine `effect` steps (node opacity keyframes),
 * which ArchFlow has never emitted, must be painted by ArchFlow's painter exactly like the
 * upstream player paints them, and must really change the picture.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let browser: Browser;
beforeAll(async () => {
  browser = (await launch()).browser;
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** order-flow with effect steps: built-in fade-out/fade-in and a document-library hold effect. */
function withEffects(): { plain: string; dimmed: string } {
  const doc = JSON.parse(
    readFileSync(resolve(repoRoot, "fixtures/scenarios/order-flow.canonical.json"), "utf8"),
  ) as unknown;
  const a = toEngineDocument(doc);
  if (!a.ok) throw new Error("adapt");
  const plain = serializeEngineDocument(a.document);
  const d = JSON.parse(plain) as Record<string, unknown> & { scenario: { steps: unknown[] } };
  d["library"] = {
    effects: [
      {
        id: "archflow-dim-hold",
        label: "Dimmed",
        repeat: 1,
        tracks: [
          {
            property: "opacity",
            keys: [
              { t: 0, value: 0.35 },
              { t: 1, value: 0.35 },
            ],
          },
        ],
      },
    ],
  };
  for (const node of ["auth", "pg", "c2"])
    d.scenario.steps.push(
      {
        id: `dim-out-${node}`,
        type: "effect",
        start: 1000,
        duration: 200,
        nodeId: node,
        effect: "fade-out",
        intensity: 0.65,
      },
      {
        id: `dim-${node}`,
        type: "effect",
        start: 1200,
        duration: 3000,
        nodeId: node,
        effect: "archflow-dim-hold",
      },
      {
        id: `dim-in-${node}`,
        type: "effect",
        start: 4200,
        duration: 200,
        nodeId: node,
        effect: "fade-in",
        intensity: 0.65,
      },
    );
  return { plain, dimmed: JSON.stringify(d) };
}

describe("engine effects in ArchFlow's painter", () => {
  it("opacity effects: painter == upstream player, and the effect is visible", async () => {
    const art = loadArtifacts(repoRoot);
    const { plain, dimmed } = withEffects();
    const results: { t: number; parity: number; differsFromPlain: boolean }[] = [];
    for (const t of [500, 1100, 2500, 4300, 5000]) {
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      await page.setContent(fillPlayerTemplate(art.template, dimmed, "fx"), { waitUntil: "load" });
      await page.waitForFunction(() => {
        const m = document.querySelector(".ad-message") as HTMLElement | null;
        return !!document.querySelector("canvas.ad-canvas") && (!m || m.hidden);
      });
      await page.addScriptTag({ content: art.hostBundle });
      const r = await page.evaluate(
        async (fxJson: string, plainJson: string, time: number) => {
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
          window.postMessage({ type: "ad-player", action: "seek", time }, "*");
          await new Promise<void>((res) =>
            requestAnimationFrame(() => requestAnimationFrame(() => res())),
          );
          const up = document.querySelector("canvas.ad-canvas") as HTMLCanvasElement;
          const paint = async (j: string): Promise<Uint8ClampedArray> => {
            const host = await H.EngineHost.create(g.AdPlayerEngine, text.measure);
            host.load(j);
            const c = document.createElement("canvas");
            c.width = up.width;
            c.height = up.height;
            const ctx = c.getContext("2d")!;
            H.paintFrame(
              ctx,
              host.frame(time),
              {
                width: up.width,
                height: up.height,
                bounds: host.loaded.bounds,
                background: host.loaded.background || "#0a111f",
              },
              text,
            );
            return ctx.getImageData(0, 0, up.width, up.height).data;
          };
          const mine = await paint(fxJson);
          const base = await paint(plainJson);
          const upd = up.getContext("2d")!.getImageData(0, 0, up.width, up.height).data;
          let parity = 0;
          let diff = 0;
          for (let i = 0; i < mine.length; i++) {
            if (mine[i] !== upd[i]) parity++;
            if (mine[i] !== base[i]) diff++;
          }
          return { parity, differsFromPlain: diff > 0 };
        },
        dimmed,
        plain,
        t,
      );
      await page.close();
      results.push({ t, ...r });
    }
    // identical to the upstream player at every instant
    expect(results.map((r) => r.parity)).toEqual([0, 0, 0, 0, 0]);
    // dimmed while the effects run, unchanged before and after
    expect(results.map((r) => r.differsFromPlain)).toEqual([false, true, true, true, false]);
  }, 180_000);

  it("the adapter's dimming (dimInactive): painter == upstream player and visible", async () => {
    const art = loadArtifacts(repoRoot);
    const doc = JSON.parse(
      readFileSync(resolve(repoRoot, "fixtures/scenarios/order-flow.canonical.json"), "utf8"),
    ) as unknown;
    const a = toEngineDocument(doc, { dimInactive: true });
    const p = toEngineDocument(doc);
    if (!a.ok || !p.ok) throw new Error("adapt");
    const dimmed = serializeEngineDocument(a.document);
    const plain = serializeEngineDocument(p.document);
    const out: { parity: number; diff: number }[] = [];
    for (const t of [1000, 2500, 5400, 6500, 9900]) {
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      await page.setContent(fillPlayerTemplate(art.template, dimmed, "dim"), { waitUntil: "load" });
      await page.waitForFunction(() => {
        const m = document.querySelector(".ad-message") as HTMLElement | null;
        return !!document.querySelector("canvas.ad-canvas") && (!m || m.hidden);
      });
      await page.addScriptTag({ content: art.hostBundle });
      out.push(
        await page.evaluate(
          async (fxJson: string, plainJson: string, time: number) => {
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
            const g = globalThis as unknown as {
              AdPlayerEngine: unknown;
              ArchFlowEngineHost: Host;
            };
            const H = g.ArchFlowEngineHost;
            const text = new H.BrowserText(document.createElement("canvas").getContext("2d")!);
            window.postMessage({ type: "ad-player", action: "seek", time }, "*");
            await new Promise<void>((res) =>
              requestAnimationFrame(() => requestAnimationFrame(() => res())),
            );
            const up = document.querySelector("canvas.ad-canvas") as HTMLCanvasElement;
            const paint = async (j: string): Promise<Uint8ClampedArray> => {
              const host = await H.EngineHost.create(g.AdPlayerEngine, text.measure);
              host.load(j);
              const c = document.createElement("canvas");
              c.width = up.width;
              c.height = up.height;
              const ctx = c.getContext("2d")!;
              H.paintFrame(
                ctx,
                host.frame(time),
                {
                  width: up.width,
                  height: up.height,
                  bounds: host.loaded.bounds,
                  background: host.loaded.background || "#0a111f",
                },
                text,
              );
              return ctx.getImageData(0, 0, up.width, up.height).data;
            };
            const mine = await paint(fxJson);
            const base = await paint(plainJson);
            const upd = up.getContext("2d")!.getImageData(0, 0, up.width, up.height).data;
            let parity = 0;
            let diff = 0;
            for (let i = 0; i < mine.length; i++) {
              if (mine[i] !== upd[i]) parity++;
              if (mine[i] !== base[i]) diff++;
            }
            return { parity, diff };
          },
          dimmed,
          plain,
          t,
        ),
      );
      await page.close();
    }
    expect(out.map((r) => r.parity)).toEqual([0, 0, 0, 0, 0]);
    expect(out.some((r) => r.diff > 0)).toBe(true);
  }, 180_000);
});
