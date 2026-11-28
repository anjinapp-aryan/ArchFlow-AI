import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument, Rect } from "@archflow/canonical-model";
import {
  LABEL_MIN_PX,
  NOTE_FADE,
  cameraBoundsAt,
  endingSummary,
  heldNotesAt,
  labelBox,
  labelBoosts,
  labelScale,
  planCamera,
  type Bounds,
  type LabelBoost,
} from "@archflow/renderer-adapter";
import { prepare, type SourceKind } from "../src/pipeline.ts";
import { heldNotes, labelScaler } from "../src/framing.ts";
import { contentBounds } from "./camera-check.ts";

/**
 * Readability gates: adaptive connector labels (free-space-bounded enlargement at render time)
 * at 1280x720 and 1920x1080, and the ending summary held to the last frame. Writes
 * artifacts/qa/label-readability.md.
 */
const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

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
  return lines.join("\n") + "\n";
}

const CASES: [string, SourceKind, string][] = [
  ["aws-alb", "text", fx("regression/aws-alb.txt")],
  ["order-flow", "text", fx("benchmark/order-flow.txt")],
  ["large-platform", "text", largePlatform()],
];
const SIZES = [
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
];
const LABEL_PX = 12;

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const insideB = (b: Bounds, r: Rect): boolean =>
  r.x >= b[0] && r.y >= b[1] && r.x + r.w <= b[0] + b[2] && r.y + r.h <= b[1] + b[3];
const outsideB = (b: Bounds, r: Rect): boolean =>
  r.x + r.w <= b[0] || r.y + r.h <= b[1] || r.x >= b[0] + b[2] || r.y >= b[1] + b[3];
const fit = (b: Bounds, s: { w: number; h: number }): number => Math.min(s.w / b[2], s.h / b[3]);
const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};

/** Boosted label boxes for a frame shown at world bounds `b` on a `size` viewport. */
function frameLabels(
  boosts: LabelBoost[],
  b: Bounds,
  size: { w: number; h: number },
): { box: Rect; px: number; base: Rect; boost: LabelBoost }[] {
  const k = fit(b, size);
  return boosts.map((boost) => {
    const s = labelScale(boost, LABEL_PX * k, LABEL_MIN_PX);
    return { box: labelBox(boost, s), px: LABEL_PX * k * s, base: labelBox(boost, 1), boost };
  });
}

interface Measure {
  name: string;
  size: string;
  overviewBefore: number;
  overviewMin: number;
  overviewMedian: number;
  stopBefore: number | undefined;
  stopMin: number | undefined;
  enlarged: number;
  labels: number;
}

