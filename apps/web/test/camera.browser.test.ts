import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import {
  cameraBoundsAt,
  planCamera,
  serializeEngineDocument,
  toEngineDocument,
  type Bounds,
  type CameraPlan,
} from "@archflow/renderer-adapter";
import {
  GOLDEN_CASES,
  launch,
  loadArtifacts,
  renderContactSheet,
  type EngineArtifacts,
} from "@archflow/qa";
import { prepare } from "../src/pipeline.ts";
import { checkCamera, noIssues } from "./camera-check.ts";

/**
 * The automatic camera with the real engine: content bounds come from the WASM engine (with the
 * deterministic text metrics the display-list goldens use), every event stays visible, the
 * painter output is reproducible, the overview is pixel-identical to painting without a camera,
 * and the AWS ALB camera path is pinned by a platform-independent golden.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UPDATE = process.env["ARCHFLOW_GOLDEN_UPDATE"] === "1";
let browser: Browser;
let art: EngineArtifacts;
let page: Page;

beforeAll(async () => {
  art = loadArtifacts(root);
  browser = (await launch()).browser;
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><title>camera</title>");
  await page.addScriptTag({ content: art.engineJs });
  await page.addScriptTag({ content: art.hostBundle });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const fixture = (f: string): CanonicalDocument =>
  JSON.parse(readFileSync(join(root, "fixtures", "scenarios", f), "utf8")) as CanonicalDocument;

function engineJson(doc: CanonicalDocument): string {
  const r = toEngineDocument(doc, { groups: "flatten" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return serializeEngineDocument(r.document);
}

/** Engine content bounds with deterministic text metrics (platform independent). */
async function engineBounds(json: string): Promise<{ bounds: Bounds; durationMs: number }> {
  return page.evaluate(async (j: string) => {
    const g = globalThis as unknown as {
      AdPlayerEngine: unknown;
      ArchFlowEngineHost: {
        EngineHost: {
          create(
            f: unknown,
            m: unknown,
          ): Promise<{
            load(json: string): {
              ok: boolean;
              info?: { bounds: Bounds; durationMs: number };
              error?: string;
            };
          }>;
        };
        deterministicMeasureText: unknown;
      };
    };
    const host = await g.ArchFlowEngineHost.EngineHost.create(
      g.AdPlayerEngine,
      g.ArchFlowEngineHost.deterministicMeasureText,
    );
    const r = host.load(j);
    if (!r.ok || !r.info) throw new Error(r.error);
    return { bounds: r.info.bounds, durationMs: r.info.durationMs };
  }, json);
}

