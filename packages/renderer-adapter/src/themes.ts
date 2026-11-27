import { CONNECTOR_COLORS } from "./connector-style.ts";

/**
 * Visual themes, built on the engine's own design systems.
 *
 * The pinned engine (AnimatedDiagrams v2.2.0, `Model/Library.cpp` MakeDesignSystems) ships
 * built-in design systems with the ids used here. A document names one with its top-level
 * `designSystem`; the engine then resolves node, state and packet colours, edge style and font
 * from it when drawing. The scene colours (background, edges, text) are copied into the
 * document's `scene` exactly as the engine's own ApplyDesignSystem does, because the player
 * reads them from the scene.
 *
 * `default` adds nothing to the document: it is today's appearance, byte for byte.
 *
 * `palette` repeats the engine colours ArchFlow relies on (from `Model/Library.cpp` and
 * `Model/Catalog.cpp` at the pinned revision) so contrast can be checked in tests; a browser test
 * confirms the engine really draws with them. Two values deliberately differ from the engine's
 * built-in look, both for contrast (see `overrides`).
 */

export const THEME_IDS = ["default", "light", "dark", "blueprint", "high-contrast"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface ConnectorPalette {
  async: string;
  monitoring: string;
  monitoringLabel: string;
  response: string;
}

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  /** Engine design-system id; undefined for the default look. */
  designSystem?: string;
  /**
   * Document-local design system (engine `library.designSystems`), when a built-in one needs a
   * correction. Its id is ArchFlow's own, so it never shadows the engine's built-in.
   */
  library?: Record<string, unknown>;
  /** Written to the engine document's `scene` (undefined for the default look). */
  scene?: { background: string; edgeColor: string; textColor: string };
  /** Font family the engine uses for this theme ("" = the browser's default stack). */
  fontFamily: string;
  connectors: ConnectorPalette;
  /** Colours drawn by the engine with this theme (for contrast checks). */
  palette: {
    background: string;
    edge: string;
    text: string;
    edgeLabel: string;
    /** Node fill and ring per state. */
    states: Record<
      "ok" | "active" | "busy" | "warn" | "down" | "success",
      { fill: string; ring: string }
    >;
  };
  /** Where ArchFlow deliberately departs from the engine's built-in design system, and why. */
  overrides: string[];
}

const CATALOG_STATES = {
  ok: { fill: "#3b4a63", ring: "#5a6b86" },
  active: { fill: "#1d4ed8", ring: "#60a5fa" },
  busy: { fill: "#a16207", ring: "#f59e0b" },
  warn: { fill: "#b45309", ring: "#fb923c" },
  down: { fill: "#7f1d1d", ring: "#ef4444" },
  success: { fill: "#166534", ring: "#22c55e" },
};

const DARK_PALETTE = {
  background: "#0a111f",
  edge: "#5f7196",
  text: "#f2f6ff",
  edgeLabel: "#9fb3d6",
  states: CATALOG_STATES,
};

