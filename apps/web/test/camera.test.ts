import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import {
  DEFAULT_CAMERA_OPTIONS,
  cameraBoundsAt,
  planCamera,
  type CameraPlan,
} from "@archflow/renderer-adapter";
import { prepare, type SourceKind } from "../src/pipeline.ts";
import { cameraFrameBounds } from "../src/framing.ts";
import { checkCamera, contentBounds, noIssues } from "./camera-check.ts";

const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");
const scenario = (f: string): CanonicalDocument =>
  JSON.parse(fx(`scenarios/${f}.canonical.json`)) as CanonicalDocument;

async function load(kind: SourceKind, text: string): Promise<CanonicalDocument> {
  const r = await prepare(kind, text);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.document;
}

const plan = (doc: CanonicalDocument, aspect = 16 / 9, o = {}): CameraPlan =>
  planCamera(doc, contentBounds(doc), aspect, doc.scenario!.durationMs, o);

/** A 40-component platform: gateway, 8 services, their stores, a bus and consumers. */
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

describe("automatic camera: policy", () => {
  it("stays on the overview for diagrams with six components or fewer", () => {
    const doc = scenario("linear-3");
    const p = plan(doc);
    expect(p.enabled).toBe(false);
    expect(p.reason).toMatch(/3 components/);
    for (let t = 0; t <= doc.scenario!.durationMs; t += 100)
      expect(cameraBoundsAt(p, t)).toEqual(p.overview);
    // the shared framing helper paints exactly the engine bounds, as before the camera existed
    expect(cameraFrameBounds(p.overview, p, 1234)).toBe(p.overview);
    expect(cameraFrameBounds([1, 2, 3, 4], undefined, 0)).toEqual([1, 2, 3, 4]);
  });

  it("every policy value is configurable", () => {
    const doc = scenario("aws-alb");
    expect(plan(doc, 16 / 9, { maxStaticNodes: 20 }).enabled).toBe(false);
    const tight = plan(doc, 16 / 9, { maxZoom: 1.5, minDwellMs: 1500, moveMs: 900 });
    expect(checkCamera(doc, tight)).toEqual(noIssues);
    expect(
      Math.max(...tight.segments.map((s) => Math.max(s.from.zoom, s.to.zoom))),
    ).toBeLessThanOrEqual(1.5);
    for (const s of tight.segments.filter((x) => x.kind === "move")) expect(s.t1 - s.t0).toBe(900);
    expect(DEFAULT_CAMERA_OPTIONS).toMatchObject({
      maxStaticNodes: 6,
      maxZoom: 2.2,
      minDwellMs: 1000,
    });
  });
});

describe("automatic camera: large diagrams", () => {
  it("AWS ALB (benchmark): never clips, keeps next destinations, ends on the overview with the summary", () => {
    const doc = scenario("aws-alb");
    const p = plan(doc);
    expect(checkCamera(doc, p)).toEqual(noIssues);
    // the layout is ~3:1 and fills a 16:9 frame's width: the camera zooms only where a frame cuts
    // nothing and keeps the next hop (target-group selection and backends), and never on the
    // left side while the response returns (the regression that clipped the backend)
    const stops = p.segments.filter((s) => s.kind === "hold" && !s.overview);
    expect(stops.length).toBeGreaterThanOrEqual(1);
    const response = doc.scenario!.events.find(
      (e) => e.type === "packet" && e.variant === "response" && e.to === "client",
    )!;
    for (const s of stops)
      expect(s.t1 <= response.t || s.t0 >= response.t + response.durationMs).toBe(true);
    expect(p.segments.some((s) => s.overview && s.t0 <= response.t && response.t < s.t1)).toBe(
      true,
    );
    // ending summary visible on the overview
    const summary = doc.scenario!.events.find((e) => e.type === "note" && e.text.startsWith("✓"))!;
    expect(cameraBoundsAt(p, summary.t + 100)).toEqual(p.overview);
    expect(cameraBoundsAt(p, doc.scenario!.durationMs)).toEqual(p.overview);
  });

  it("the left-side zoom that clipped the backend (before this fix) cannot happen", () => {
    // the plan the old rules made: hold on Client, ALB and Rule Engine while the response returns
    const doc = scenario("aws-alb");
    const old = plan(doc, 16 / 9, { context: false, safeMargin: 0 });
    for (const s of old.segments.filter((x) => x.kind === "hold" && !x.overview)) {
      const b = cameraBoundsAt(old, (s.t0 + s.t1) / 2);
      // even without the context rule, a frame never cuts a component or a label
      expect(checkCamera(doc, old).cut, `${s.t0}`).toEqual([]);
      expect(b[2]).toBeGreaterThan(0);
    }
  });

  it("order flow (8 components: parallel consumers, a timeout and retries) stays fully visible", () => {
    const doc = scenario("order-flow");
    const p = plan(doc);
    expect(checkCamera(doc, p)).toEqual(noIssues);
  });

  it("a 40-component platform with a long scenario: every event visible, smooth, bounded zoom", async () => {
    const doc = await load("text", largePlatform());
    expect(doc.diagram.nodes.length).toBeGreaterThanOrEqual(40);
    const t0 = performance.now();
    const p = plan(doc);
    const ms = performance.now() - t0;
    expect(p.enabled).toBe(true);
    expect(checkCamera(doc, p)).toEqual(noIssues);
    // every service broadcasts to 14 consumers (that needs the overview); the camera zooms in between
    expect(
      p.segments.filter((s) => s.kind === "hold" && !s.overview).length,
    ).toBeGreaterThanOrEqual(1);
    expect(ms).toBeLessThan(500);
  });

  it("portrait and square viewports plan their own framing and keep the rules", async () => {
    const doc = await load("text", largePlatform());
    for (const aspect of [9 / 16, 1, 21 / 9])
      expect(checkCamera(doc, plan(doc, aspect))).toEqual(noIssues);
  });
});