/** Paint frames with ArchFlow's painter (browser fonts) at the given bounds; PNG + pixel hash. */
async function paint(
  json: string,
  shots: { t: number; bounds: Bounds }[],
  size = { width: 1280, height: 720 },
): Promise<{ hash: string; png: Buffer }[]> {
  const raw = await page.evaluate(
    async (j: string, list: { t: number; bounds: Bounds }[], w: number, h: number) => {
      type Host = {
        EngineHost: {
          create(
            f: unknown,
            m: unknown,
          ): Promise<{
            load(j: string): { ok: boolean };
            frame(t: number): unknown;
            loaded: { background: string };
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
      host.load(j);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      const hidden = H.portMarkerKeys(j);
      const out: { rgba: number; png: string }[] = [];
      for (const s of list) {
        H.paintFrame(
          ctx,
          host.frame(s.t),
          {
            width: w,
            height: h,
            bounds: s.bounds,
            background: host.loaded.background || "#0a111f",
            hiddenMarkers: hidden,
          },
          text,
        );
        const d = ctx.getImageData(0, 0, w, h).data;
        let x = 0x811c9dc5;
        for (let i = 0; i < d.length; i++) x = Math.imul(x ^ d[i]!, 0x01000193);
        out.push({ rgba: x >>> 0, png: c.toDataURL("image/png").split(",")[1] ?? "" });
      }
      return out;
    },
    json,
    shots,
    size.width,
    size.height,
  );
  return raw.map((r) => ({ hash: String(r.rgba), png: Buffer.from(r.png, "base64") }));
}

function largePlatform(): string {
  const lines = [
    "title: Large platform",
    "Users -> Edge CDN : HTTPS",
    "Edge CDN -> API Gateway : forward",
  ];
  for (let i = 1; i <= 8; i++) {
    lines.push(`API Gateway -> Service ${i} : /v1/s${i}`);
    lines.push(`Service ${i} -> Store ${i} : read/write`);
    lines.push(`Service ${i} ..> Event Bus : event s${i}`);
  }
  for (let i = 1; i <= 14; i++) lines.push(`Event Bus ..> Consumer ${i} : deliver`);
  for (let i = 1; i <= 7; i++) lines.push(`Consumer ${i * 2} -> Warehouse ${i} : load batch`);
  lines.push("fail: Service 3 -> Store 3 timeout retries 2");
  return lines.join("\n") + "\n";
}

async function planned(doc: CanonicalDocument): Promise<{ json: string; plan: CameraPlan }> {
  const json = engineJson(doc);
  const { bounds, durationMs } = await engineBounds(json);
  return { json, plan: planCamera(doc, bounds, 16 / 9, durationMs) };
}

const sheetDir = join(root, "artifacts", "contact-sheets");
async function reviewSheet(
  name: string,
  title: string,
  json: string,
  plan: CameraPlan,
  times: number[],
): Promise<void> {
  const shots = await paint(
    json,
    times.map((t) => ({ t, bounds: cameraBoundsAt(plan, t) })),
  );
  const png = await renderContactSheet(browser, {
    title,
    subtitle: `automatic camera, 1280×720 · ${plan.reason}`,
    frames: shots.map((s, i) => ({ t: times[i]!, png: s.png, width: 1280, height: 720 })),
  });
  mkdirSync(sheetDir, { recursive: true });
  writeFileSync(join(sheetDir, `${name}.png`), png);
}

describe("automatic camera with the real engine", () => {
  it.each(["aws-alb", "order-flow"])(
    "%s: every event visible with the engine's own bounds",
    async (id) => {
      const c = GOLDEN_CASES.find((x) => x.id === id)!;
      const doc = fixture(c.file);
      const { plan } = await planned(doc);
      expect(checkCamera(doc, plan)).toEqual(noIssues);
    },
  );

  it("a 40-component platform: every event visible; review sheet written", async () => {
    const r = await prepare("text", largePlatform());
    if (!r.ok) throw new Error("prepare");
    const { json, plan } = await planned(r.document);
    expect(plan.enabled).toBe(true);
    expect(checkCamera(r.document, plan)).toEqual(noIssues);
    const stops = plan.segments.filter((s) => s.kind === "hold" && !s.overview);
    const times = [0, ...stops.flatMap((s) => [Math.round((s.t0 + s.t1) / 2)]), plan.durationMs];
    await reviewSheet(
      "large-platform-camera",
      "Large platform (41 components) — automatic camera",
      json,
      plan,
      times,
    );
  });

  it("the overview is pixel-identical to painting without a camera; frames are reproducible", async () => {
    const doc = fixture("order-flow.canonical.json");
    const { json, plan } = await planned(doc);
    expect(plan.enabled).toBe(true);
    const overviewT = plan.segments.find((s) => s.overview)!.t0;
    const zoomT = plan.segments.find((s) => s.kind === "hold" && !s.overview)!;
    const mid = Math.round((zoomT.t0 + zoomT.t1) / 2);
    const shots = [
      { t: overviewT, bounds: cameraBoundsAt(plan, overviewT) },
      { t: overviewT, bounds: plan.overview },
      { t: mid, bounds: cameraBoundsAt(plan, mid) },
      { t: mid, bounds: plan.overview },
    ];
    const a = await paint(json, shots);
    const b = await paint(json, shots);
    expect(b.map((x) => x.hash)).toEqual(a.map((x) => x.hash));
    expect(a[0]!.hash).toBe(a[1]!.hash); // overview == no camera
    expect(a[2]!.hash).not.toBe(a[3]!.hash); // zoomed in
    await reviewSheet(
      "order-flow-camera",
      "order-flow — automatic camera",
      json,
      plan,
      [0, 1700, 2600, 4400, 5400, 6500, 7900, 8800, 9900, 12000, 16000],
    );
  });

  it("camera golden: the AWS ALB camera path (platform independent)", async () => {
    const c = GOLDEN_CASES.find((x) => x.id === "aws-alb")!;
    const doc = fixture(c.file);
    const { plan } = await planned(doc);
    const times = [...new Set([...c.times, ...Array.from({ length: 37 }, (_, i) => i * 500)])].sort(
      (a, b) => a - b,
    );
    const actual = {
      schema: "archflow/golden-camera@1",
      fixture: c.id,
      aspect: "16:9",
      reason: plan.reason,
      segments: plan.segments.map((s) => ({
        kind: s.kind,
        t0: s.t0,
        t1: s.t1,
        overview: s.overview,
        focus: s.focus,
      })),
      bounds: Object.fromEntries(times.map((t) => [String(t), cameraBoundsAt(plan, t)])),
    };
    const file = join(root, "fixtures", "golden", c.id, "camera.json");
    if (UPDATE) {
      writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    expect(existsSync(file), "no camera golden; run: npm run golden:update").toBe(true);
    const expected = JSON.parse(readFileSync(file, "utf8")) as typeof actual;
    expect(actual).toEqual(expected);
    expect(createHash("sha256").update(JSON.stringify(actual)).digest("hex")).toBe(
      createHash("sha256").update(JSON.stringify(expected)).digest("hex"),
    );
  });
});
