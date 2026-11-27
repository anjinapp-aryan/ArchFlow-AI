import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import { fillPlayerTemplate } from "@archflow/engine-host";
import {
  THEMES,
  THEME_IDS,
  serializeEngineDocument,
  toEngineDocument,
  type ThemeId,
} from "@archflow/renderer-adapter";
import {
  VIEWPORT,
  launch,
  loadArtifacts,
  renderContactSheet,
  type EngineArtifacts,
} from "@archflow/qa";

/**
 * Themes with the real engine: the engine draws with the palette ArchFlow's contrast checks
 * assume (background, a node in its normal state, the unhealthy node), ArchFlow's painter
 * matches the upstream player pixel for pixel in every theme, and a review sheet is written.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let browser: Browser;
let art: EngineArtifacts;

beforeAll(async () => {
  art = loadArtifacts(root);
  browser = (await launch()).browser;
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const doc = JSON.parse(
  readFileSync(join(root, "fixtures", "scenarios", "aws-alb.canonical.json"), "utf8"),
) as CanonicalDocument;
const json = (theme: ThemeId): string => {
  const r = toEngineDocument(doc, { theme });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return serializeEngineDocument(r.document);
};
const hex = (rgb: number[]): string =>
  "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const near = (a: string, b: string, tol = 10): boolean =>
  [1, 3, 5].every(
    (i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= tol,
  );

interface Shot {
  background: string;
  samples: Record<string, string>;
  png: string;
  parity: number;
}

/** Paint with ArchFlow's painter next to the upstream player; sample node fills; count differing pixels. */
async function shoot(theme: ThemeId, t: number, nodes: string[]): Promise<Shot> {
  const j = json(theme);
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setContent(fillPlayerTemplate(art.template, j, theme), { waitUntil: "load" });
    await page.waitForFunction(() => {
      const m = document.querySelector(".ad-message") as HTMLElement | null;
      return !!document.querySelector("canvas.ad-canvas") && (!m || m.hidden);
    });
    await page.addScriptTag({ content: art.hostBundle });
    const boxes = Object.fromEntries(
      nodes.map((id) => {
        const n = doc.diagram.nodes.find((x) => x.id === id)!;
        // inside the box, clear of the title, the subtitle and the accent bar
        return [id, { x: n.x + n.w - 10, y: n.y + n.h - 6 }];
      }),
    );
    return await page
      .evaluate(
        async (docJson: string, time: number, pts: Record<string, { x: number; y: number }>) => {
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
          window.postMessage({ type: "ad-player", action: "seek", time }, "*");
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          );
          const up = document.querySelector("canvas.ad-canvas") as HTMLCanvasElement;
          const mine = document.createElement("canvas");
          mine.width = up.width;
          mine.height = up.height;
          const ctx = mine.getContext("2d", { willReadFrequently: true })!;
          const bg = host.loaded.background || "#0a111f";
          const [bx, by, bw, bh] = host.loaded.bounds;
          H.paintFrame(
            ctx,
            host.frame(time),
            { width: up.width, height: up.height, bounds: host.loaded.bounds, background: bg },
            text,
          );
          const a1 = up.getContext("2d")!.getImageData(0, 0, up.width, up.height).data;
          const a2 = ctx.getImageData(0, 0, up.width, up.height).data;
          let parity = 0;
          for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) parity++;
          const k = Math.min(up.width / bw, up.height / bh);
          const ox = (up.width - bw * k) / 2 - bx * k;
          const oy = (up.height - bh * k) / 2 - by * k;
          const samples: Record<string, number[]> = {};
          for (const [id, p] of Object.entries(pts)) {
            const d = ctx.getImageData(
              Math.round(ox + p.x * k),
              Math.round(oy + p.y * k),
              1,
              1,
            ).data;
            samples[id] = [d[0]!, d[1]!, d[2]!];
          }
          return {
            background: bg,
            samples,
            png: mine.toDataURL("image/png").split(",")[1] ?? "",
            parity,
          } as unknown as Shot;
        },
        j,
        t,
        boxes,
      )
      .then((r) => ({
        ...r,
        samples: Object.fromEntries(
          Object.entries(r.samples as unknown as Record<string, number[]>).map(([k, v]) => [
            k,
            hex(v),
          ]),
        ),
      }));
  } finally {
    await page.close();
  }
}

describe("themes with the real engine", () => {
  const shots = new Map<ThemeId, Shot>();
  it.each(THEME_IDS)(
    "%s: the engine paints the theme palette; painter == upstream player",
    async (id) => {
      const p = THEMES[id].palette;
      // t=0: every target normal; t=7300: Order API unhealthy (down)
      const idle = await shoot(id, 0, ["payment-api"]);
      const down = await shoot(id, 7300, ["order-api"]);
      shots.set(id, down);
      expect(idle.background.toLowerCase()).toBe(p.background);
      expect(idle.parity).toBe(0);
      expect(down.parity).toBe(0);
      expect(
        near(idle.samples["payment-api"]!, p.states.ok.fill),
        `${id} ok fill ${idle.samples["payment-api"]} vs ${p.states.ok.fill}`,
      ).toBe(true);
      expect(
        near(down.samples["order-api"]!, p.states.down.fill),
        `${id} down fill ${down.samples["order-api"]} vs ${p.states.down.fill}`,
      ).toBe(true);
    },
  );

  it("review sheet of every theme (artifacts/contact-sheets/themes-aws-alb.png)", async () => {
    const frames = THEME_IDS.map((id, i) => ({
      t: 7300,
      png: Buffer.from(shots.get(id)!.png, "base64"),
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      label: `${THEMES[id].label} (${id})${i === 0 ? " — today's look" : ""}`,
    }));
    const png = await renderContactSheet(browser, {
      title: "aws-alb at t = 7.3 s — themes: " + THEME_IDS.map((id) => THEMES[id].label).join(", "),
      subtitle: "Order API unhealthy, request routed to Payment API; ArchFlow painter, 1280×560",
      frames,
      columns: 2,
      cellWidth: 640,
    });
    const dir = join(root, "artifacts", "contact-sheets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "themes-aws-alb.png"), png);
  });
});