describe("automatic camera: sequence diagrams (parallel calls, failures, replies)", () => {
  it.each([
    ["15-sequence-rich.mmd", "mermaid"],
    ["11-sequence.mmd", "mermaid"],
    ["17-plantuml-sequence.puml", "plantuml"],
  ] as const)("%s", async (file, kind) => {
    const doc = await load(kind, fx(`diagrams/${file}`));
    const p = plan(doc);
    expect(checkCamera(doc, p)).toEqual(noIssues);
  });
});

describe("automatic camera: following packets (optional)", () => {
  it("follows lone packets along their real connectors and keeps them in view", async () => {
    const text =
      [
        "title: Pipeline",
        "Ingest -> Clean -> Join -> Enrich -> Score -> Rank -> Publish -> Archive",
      ].join("\n") + "\n";
    const doc = await load("text", text);
    // space the hops out so each packet travels alone with room to move on afterwards
    const events = doc.scenario!.events.filter(
      (e) => e.type === "packet" && e.variant === "request",
    );
    expect(events.length).toBeGreaterThan(4);
    let t = 2500;
    const spaced = events.map((e) => {
      const ev = { ...e, t, durationMs: 1600 };
      t += 1600 + 1400;
      return ev;
    });
    const d: CanonicalDocument = {
      ...doc,
      scenario: { ...doc.scenario!, events: spaced, flows: [], durationMs: t + 2500 },
    };
    const p = plan(d, 16 / 9, { followPackets: true });
    expect(p.segments.some((s) => s.kind === "follow")).toBe(true);
    expect(checkCamera(d, p)).toEqual(noIssues);
    const off = plan(d, 16 / 9, { followPackets: false });
    expect(off.segments.some((s) => s.kind === "follow")).toBe(false);
    expect(checkCamera(d, off)).toEqual(noIssues);
  });
});

