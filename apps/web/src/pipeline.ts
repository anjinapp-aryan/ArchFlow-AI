import { parseCanonical, type CanonicalDocument } from "@archflow/canonical-model";
import {
  importDrawio,
  importMermaid,
  importPlantUml,
  type ImportIssue,
} from "@archflow/diagram-importers";
import {
  serializeEngineDocument,
  toEngineDocument,
  type ThemeId,
  type TitleMeasurer,
} from "@archflow/renderer-adapter";
import {
  parseDescription,
  synthesizeScenario,
  type FailureSpec,
  type SynthesisOptions,
} from "@archflow/scenario-synthesizer";

/**
 * Pure application pipeline (no DOM): source text -> canonical document -> scenario -> engine
 * document JSON. Everything the UI shows comes from here, so it is tested in Node.
 */

export type SourceKind = "text" | "mermaid" | "drawio" | "plantuml" | "json";

export interface Issue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  source?: string;
}

export interface UserScenarioOptions {
  /** Generate a scenario even when the source already contains one (sequence diagrams, JSON). */
  regenerate?: boolean;
  entry?: string;
  failure?: FailureSpec;
}

export interface Prepared {
  ok: true;
  /** Diagram as imported (no generated scenario). */
  diagram: CanonicalDocument;
  /** Diagram + the scenario actually played. */
  document: CanonicalDocument;
  scenarioOrigin: "source" | "generated";
  engineJson: string;
  issues: Issue[];
  /** Options derived from the source (text directives), shown as defaults in the UI. */
  sourceOptions: SynthesisOptions;
}
export type PrepareResult = Prepared | { ok: false; issues: Issue[] };

const warn = (i: ImportIssue | { code: string; message: string }): Issue => ({
  level: i.code.startsWith("info.") ? "info" : "warning",
  code: i.code,
  message: i.message,
  ...("source" in i && i.source !== undefined ? { source: i.source } : {}),
});
const err = (i: { code: string; message: string; source?: string; path?: string }): Issue => ({
  level: "error",
  code: i.code,
  message: i.message,
  ...(i.source !== undefined
    ? { source: i.source }
    : i.path !== undefined
      ? { source: i.path }
      : {}),
});

/** Guess the kind of pasted/opened content. */
export function detectKind(text: string, fileName?: string): SourceKind {
  const ext = fileName?.toLowerCase().split(".").pop();
  if (ext === "json") return "json";
  if (ext === "drawio" || ext === "xml" || ext === "dio" || ext === "svg") return "drawio";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (ext === "puml" || ext === "plantuml" || ext === "pu" || ext === "iuml") return "plantuml";
  const t = text.trimStart();
  if (t.startsWith("{")) return "json";
  if (/^@startuml/i.test(t)) return "plantuml";
  if (t.startsWith("<")) return "drawio";
  if (/^(---|%%|flowchart\b|graph\b|sequenceDiagram\b)/.test(t)) return "mermaid";
  return "text";
}

