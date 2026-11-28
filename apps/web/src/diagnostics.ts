import type { Issue } from "./pipeline.ts";

/**
 * Human-readable diagnostics. The pipeline reports issues with a stable machine code
 * (`text.monitoring_inferred`) and a technical message; the workspace shows a plain-language
 * title and explanation first and keeps the code and the original message as expandable details.
 * Pure: no DOM, tested in Node.
 */
export interface Diagnostic {
  level: Issue["level"];
  /** Severity word shown next to the icon (status is never conveyed by colour alone). */
  severity: "Error" | "Warning" | "Information";
  title: string;
  /** Plain-language explanation. */
  body: string;
  /** Technical details: machine code, location and the original message. */
  code: string;
  source?: string;
  technical: string;
}

/** Items of a "...: a; b; c" list in a message (health-check lists, unreached components). */
const listAfterColon = (m: string): string[] => {
  const i = m.indexOf(": ");
  if (i < 0) return [];
  return m
    .slice(i + 2)
    .replace(/\. Write "monitor:.*$/, "")
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "…");
};
const quoted = (m: string): string[] => [...m.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
const count = (n: number, one: string, many = `${one}s`): string =>
  `${n === 1 ? "One" : n === 2 ? "Two" : n === 3 ? "Three" : String(n)} ${n === 1 ? one : many}`;
const sentence = (s: string): string => {
  const t = s.trim();
  if (!t) return t;
  const c = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(c) ? c : `${c}.`;
};

type Explain = (message: string) => { title: string; body?: string };

/** Specific explanations for the messages users see most. */
const SPECIFIC: Record<string, Explain> = {
  "text.monitoring_inferred": (m) => {
    const items = listAfterColon(m);
    const more = /…/.test(m);
    return {
      title: "Health monitoring detected",
      body: `${more ? "Several" : count(items.length || 1, "monitoring connection")} ${items.length === 1 && !more ? "was" : "were"} identified and separated from normal request routing${items.length ? `: ${items.join("; ")}` : ""}. Write “monitor: A -> B” to state this explicitly.`,
    };
  },
  "mermaid.monitoring_inferred": (m) => {
    const items = listAfterColon(m);
    return {
      title: "Health monitoring detected",
      body: `${count(items.length || 1, "monitoring connection")} ${items.length === 1 ? "was" : "were"} identified and separated from normal request routing${items.length ? `: ${items.join("; ")}` : ""}.`,
    };
  },
  "info.monitoring_labels_merged": (m) => {
    const n = Number(/^(\d+)/.exec(m)?.[1] ?? "0");
    return {
      title: "Health-check labels combined",
      body: `${n ? count(n, "identical health-check label") : "Identical health-check labels"} ${n === 1 ? "was" : "were"} combined for better readability.`,
    };
  },
  "info.routes_not_taken": (m) => {
    const names = quoted(m);
    return {
      title: "Request routed to one target",
      body: `The request follows the matching rule only, so ${names.length ? names.join(", ") : "some components"} ${names.length === 1 ? "receives" : "receive"} no traffic in this animation. Change the “request:” line to follow another route.`,
    };
  },
  "info.groups_flattened": (m) => ({
    title: "Groups drawn as plain components",
    body: `${sentence(m.replace(/: the engine has no containers; their components are rendered/, ""))} Their components are animated normally; the group boxes are not drawn.`,
  }),
  "info.flow_ids_not_rendered": () => ({
    title: "Flow names kept in the data",
    body: "Flow identifiers are kept in the downloaded JSON but are not drawn in the animation.",
  }),
  "synth.unreached": (m) => ({
    title: "Component receives no traffic",
    body: `${quoted(m)[0] ? `“${quoted(m)[0]}”` : "A component"} is not reachable from the starting component, so it stays idle. Pick another start in the Scenario tab or add a connection.`,
  }),
  "synth.route_default": (m) => ({
    title: "Default route used",
    body: `${sentence(m.replace(/^no request given \(request: GET \/path\): /, ""))} Add a line such as “request: GET /api/orders” to choose the request.`,
  }),
  "synth.no_rule_matched": (m) => ({
    title: "No routing rule matches the request",
    body: `${sentence(m)} The animation stops at the router.`,
  }),
  "synth.no_traffic": (m) => ({
    title: "Nothing to animate from the start component",
    body: `${sentence(m)} Choose another start in the Scenario tab.`,
  }),
  "synth.failure_not_reached": () => ({
    title: "Failure not shown",
    body: "The injected failure is on a call that this request never makes. Choose a connection on the animated path.",
  }),
  "synth.truncated": (m) => ({ title: "Animation shortened", body: sentence(m) }),
  "synth.probe_retries_ignored": (m) => ({
    title: "Retries ignored on a health check",
    body: sentence(m),
  }),
  "synth.empty": () => ({
    title: "No components found",
    body: "The diagram has no components to animate.",
  }),
  "synth.too_long": () => ({
    title: "Animation too long",
    body: "The animation would last more than 10 minutes. Remove some connections or start somewhere else.",
  }),
  "text.unrecognised": (m) => ({
    title: "Line not understood",
    body: `${sentence(m.replace(/^could not read/, "This line could not be read"))} Use “A -> B : label”, one link per line.`,
  }),
  "text.empty": () => ({
    title: "Nothing to animate yet",
    body: "Describe your architecture, e.g. “User -> API -> Database”.",
  }),
  "text.no_components": () => ({
    title: "No components found",
    body: "Write links such as “User -> API -> Database”.",
  }),
  "json.malformed": (m) => ({ title: "The JSON cannot be read", body: sentence(m) }),
  "file.too_large": (m) => ({ title: "File too large", body: sentence(m) }),
  "engine.load": (m) => ({
    title: "The animation engine rejected the document",
    body: sentence(m),
  }),
  "app.engine": (m) => ({ title: "The animation engine could not start", body: sentence(m) }),
  "drawio.from_svg": () => ({
    title: "Diagram read from SVG",
    body: "The draw.io diagram embedded in this SVG file was imported.",
  }),
};

/** Fallback titles by code family. */
const FAMILY: [RegExp, string][] = [
  [/^mermaid\.unsupported_diagram/, "Unsupported Mermaid diagram type"],
  [/^mermaid\./, "Mermaid import"],
  [/^plantuml\./, "PlantUML import"],
  [/^drawio\./, "draw.io import"],
  [/^text\./, "Description"],
  [/^synth\./, "Scenario"],
  [/^(unsupported|adapter)\./, "Not supported by the animation engine"],
  [/^version\./, "Document version"],
  [/^import\./, "Import"],
  [/^geometry\./, "Layout"],
  [/^(ref|group|edge)\./, "Diagram reference"],
  [/^(packet|flow|event|response|retry|timeout|fallback|recover|state)\./, "Scenario validation"],
  [/^info\./, "Note"],
];

export function describeIssue(i: Issue): Diagnostic {
  const severity =
    i.level === "error" ? "Error" : i.level === "warning" ? "Warning" : "Information";
  const specific = SPECIFIC[i.code]?.(i.message);
  const title =
    specific?.title ??
    FAMILY.find(([re]) => re.test(i.code))?.[1] ??
    (i.level === "error" ? "Problem" : "Note");
  return {
    level: i.level,
    severity,
    title,
    body: specific?.body ?? sentence(i.message),
    code: i.code,
    ...(i.source !== undefined ? { source: i.source } : {}),
    technical: `${i.code}${i.source ? ` · ${i.source}` : ""} — ${i.message}`,
  };
}

export interface DiagnosticsSummary {
  status: "error" | "warning" | "ok";
  errors: number;
  warnings: number;
  infos: number;
  /** Short status line, e.g. "Valid · 1 warning · 2 notes". */
  text: string;
}

export function summarizeIssues(issues: readonly Issue[]): DiagnosticsSummary {
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const infos = issues.length - errors - warnings;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (infos) parts.push(`${infos} note${infos === 1 ? "" : "s"}`);
  const status = errors ? "error" : warnings ? "warning" : "ok";
  const head = errors ? "Cannot animate" : "Valid";
  return {
    status,
    errors,
    warnings,
    infos,
    text: parts.length ? `${head} · ${parts.join(" · ")}` : "Valid · no messages",
  };
}