describe("automatic camera: determinism and consistency", () => {
  it("the same input gives byte-identical plans and bounds", async () => {
    const a = await load("text", largePlatform());
    const b = await load("text", largePlatform());
    const pa = plan(a);
    const pb = plan(structuredClone(b));
    expect(JSON.stringify(pb)).toBe(JSON.stringify(pa));
    const times = Array.from({ length: 200 }, (_, i) => (i * pa.durationMs) / 199);
    expect(times.map((t) => cameraBoundsAt(pb, t))).toEqual(
      times.map((t) => cameraBoundsAt(pa, t)),
    );
  });

  it("playback and export use the same framing for the same aspect ratio", () => {
    const doc = scenario("aws-alb");
    const content = contentBounds(doc);
    // export plans for 1280x720, playback for a 16:9 canvas of another size: same aspect key
    const exportPlan = planCamera(doc, content, 1280 / 720, doc.scenario!.durationMs);
    const playbackPlan = planCamera(doc, content, 1920 / 1080, doc.scenario!.durationMs);
    for (let i = 0; i <= 534; i++) {
      const t = (i * 1000) / 30; // every export frame at 30 fps
      expect(cameraFrameBounds(content, playbackPlan, t)).toEqual(
        cameraFrameBounds(content, exportPlan, t),
      );
    }
  });

  it("never moves nodes or connectors: the document is not modified", () => {
    const doc = scenario("aws-alb");
    const before = JSON.stringify(doc);
    plan(doc, 16 / 9, { followPackets: true });
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("automatic camera: group zoom (shared camera system)", () => {
  const SRC = `flowchart LR
  user["User"] --> cdn["CDN"]
  subgraph vpc["VPC"]
    subgraph pub["Public subnet"]
      lb["Load Balancer"] --> web["Web"]
    end
    subgraph priv["Private subnet"]
      api["API"] --> orders["Orders"]
      orders --> db[("Orders DB")]
      api --> cache["Cache"]
    end
  end
  cdn --> lb
  web --> api
  subgraph ops["Operations"]
    audit["Audit"] --> logs["Log store"]
  end
  orders --> audit
`;

  it("frames the smallest group that contains the action, and never hides it", async () => {
    const base = await load("mermaid", SRC);
    expect(base.diagram.groups.every((g) => g.frame)).toBe(true);
    // the action stays inside the private subnet (the cache is part of it but not involved)
    const hop = (id: string, from: string, to: string, t: number) => ({
      type: "packet" as const,
      id,
      t,
      durationMs: 900,
      from,
      to,
      variant: "request" as const,
    });
    const events = [
      hop("p1", "api", "orders", 2500),
      hop("p2", "orders", "db", 3500),
      hop("p3", "db", "orders", 4500),
      hop("p4", "orders", "api", 5500),
    ];
    const doc: CanonicalDocument = {
      ...base,
      scenario: { ...base.scenario!, events, flows: [], durationMs: 9000 },
    };
    const snap = plan(doc, 16 / 9, { maxStaticNodes: 0 });
    const free = plan(doc, 16 / 9, { maxStaticNodes: 0, snapToGroups: false });
    expect(checkCamera(doc, snap)).toEqual(noIssues);
    expect(checkCamera(doc, free)).toEqual(noIssues);
    const stopBounds = (p: CameraPlan) => {
      const s = p.segments.find((x) => x.kind === "hold" && !x.overview)!;
      return cameraBoundsAt(p, (s.t0 + s.t1) / 2);
    };
    const members = doc.diagram.nodes.filter((n) => n.groupId === "priv");
    const shows = (b: number[], n: { x: number; y: number; w: number; h: number }) =>
      n.x >= b[0]! && n.y >= b[1]! && n.x + n.w <= b[0]! + b[2]! && n.y + n.h <= b[1]! + b[3]!;
    // snapped: the whole subnet is on screen, the cache included
    expect(members.every((n) => shows(stopBounds(snap), n))).toBe(true);
  });
});

describe("automatic camera: long sequence diagrams (readability experiment, kept as a regression)", () => {
  /** n participants, three passes of calls, replies, a parallel fan-out, a failure and a retry. */
  function longSequence(n: number): string {
    const lines = [
      "sequenceDiagram",
      ...Array.from({ length: n }, (_, i) => `participant P${i} as Service ${i}`),
    ];
    for (let k = 0; k < 3; k++)
      for (let i = 0; i + 1 < n; i++) lines.push(`P${i}->>P${i + 1}: call ${k}.${i}`);
    for (let i = n - 1; i > 0; i--) lines.push(`P${i}-->>P${i - 1}: reply ${i}`);
    lines.push(
      "par fan-out",
      `P0->>P${n - 1}: a`,
      "and",
      "P0->>P1: b",
      "end",
      "P2-xP3: fails",
      "P2->>P3: retry",
    );
    return lines.join("\n") + "\n";
  }

  it.each([8, 12])(
    "%i participants: every message visible, labels readable at the stops",
    async (n) => {
      const doc = await load("mermaid", longSequence(n));
      // participants form one row: the long axis is horizontal, so the camera pans sideways
      expect(new Set(doc.diagram.nodes.map((x) => x.y)).size).toBe(1);
      const p = plan(doc);
      expect(checkCamera(doc, p)).toEqual(noIssues);
      const o = p.overview;
      const px = (b: number[]): number => 12 * Math.min(1280 / b[2]!, 720 / b[3]!);
      const best = Math.max(
        ...p.segments
          .filter((s) => s.kind === "hold" && !s.overview)
          .map((s) => px(cameraBoundsAt(p, (s.t0 + s.t1) / 2))),
      );
      // never smaller than the overview; with 12 participants the camera makes labels larger
      // (next destinations and no cut components keep the frames wider than before)
      const zoomed = Number.isFinite(best) ? best : px(o);
      expect(zoomed).toBeGreaterThanOrEqual(px(o));
      if (n === 12) expect(zoomed).toBeGreaterThan(px(o) * 1.3);
    },
  );
});