export async function prepare(
  kind: SourceKind,
  text: string,
  user: UserScenarioOptions = {},
  /** Real title widths from the browser canvas; titles then fit the fonts this machine has. */
  measureTitle?: TitleMeasurer,
  /** Presentation: theme (engine design system) and dimming; the default look when omitted. */
  style: RenderStyle = {},
): Promise<PrepareResult> {
  const issues: Issue[] = [];
  let diagram: CanonicalDocument;
  let sourceOptions: SynthesisOptions = {};

  if (kind === "json") {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return {
        ok: false,
        issues: [{ level: "error", code: "json.malformed", message: (e as Error).message }],
      };
    }
    const v = parseCanonical(raw);
    if (!v.ok) return { ok: false, issues: v.errors.map(err) };
    diagram = v.value;
    issues.push(...v.warnings.map(warn));
  } else if (kind === "text") {
    const d = parseDescription(text);
    issues.push(...d.warnings.map(warn));
    if (!d.ok || !d.document) return { ok: false, issues: [...d.errors.map(err), ...issues] };
    diagram = d.document;
    sourceOptions = d.options;
  } else {
    const r =
      kind === "drawio"
        ? await importDrawio(text)
        : kind === "plantuml"
          ? importPlantUml(text)
          : importMermaid(text);
    issues.push(...r.warnings.map(warn));
    if (!r.ok) return { ok: false, issues: [...r.errors.map(err), ...issues] };
    diagram = r.document;
  }

  let document = diagram;
  let scenarioOrigin: Prepared["scenarioOrigin"] = "source";
  const hasScenario = (diagram.scenario?.events.length ?? 0) > 0;
  if (!hasScenario || user.regenerate) {
    const base: CanonicalDocument = { ...diagram };
    delete base.scenario;
    const options: SynthesisOptions = {
      ...sourceOptions,
      ...(user.entry ? { entry: user.entry } : {}),
      ...(user.failure ? { failures: [user.failure] } : {}),
    };
    const s = synthesizeScenario(base, options);
    if (!s.ok) return { ok: false, issues: [...issues, ...s.errors.map(err)] };
    issues.push(...s.warnings.map(warn));
    document = s.document;
    scenarioOrigin = "generated";
  }

  const a = toEngineDocument(document, {
    groups: "flatten",
    ...(measureTitle ? { measureTitle } : {}),
    ...styleOptions(style),
  });
  if (!a.ok) return { ok: false, issues: [...issues, ...a.errors.map(err)] };
  issues.push(...a.warnings.filter((w) => w.code !== "info.flow_ids_not_rendered").map(warn));
  return {
    ok: true,
    diagram,
    document,
    scenarioOrigin,
    engineJson: serializeEngineDocument(a.document),
    issues,
    sourceOptions,
  };
}

/** Times (ms) at which something starts: used by "previous/next event" stepping. */
export function eventTimes(doc: CanonicalDocument): number[] {
  const ts = new Set<number>([0]);
  for (const e of doc.scenario?.events ?? []) ts.add(e.t);
  return [...ts].sort((a, b) => a - b);
}

/** Connector choices for the failure picker: "caller -> callee" pairs traffic could use. */
export function callPairs(doc: CanonicalDocument): { from: string; to: string; label: string }[] {
  const name = new Map(doc.diagram.nodes.map((n) => [n.id, n.label]));
  const out: { from: string; to: string; label: string }[] = [];
  const seen = new Set<string>();
  const push = (a: string, b: string): void => {
    const k = `${a}>${b}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ from: a, to: b, label: `${name.get(a)} → ${name.get(b)}` });
  };
  for (const e of doc.diagram.edges) {
    if (e.direction === "forward" || e.direction === "both" || e.direction === "none")
      push(e.from, e.to);
    if (e.direction === "backward" || e.direction === "both" || e.direction === "none")
      push(e.to, e.from);
  }
  return out;
}

/** How the animation is drawn (never what it shows). */
export interface RenderStyle {
  theme?: ThemeId;
  dimInactive?: boolean;
}
const styleOptions = (s: RenderStyle): { theme?: ThemeId; dimInactive?: boolean } => ({
  ...(s.theme ? { theme: s.theme } : {}),
  ...(s.dimInactive ? { dimInactive: true } : {}),
});

/** Engine document for an already prepared canonical document in another style. */
export function restyled(
  document: CanonicalDocument,
  style: RenderStyle,
  measureTitle?: TitleMeasurer,
): { ok: true; engineJson: string } | { ok: false; issues: Issue[] } {
  const a = toEngineDocument(document, {
    groups: "flatten",
    ...styleOptions(style),
    ...(measureTitle ? { measureTitle } : {}),
  });
  if (!a.ok) return { ok: false, issues: a.errors.map(err) };
  return { ok: true, engineJson: serializeEngineDocument(a.document) };
}