describe("adaptive connector labels", () => {
  const rows: Measure[] = [];

  it.each(CASES)("%s: readable labels, no collision, no clipping", async (name, kind, text) => {
    const p = await prepare(kind, text);
    if (!p.ok) throw new Error(JSON.stringify(p.issues));
    const doc = p.document;
    const boosts = labelBoosts(doc);
    expect(boosts.length).toBeGreaterThan(0);
    for (const b of boosts) {
      expect(b.max).toBeGreaterThanOrEqual(1);
      expect(b.max).toBeLessThanOrEqual(1.5);
    }
    const nodes = doc.diagram.nodes as Rect[];
    const overview = contentBounds(doc);
    for (const size of SIZES) {
      const check = (b: Bounds, where: string, held: boolean): number[] => {
        const ls = frameLabels(boosts, b, size);
        for (const l of ls) {
          // no new collision: with components, or with another label
          for (const n of nodes)
            if (overlap(l.box, n))
              expect(overlap(l.base, n), `${name} ${where}: "${l.boost.text}" on a node`).toBe(
                true,
              );
          for (const o of ls)
            if (o !== l && overlap(l.box, o.box))
              expect(
                overlap(l.base, o.base),
                `${name} ${where}: "${l.boost.text}" on a label`,
              ).toBe(true);
          // never cut by the frame edge on held frames
          if (held)
            expect(
              insideB(b, l.box) || outsideB(b, l.box),
              `${name} ${where}: "${l.boost.text}" clipped`,
            ).toBe(true);
        }
        return ls.filter((l) => insideB(b, l.box)).map((l) => l.px);
      };
      const ov = check(overview, `${size.w}x${size.h} overview`, true);
      // the enlargement never shrinks a label, and labels below the target grow where they can
      const before = LABEL_PX * fit(overview, size);
      expect(Math.min(...ov)).toBeGreaterThanOrEqual(before - 1e-9);
      const plan = planCamera(doc, overview, size.w / size.h, doc.scenario!.durationMs);
      const stops = plan.segments.filter((s) => s.kind === "hold" && !s.overview);
      const stopPx = stops.flatMap((s) =>
        check(cameraBoundsAt(plan, (s.t0 + s.t1) / 2), `${size.w}x${size.h} stop ${s.t0}`, true),
      );
      rows.push({
        name,
        size: `${size.w}×${size.h}`,
        overviewBefore: before,
        overviewMin: Math.min(...ov),
        overviewMedian: median(ov),
        stopBefore: stops.length
          ? Math.max(
              ...stops.map((s) => LABEL_PX * fit(cameraBoundsAt(plan, (s.t0 + s.t1) / 2), size)),
            )
          : undefined,
        stopMin: stopPx.length ? Math.min(...stopPx) : undefined,
        enlarged: boosts.filter((b) => b.max > 1).length,
        labels: boosts.length,
      });
    }
  });

  it("ALB overview at 720p: labels reach the target size where the space allows", () => {
    const r = rows.find((x) => x.name === "aws-alb" && x.size === "1280×720")!;
    expect(r).toBeDefined();
    expect(r.overviewBefore).toBeLessThan(LABEL_MIN_PX);
    expect(r.overviewMedian).toBeGreaterThan(r.overviewBefore * 1.15);
    // at 1080p the labels are already readable and drawn exactly as laid out
    const hd = rows.find((x) => x.name === "aws-alb" && x.size === "1920×1080")!;
    expect(hd.overviewMin).toBeGreaterThanOrEqual(hd.overviewBefore);
  });

  it("the painter's label matcher finds labels by text and anchor (framing helper)", () => {
    const b: LabelBoost = { text: "x", cx: 100, cy: 50, max: 1.4, w: 40, h: 20 };
    const f = labelScaler([b])!;
    expect(f("x", 100, 50, 6)).toBeCloseTo(1.4); // small: limited by free space
    expect(f("x", 101, 50, 10)).toBeCloseTo(1.1); // reaches the target
    expect(f("x", 100, 50, 12)).toBe(1); // already readable: untouched
    expect(f("x", 300, 50, 6)).toBe(1); // another label with the same text elsewhere
    expect(f("y", 100, 50, 6)).toBe(1);
    expect(labelScaler([], 2)).toBeUndefined();
    // device pixel ratio: the target is in CSS px
    expect(labelScaler([b], 2)!("x", 100, 50, 18)).toBeCloseTo(22 / 18);
  });

  it("writes the readability report", () => {
    const f = (v: number | undefined): string => (v === undefined ? "—" : v.toFixed(1));
    const md = [
      "# Label readability",
      "",
      "Generated by `apps/web/test/readability.test.ts`. Connector labels are 12 px in the diagram;",
      `the painter enlarges labels below ${LABEL_MIN_PX} px on screen into the free space around them (at most 1.5×).`,
      "",
      "| Case | Video | Overview px, as laid out | Overview px, min / median | Best stop px, as laid out | Stop px, min | Labels with free space |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map(
        (r) =>
          `| ${r.name} | ${r.size} | ${f(r.overviewBefore)} | ${f(r.overviewMin)} / ${f(r.overviewMedian)} | ${f(r.stopBefore)} | ${f(r.stopMin)} | ${r.enlarged} of ${r.labels} |`,
      ),
      "",
    ].join("\n");
    mkdirSync(new URL("../../../artifacts/qa/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../../../artifacts/qa/label-readability.md", import.meta.url), md);
    expect(rows.length).toBe(CASES.length * SIZES.length);
  });
});

