import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  titleRoom,
  titleWidth,
  type CanonicalDocument,
  type Rect,
} from "@archflow/canonical-model";
import { MIN_TITLE_PX, cameraBoundsAt, planCamera, type Bounds } from "@archflow/renderer-adapter";
import { prepare, type SourceKind } from "../src/pipeline.ts";
import { contentBounds } from "./camera-check.ts";
import { routingReport } from "./routing-report.ts";

/**
 * Visual QA report: what can be detected reliably from geometry alone.
 *
 * - overlapping labels (connector labels on nodes or on each other), for diagrams with labels
 *   anchored by ArchFlow (generated geometry);
 * - titles that cannot fit their box even at the smallest title size;
 * - on-screen text size of the 12 px connector labels in a 1280x720 video, on the overview and
 *   at the camera's stops (unreadable below 8 px);
 * - components cut by the frame edge at camera stops (informational: they are not active).
 *
 * It does not judge colour harmony, visual balance, or overlaps involving text drawn by the
 * engine at positions ArchFlow does not control (state badges, notes). Contrast is checked in
 * the theme tests. The report is written to artifacts/qa/visual-report.md.
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
  ["15-sequence-rich", "mermaid", fx("diagrams/15-sequence-rich.mmd")],
  ["16-plantuml-component", "plantuml", fx("diagrams/16-plantuml-component.puml")],
  ["06-nested-groups", "mermaid", fx("diagrams/06-nested-groups.mmd")],
];

const VIDEO = { w: 1280, h: 720 };
const LABEL_PX = 12;
const UNREADABLE_PX = 8;

/** Scale of world px to video px for a world rectangle fitted into the video frame. */
const scale = (b: Bounds): number => Math.min(VIDEO.w / b[2], VIDEO.h / b[3]);
const cutBy = (b: Bounds, n: Rect): boolean => {
  const inside = n.x >= b[0] && n.y >= b[1] && n.x + n.w <= b[0] + b[2] && n.y + n.h <= b[1] + b[3];
  const outside =
    n.x + n.w <= b[0] || n.y + n.h <= b[1] || n.x >= b[0] + b[2] || n.y >= b[1] + b[3];
  return !inside && !outside;
};

interface Row {
  name: string;
  components: number;
  overlappingLabels: string[];
  titlesTooLong: string[];
  overviewLabelPx: number;
  cameraLabelPx: number | undefined;
  cutAtStops: number;
  cameraReason: string;
}

function report(name: string, doc: CanonicalDocument): Row {
  const r = routingReport(doc);
  const content = contentBounds(doc);
  const plan = planCamera(doc, content, VIDEO.w / VIDEO.h, doc.scenario!.durationMs);
  const stops = plan.segments.filter((s) => s.kind === "hold" && !s.overview);
  const stopBounds = stops.map((s) => cameraBoundsAt(plan, (s.t0 + s.t1) / 2));
  return {
    name,
    components: doc.diagram.nodes.length,
    overlappingLabels: [...r.labelOnNode, ...r.labelOnLabel],
    titlesTooLong: doc.diagram.nodes
      .filter((n) => titleWidth(n.label, MIN_TITLE_PX) > titleRoom(n.kind, n.w))
      .map((n) => n.id),
    overviewLabelPx: LABEL_PX * scale(content),
    cameraLabelPx: stopBounds.length
      ? Math.max(...stopBounds.map((b) => LABEL_PX * scale(b)))
      : undefined,
    cutAtStops: new Set(
      stopBounds.flatMap((b) => doc.diagram.nodes.filter((n) => cutBy(b, n)).map((n) => n.id)),
    ).size,
    cameraReason: plan.reason,
  };
}

describe("visual QA report", () => {
  it("measures every case, enforces the reliable rules and writes the report", async () => {
    const rows: Row[] = [];
    for (const [name, kind, text] of CASES) {
      const p = await prepare(kind, text);
      if (!p.ok) throw new Error(`${name}: ${JSON.stringify(p.issues)}`);
      rows.push(report(name, p.document));
    }
    // rules that hold for every case
    for (const row of rows) {
      expect(row.overlappingLabels, row.name).toEqual([]);
      expect(row.titlesTooLong, row.name).toEqual([]);
      // the camera never makes text smaller than the overview
      if (row.cameraLabelPx !== undefined)
        expect(row.cameraLabelPx, row.name).toBeGreaterThanOrEqual(row.overviewLabelPx);
    }
    // the camera lifts the large platform's labels from unreadable to readable at its stops
    const big = rows.find((r) => r.name === "large-platform")!;
    expect(big.overviewLabelPx).toBeLessThan(UNREADABLE_PX);
    expect(big.cameraLabelPx!).toBeGreaterThanOrEqual(UNREADABLE_PX);

    const fmt = (v: number | undefined): string => (v === undefined ? "—" : v.toFixed(1));
    const md = [
      "# Visual QA report",
      "",
      "Generated by `apps/web/test/visual-qa.test.ts`. Text sizes are for a 1280×720 video;",
      `connector labels are ${LABEL_PX} px in the diagram and hard to read below ${UNREADABLE_PX} px on screen.`,
      "",
      "| Case | Components | Overlapping labels | Titles too long | Label px, overview | Label px, best camera stop | Cut at stops | Camera |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map(
        (r) =>
          `| ${r.name} | ${r.components} | ${r.overlappingLabels.length} | ${r.titlesTooLong.length} | ${fmt(r.overviewLabelPx)}${r.overviewLabelPx < UNREADABLE_PX ? " (unreadable)" : ""} | ${fmt(r.cameraLabelPx)} | ${r.cutAtStops} | ${r.cameraReason} |`,
      ),
      "",
      "Not detected automatically: colour harmony, visual balance, and overlaps involving text the",
      "engine places itself (state badges, notes, packet labels in flight).",
      "",
    ].join("\n");
    const dir = new URL("../../../artifacts/qa/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL("visual-report.md", dir), md);
  });
});