export const THEMES: Readonly<Record<ThemeId, ThemeSpec>> = {
  default: {
    id: "default",
    label: "Default",
    fontFamily: "",
    connectors: CONNECTOR_COLORS,
    palette: DARK_PALETTE,
    overrides: [],
  },
  dark: {
    id: "dark",
    label: "Dark",
    designSystem: "dark",
    scene: { background: "#0a111f", edgeColor: "#5f7196", textColor: "#f2f6ff" },
    fontFamily: "",
    connectors: CONNECTOR_COLORS,
    palette: DARK_PALETTE,
    overrides: [],
  },
  light: {
    id: "light",
    label: "Light",
    designSystem: "light",
    // engine edge colour #94a3b8 is 2.4:1 on the light canvas; #64748b reaches 4.5:1
    scene: { background: "#f6f8fc", edgeColor: "#64748b", textColor: "#0f172a" },
    fontFamily: "",
    connectors: {
      async: "#7c3aed",
      monitoring: "#0f766e",
      monitoringLabel: "#0f766e",
      response: "#475569",
    },
    palette: {
      background: "#f6f8fc",
      edge: "#64748b",
      text: "#0f172a",
      edgeLabel: "#475569",
      states: {
        ok: { fill: "#ffffff", ring: "#cbd5e1" },
        active: { fill: "#dbeafe", ring: "#3b82f6" },
        busy: { fill: "#fef3c7", ring: "#f59e0b" },
        warn: { fill: "#ffedd5", ring: "#f97316" },
        down: { fill: "#fee2e2", ring: "#ef4444" },
        success: { fill: "#dcfce7", ring: "#22c55e" },
      },
    },
    overrides: ["scene edge colour #64748b instead of #94a3b8 (contrast 2.4:1 -> 4.5:1)"],
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    designSystem: "archflow-blueprint",
    // the engine's built-in "blueprint" (Model/Library.cpp), with a clearly red "down" state:
    // the built-in warn (#6b3a12/#fdba74) and down (#6b1d1d/#fca5a5) are hard to tell apart
    library: {
      id: "archflow-blueprint",
      label: "Blueprint (ArchFlow)",
      background: "#0b3a6e",
      edgeColor: "#cfe8ff",
      textColor: "#ffffff",
      grid: true,
      gridSize: 20,
      fontFamily: "DejaVu Sans Mono",
      subtitleColor: "#a9d1ff",
      colors: {
        surface: "#0f4c8a",
        "surface-alt": "#0b3a6e",
        border: "#e6f3ff",
        text: "#ffffff",
        muted: "#a9d1ff",
        primary: "#7cc4ff",
        secondary: "#c4b5fd",
        success: "#86efac",
        warning: "#fde68a",
        danger: "#fca5a5",
        info: "#7dd3fc",
        accent: "#ffffff",
      },
      states: {
        ok: { fill: "#0f4c8a", ring: "#e6f3ff" },
        active: { fill: "#1d6fbf", ring: "#ffffff" },
        busy: { fill: "#5b4a12", ring: "#fde68a" },
        warn: { fill: "#6b3a12", ring: "#fdba74" },
        down: { fill: "#8b1111", ring: "#ff6b6b" },
        success: { fill: "#14532d", ring: "#86efac" },
        disabled: { fill: "#0b3a6e", ring: "#7aa7d6" },
      },
      node: { cornerRadius: 2, strokeWidth: 1.5, shadow: false },
      edge: { width: 1.5, routing: "orthogonal", arrowEnd: "open", labelColor: "#cfe8ff" },
    },
    scene: { background: "#0b3a6e", edgeColor: "#cfe8ff", textColor: "#ffffff" },
    fontFamily: "DejaVu Sans Mono",
    connectors: {
      async: "#c4b5fd",
      monitoring: "#6ee7b7",
      monitoringLabel: "#a7f3d0",
      response: "#a9d1ff",
    },
    palette: {
      background: "#0b3a6e",
      edge: "#cfe8ff",
      text: "#ffffff",
      edgeLabel: "#cfe8ff",
      states: {
        ok: { fill: "#0f4c8a", ring: "#e6f3ff" },
        active: { fill: "#1d6fbf", ring: "#ffffff" },
        busy: { fill: "#5b4a12", ring: "#fde68a" },
        warn: { fill: "#6b3a12", ring: "#fdba74" },
        down: { fill: "#8b1111", ring: "#ff6b6b" },
        success: { fill: "#14532d", ring: "#86efac" },
      },
    },
    overrides: [
      "document-local copy of the built-in blueprint with down = #8b1111/#ff6b6b (built-in down and warn look alike)",
    ],
  },
  "high-contrast": {
    id: "high-contrast",
    label: "High contrast",
    designSystem: "high-contrast",
    scene: { background: "#000000", edgeColor: "#ffffff", textColor: "#ffffff" },
    fontFamily: "",
    connectors: {
      async: "#d08cff",
      monitoring: "#00ffff",
      monitoringLabel: "#00ffff",
      response: "#e5e5e5",
    },
    palette: {
      background: "#000000",
      edge: "#ffffff",
      text: "#ffffff",
      edgeLabel: "#ffffff",
      states: {
        ok: { fill: "#000000", ring: "#ffffff" },
        active: { fill: "#003a8c", ring: "#4da3ff" },
        busy: { fill: "#5c4400", ring: "#ffd400" },
        warn: { fill: "#663300", ring: "#ff9900" },
        down: { fill: "#7a0000", ring: "#ff3b3b" },
        success: { fill: "#004d1a", ring: "#33ff77" },
      },
    },
    overrides: [],
  },
};

export const isThemeId = (v: unknown): v is ThemeId =>
  typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);

/** WCAG 2 relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG 2 contrast ratio between two #rrggbb colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