/** Ending summaries: held at full opacity from the end of the engine's fade-in to the last frame. */
describe("ending summary hold", () => {
  const failedDoc = (): CanonicalDocument =>
    ({
      schema: "archflow/canonical@1",
      schemaMinor: 2,
      diagram: {
        id: "d",
        name: "failed",
        nodes: [
          { id: "a", label: "A", kind: "client", x: 0, y: 0, w: 120, h: 60 },
          { id: "b", label: "B", kind: "service", x: 300, y: 0, w: 120, h: 60 },
        ],
        edges: [{ id: "e1", from: "a", to: "b", direction: "forward", stroke: "solid" }],
        groups: [],
      },
      scenario: {
        id: "s",
        name: "failed",
        diagramId: "d",
        durationMs: 6000,
        flows: [{ id: "f1" }],
        events: [
          {
            type: "packet",
            id: "p1",
            t: 0,
            durationMs: 800,
            from: "a",
            to: "b",
            edgeId: "e1",
            variant: "request",
            flowId: "f1",
          },
          {
            type: "note",
            id: "n1",
            t: 2000,
            durationMs: 4000,
            text: "✗ Failed: A received no response",
            x: 0,
            y: -60,
            flowId: "f1",
          },
        ],
      },
    }) as unknown as CanonicalDocument;

  const cases: [string, () => Promise<CanonicalDocument>, RegExp][] = [
    [
      "success (AWS ALB)",
      async () => {
        const p = await prepare("text", fx("regression/aws-alb.txt"));
        if (!p.ok) throw new Error("prepare");
        return p.document;
      },
      /^✓ Success/,
    ],
    ["failure", async () => failedDoc(), /^✗ Failed/],
    [
      "recovered retry",
      async () => {
        const p = await prepare("text", "A -> B -> C\nfail: B -> C timeout retries 2\n");
        if (!p.ok) throw new Error("prepare");
        return p.document;
      },
      /recovered after 2 retries/,
    ],
    [
      "message-only",
      async () => {
        const p = await prepare("text", "Producer ..> Queue\nQueue ..> Worker\n");
        if (!p.ok) throw new Error("prepare");
        return p.document;
      },
      /^✓ Done/,
    ],
  ];

  it.each(cases)("%s: the summary is held through the final frame", async (_n, make, text) => {
    const doc = await make();
    const s = endingSummary(doc)!;
    expect(s, "an ending summary").toBeDefined();
    expect(s.text).toMatch(text);
    const end = doc.scenario!.durationMs;
    expect(s.t1).toBe(end);
    // engine fade-in untouched; held from then on, including the very last frame
    expect(heldNotesAt(s, s.t0)).toEqual([]);
    expect(heldNotesAt(s, s.t0 + NOTE_FADE * (s.t1 - s.t0) - 1)).toEqual([]);
    for (const t of [s.t0 + NOTE_FADE * (s.t1 - s.t0), s.t0 + 0.9 * (s.t1 - s.t0), end])
      expect(heldNotes(s, t)).toEqual([{ x: s.x, y: s.y }]);
  });

  it("ordinary notes keep the engine's fade (only the ending summary is held)", async () => {
    const p = await prepare("text", fx("regression/aws-alb.txt"));
    if (!p.ok) throw new Error("prepare");
    const s = endingSummary(p.document)!;
    const others = p.document.scenario!.events.filter((e) => e.type === "note" && e.id !== s.id);
    expect(others.length).toBeGreaterThanOrEqual(3);
    for (const n of others) {
      if (n.type !== "note") continue;
      for (const t of [n.t, n.t + n.durationMs * 0.95])
        expect(heldNotes(s, t).some((h) => h.x === n.x && h.y === n.y)).toBe(false);
    }
  });

  it("no summary without a trailing note", () => {
    const d = failedDoc();
    d.scenario!.events = d.scenario!.events.filter((e) => e.type !== "note");
    expect(endingSummary(d)).toBeUndefined();
    expect(heldNotesAt(undefined, 0)).toEqual([]);
  });
});
