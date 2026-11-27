import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  THEMES,
  THEME_IDS,
  contrastRatio,
  isThemeId,
  serializeEngineDocument,
  toEngineDocument,
  type ThemeId,
} from "../src/index.ts";

const dir = new URL("../../../fixtures/scenarios/", import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".canonical.json"));
const load = (f: string): unknown => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const adapt = (doc: unknown, theme?: ThemeId): string => {
  const r = toEngineDocument(doc, theme ? { theme } : {});
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return serializeEngineDocument(r.document);
};

describe("themes", () => {
  it.each(fixtures)("%s: the default theme leaves the engine document byte-identical", (f) => {
    expect(adapt(load(f), "default")).toBe(adapt(load(f)));
  });

  it.each(THEME_IDS.filter((t) => t !== "default"))(
    "%s: names the engine design system and its scene colours",
    (id) => {
      const doc = JSON.parse(adapt(load("aws-alb.canonical.json"), id));
      const t = THEMES[id];
      expect(doc.designSystem).toBe(t.designSystem);
      expect(doc.scene).toEqual(t.scene);
      // connector semantics use the theme's palette
      const edges = doc.edges as { style: { color?: string; labelColor?: string } }[];
      expect(edges.some((e) => e.style.color === t.connectors.monitoring)).toBe(true);
      expect(edges.some((e) => e.style.labelColor === t.connectors.monitoringLabel)).toBe(true);
      const probes = (doc.scenario.steps as { packet?: string; color?: string }[]).filter(
        (s) => s.packet === "dot",
      );
      expect(probes.length).toBeGreaterThan(0);
      for (const p of probes) expect(p.color).toBe(t.connectors.monitoring);
      // geometry is untouched by a theme
      const plain = JSON.parse(adapt(load("aws-alb.canonical.json")));
      expect(
        doc.nodes.map((n: { x: number; y: number; w: number; h: number }) => [n.x, n.y, n.w, n.h]),
      ).toEqual(
        plain.nodes.map((n: { x: number; y: number; w: number; h: number }) => [
          n.x,
          n.y,
          n.w,
          n.h,
        ]),
      );
      expect(doc.edges.map((e: { waypoints?: unknown }) => e.waypoints)).toEqual(
        plain.edges.map((e: { waypoints?: unknown }) => e.waypoints),
      );
    },
  );

  it("a theme's background replaces the diagram's own background", () => {
    const doc = load("linear-3.canonical.json") as { diagram: { background?: string } };
    doc.diagram.background = "#123456";
    expect(JSON.parse(adapt(doc)).scene).toEqual({ background: "#123456" });
    expect(JSON.parse(adapt(doc, "light")).scene.background).toBe("#f6f8fc");
  });

  it("recognises theme ids", () => {
    expect(isThemeId("blueprint")).toBe(true);
    expect(isThemeId("sketch")).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });
});

describe("theme contrast (WCAG 2 ratios on the colours the engine draws)", () => {
  const STATES = ["ok", "active", "busy", "warn", "down", "success"] as const;
  it.each(THEME_IDS)("%s", (id) => {
    const p = THEMES[id].palette;
    const c = THEMES[id].connectors;
    const report: string[] = [];
    const need = (what: string, a: string, b: string, min: number): void => {
      const r = contrastRatio(a, b);
      if (r < min) report.push(`${what}: ${r.toFixed(2)} < ${min}`);
    };
    need("text on background", p.text, p.background, 4.5);
    need("connector label on background", p.edgeLabel, p.background, 4.5);
    need("connector on background", p.edge, p.background, 3);
    for (const s of STATES) need(`title on ${s} node`, p.text, p.states[s].fill, 4.5);
    need("async connector", c.async, p.background, 3);
    need("monitoring connector", c.monitoring, p.background, 3);
    need("monitoring label", c.monitoringLabel, p.background, 4.5);
    need("response connector", c.response, p.background, 3);
    // states must be told apart: fills differ from each other
    const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const dist = (a: string, b: string): number =>
      Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    const key = ["ok", "active", "warn", "down", "success"] as const;
    for (let i = 0; i < key.length; i++)
      for (let j = i + 1; j < key.length; j++) {
        const a = p.states[key[i]!];
        const b = p.states[key[j]!];
        if (dist(a.fill, b.fill) < 40 && dist(a.ring, b.ring) < 60)
          report.push(`${key[i]} and ${key[j]} look alike`);
      }
    expect(report).toEqual([]);
  });

  it("the ratio function matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
