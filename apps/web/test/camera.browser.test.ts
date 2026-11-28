import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import {
  LABEL_MIN_PX,
  cameraBoundsAt,
  endingSummary,
  heldNotesAt,
  labelBoosts,
  labelScale,
  planCamera,
  serializeEngineDocument,
  toEngineDocument,
  type Bounds,
  type CameraPlan,
  type LabelBoost,
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

interface Shot {
  t: number;
  bounds: Bounds;
  /** Note cards held at full opacity (the app's ending-summary layer). */
  held?: readonly { x: number; y: number }[];
  /** Adaptive labels: boosts with the scale the app's framing helper gives at this zoom. */
  labels?: (LabelBoost & { scale: number })[];
  /** Device-pixel region to hash separately: x, y, w, h. */
  region?: [number, number, number, number];
}
/** The scale the app applies to each label in a frame painted at `bounds` (1280x720). */
const labelsAt = (
  boosts: LabelBoost[],
  bounds: Bounds,
  size = { width: 1280, height: 720 },
): (LabelBoost & { scale: number })[] => {
  const k = Math.min(size.width / bounds[2], size.height / bounds[3]);
  return boosts.map((b) => ({ ...b, scale: labelScale(b, 12 * k, LABEL_MIN_PX) }));
};

/** Paint frames with ArchFlow's painter (browser fonts) at the given bounds; PNG + pixel hash. */
async function paint(
  json: string,
  shots: Shot[],
  size = { width: 1280, height: 720 },
): Promise<
  { hash: string; png: Buffer; region?: string; labelsDrawn: string[]; labelsMatched: string[] }[]
> {
  const raw = await page.evaluate(
    async (j: string, list: Shot[], w: number, h: number) => {
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
      const out: {
        rgba: number;
        png: string;
        region?: string;
        labelsDrawn: string[];
        labelsMatched: string[];
      }[] = [];
      for (const s of list) {
        const drawn: string[] = [];
        const matched: string[] = [];
        // the same matching rule as apps/web/src/framing.ts labelScaler
        const labelScale = s.labels
          ? (str: string, x: number, y: number): number => {
              drawn.push(str);
              const b = s.labels!.find(
                (c) => c.text === str && Math.abs(c.cx - x) <= c.w / 2 && Math.abs(c.cy - y) <= c.h,
              );
              if (b) matched.push(str);
              return b ? b.scale : 1;
            }
          : undefined;
        H.paintFrame(
          ctx,
          host.frame(s.t),
          {
            width: w,
            height: h,
            bounds: s.bounds,
            background: host.loaded.background || "#0a111f",
            hiddenMarkers: hidden,
            ...(s.held ? { heldNotes: s.held } : {}),
            ...(labelScale ? { labelScale } : {}),
          },
          text,
        );
        const hash = (d: Uint8ClampedArray): string => {
          let x = 0x811c9dc5;
          for (let i = 0; i < d.length; i++) x = Math.imul(x ^ d[i]!, 0x01000193);
          return String(x >>> 0);
        };
        const d = ctx.getImageData(0, 0, w, h).data;
        out.push({
          rgba: Number(hash(d)),
          png: c.toDataURL("image/png").split(",")[1] ?? "",
          ...(s.region
            ? {
                region: hash(
                  ctx.getImageData(s.region[0], s.region[1], s.region[2], s.region[3]).data,
                ),
              }
            : {}),
          labelsDrawn: drawn,
          labelsMatched: matched,
        });
      }
      return out;
    },
    json,
    shots,
    size.width,
    size.height,
  );
  return raw.map((r) => ({
    hash: String(r.rgba),
    png: Buffer.from(r.png, "base64"),
    ...(r.region !== undefined ? { region: r.region } : {}),
    labelsDrawn: r.labelsDrawn,
    labelsMatched: r.labelsMatched,
  }));
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
    const steps = Math.floor(doc.scenario!.durationMs / 500) + 1;
    const times = [
      ...new Set([...c.times, ...Array.from({ length: steps }, (_, i) => i * 500)]),
    ].sort((a, b) => a - b);
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

/** The seven moments of the AWS ALB benchmark, found from the scenario (not hard-coded times). */
export function albMoments(doc: CanonicalDocument): { label: string; t: number }[] {
  const ev = doc.scenario!.events;
  const mid = (p: (typeof ev)[number] | undefined): number =>
    p ? Math.round(p.t + p.durationMs / 2) : 0;
  const pkt = (from: string, to?: string, variant?: string) =>
    ev.find(
      (e) =>
        e.type === "packet" &&
        e.from === from &&
        (to === undefined || e.to === to) &&
        (variant === undefined || e.variant === variant),
    );
  const down = ev.find((e) => e.type === "node_state" && e.state === "down");
  // the last probe round: health checks while the request is being answered
  const probes = ev.filter(
    (e) => e.type === "packet" && e.variant === "probe" && e.to === "order-api",
  );
  return [
    { label: "1 initial overview", t: 0 },
    { label: "2 Client → ALB", t: mid(pkt("client", "alb-listener-443")) },
    { label: "3 ALB → Rule Engine", t: mid(pkt("alb-listener-443", "rule-engine", "request")) },
    { label: "4 target group selection", t: mid(pkt("rule-engine", "api-tg", "request")) },
    { label: "5 backend processing", t: mid(pkt("api-tg", "payment-api", "request")) },
    { label: "6 health-check probes", t: mid(probes.at(-1)) },
    { label: "6b target unhealthy", t: down ? down.t + 300 : 0 },
    { label: "6c response back to Client", t: mid(pkt("alb-listener-443", "client")) },
    { label: "7 final frame (summary)", t: doc.scenario!.durationMs },
  ];
}

describe("AWS ALB benchmark sheet", () => {
  it("renders the inspection moments with the automatic camera (artifacts/contact-sheets)", async () => {
    const doc = fixture("aws-alb.canonical.json");
    const { json, plan } = await planned(doc);
    const moments = albMoments(doc);
    const summary = endingSummary(doc);
    const boosts = labelBoosts(doc);
    const shots = await paint(
      json,
      moments.map((m) => {
        const bounds = cameraBoundsAt(plan, m.t);
        return {
          t: m.t,
          bounds,
          held: heldNotesAt(summary, m.t),
          labels: labelsAt(boosts, bounds),
        };
      }),
    );
    const png = await renderContactSheet(browser, {
      title: `aws-alb benchmark — ${process.env["ARCHFLOW_SHEET_TAG"] ?? "current"}`,
      subtitle: `automatic camera, 1280×720 · ${plan.reason}`,
      frames: shots.map((s, i) => ({
        t: moments[i]!.t,
        png: s.png,
        width: 1280,
        height: 720,
        label: `${moments[i]!.label} · t = ${(moments[i]!.t / 1000).toFixed(2)} s`,
      })),
      columns: 2,
      cellWidth: 640,
    });
    mkdirSync(sheetDir, { recursive: true });
    writeFileSync(
      join(sheetDir, `aws-alb-benchmark-${process.env["ARCHFLOW_SHEET_TAG"] ?? "current"}.png`),
      png,
    );

    // before/after: the previous version (artifacts/alb-before, saved from the last commit) and
    // this one, moment by moment, same 1280x720 viewport and camera rules
    const beforeFile = join(root, "artifacts", "alb-before", "aws-alb.canonical.json");
    if (!existsSync(beforeFile)) return;
    const old = JSON.parse(readFileSync(beforeFile, "utf8")) as CanonicalDocument;
    const before = await planned(old);
    const oldMoments = albMoments(old);
    const oldShots = await paint(
      before.json,
      oldMoments.map((m) => ({ t: m.t, bounds: cameraBoundsAt(before.plan, m.t) })),
    );
    const frames = moments.flatMap((m, i) => [
      {
        t: oldMoments[i]!.t,
        png: oldShots[i]!.png,
        width: 1280,
        height: 720,
        label: `BEFORE · ${oldMoments[i]!.label} · t = ${(oldMoments[i]!.t / 1000).toFixed(2)} s`,
      },
      {
        t: m.t,
        png: shots[i]!.png,
        width: 1280,
        height: 720,
        label: `AFTER · ${m.label} · t = ${(m.t / 1000).toFixed(2)} s`,
      },
    ]);
    const cmp = await renderContactSheet(browser, {
      title: "aws-alb — before (left) / after (right)",
      subtitle:
        "1280×720, automatic camera · after: one target group per request, summary held to the last frame, adaptive labels",
      frames,
      columns: 2,
      cellWidth: 640,
    });
    writeFileSync(join(sheetDir, "aws-alb-before-after.png"), cmp);
  });

  it("the app's layers: every connector label matched, summary held through the final frame", async () => {
    const doc = fixture("aws-alb.canonical.json");
    const { json, plan } = await planned(doc);
    const s = endingSummary(doc)!;
    const end = doc.scenario!.durationMs;
    const boosts = labelBoosts(doc);
    // summary card in device px (the camera is on the overview during the summary)
    const b = cameraBoundsAt(plan, end);
    expect(b).toEqual(plan.overview);
    const k = Math.min(1280 / b[2], 720 / b[3]);
    const ox = (1280 - b[2] * k) / 2 - b[0] * k;
    const oy = (720 - b[3] * k) / 2 - b[1] * k;
    const region: [number, number, number, number] = [
      Math.max(0, Math.floor(s.x * k + ox)),
      Math.max(0, Math.floor(s.y * k + oy)),
      Math.ceil(200 * k),
      Math.ceil(30 * k),
    ];
    const mid = Math.round((s.t0 + s.t1) / 2);
    const r = await paint(json, [
      { t: mid, bounds: b, region },
      { t: mid, bounds: b, region, held: heldNotesAt(s, mid) },
      { t: end, bounds: b, region },
      { t: end, bounds: b, region, held: heldNotesAt(s, end) },
      { t: 0, bounds: b, labels: labelsAt(boosts, b) },
      { t: 0, bounds: b },
    ]);
    // fully faded in: the hold changes nothing; on the final frame the engine has faded the card
    // out, the hold shows it exactly as it was while fully visible
    expect(r[1]!.hash).toBe(r[0]!.hash);
    expect(r[2]!.region).not.toBe(r[0]!.region);
    expect(r[3]!.region).toBe(r[0]!.region);
    // every connector label the engine draws is found by the label layer, and enlarged
    expect(r[4]!.labelsDrawn.length).toBeGreaterThan(0);
    expect(r[4]!.labelsMatched).toEqual(r[4]!.labelsDrawn);
    expect(r[4]!.hash).not.toBe(r[5]!.hash);
  });
});
