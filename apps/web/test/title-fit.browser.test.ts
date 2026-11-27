import { readFileSync } from "node:fs";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { titleRoom } from "@archflow/canonical-model";
import { launch } from "@archflow/qa";
import { prepare, type SourceKind } from "../src/pipeline.ts";

/**
 * Regression for "label text overflows its box": every node title of every example, measured
 * with the browser's real bold 15 px font (as the engine draws it), must fit the room the engine
 * leaves inside that node's shape.
 */
const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");
const SAMPLES: [string, SourceKind, string][] = [
  ["bench text", "text", fx("benchmark/order-flow.txt")],
  ["bench sentences", "text", fx("benchmark/order-flow.sentences.txt")],
  ["bench mermaid", "mermaid", fx("benchmark/order-flow.mmd")],
  ["sequence", "mermaid", fx("diagrams/15-sequence-rich.mmd")],
  ["mermaid syntax", "mermaid", fx("diagrams/14-mermaid-syntax.mmd")],
  ["drawio order", "drawio", fx("diagrams/10-order-flow.drawio")],
  ["drawio real", "drawio", fx("diagrams/13-drawio-realworld.drawio")],
  ["puml component", "plantuml", fx("diagrams/16-plantuml-component.puml")],
  ["puml sequence", "plantuml", fx("diagrams/17-plantuml-sequence.puml")],
  ["canonical", "json", fx("scenarios/order-flow.canonical.json")],
];

interface EngineJson {
  nodes: { label: string; kind: string; w: number; style?: { fontSize: number } }[];
}

/** Same font stack and bold weight as the painter (painter.ts, ported from upstream player.js). */
const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';

/** Width of each label drawn bold at 100 px, the painter's reference size (REF_PX). */
async function measureAt100(page: Page, labels: string[]): Promise<Map<string, number>> {
  const widths = await page.evaluate(
    (items: string[], font: string) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `bold 100px ${font}`;
      return items.map((l) => ctx.measureText(l).width);
    },
    labels,
    FONT_STACK,
  );
  return new Map(labels.map((l, i) => [l, widths[i]!]));
}

let browser: Browser;
beforeAll(async () => {
  browser = (await launch()).browser;
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe("node titles fit their boxes (real browser fonts)", () => {
  it.each(SAMPLES)(
    "%s",
    async (_n, kind, text) => {
      // 1) find the labels, 2) measure them in the browser at the reference size, 3) prepare again
      //    with that measurer, exactly as the app does (Player.measureTitle), 4) check real widths.
      const first = await prepare(kind, text);
      if (!first.ok) throw new Error(JSON.stringify(first.issues));
      const labels = [
        ...new Set((JSON.parse(first.engineJson) as EngineJson).nodes.map((n) => n.label)),
      ];
      const page = await browser.newPage();
      const ref = await measureAt100(page, labels);
      const measureTitle = (label: string, px: number): number => (ref.get(label)! * px) / 100;

      const r = await prepare(kind, text, {}, measureTitle);
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      const nodes = (JSON.parse(r.engineJson) as EngineJson).nodes;
      const widths = await page.evaluate(
        (items: { label: string; px: number; font: string }[]) => {
          const ctx = document.createElement("canvas").getContext("2d")!;
          return items.map((i) => {
            ctx.font = `bold ${i.px}px ${i.font}`;
            return ctx.measureText(i.label).width;
          });
        },
        nodes.map((n) => ({ label: n.label, px: n.style?.fontSize ?? 15, font: FONT_STACK })),
      );
      await page.close();
      const overflow = nodes
        .map((n, i) => ({
          label: n.label,
          real: Math.round(widths[i]!),
          room: Math.round(titleRoom(n.kind, n.w)),
          px: n.style?.fontSize ?? 15,
        }))
        .filter((x) => x.real > x.room && x.px > 9);
      expect(overflow).toEqual([]);
    },
    60_000,
  );
});
