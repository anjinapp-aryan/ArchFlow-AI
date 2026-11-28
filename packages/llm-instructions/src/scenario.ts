/**
 * The structured scenario the LLM must return, its strict validation, and its rendering as the
 * editable multi-line instructions read by ArchFlow's own "Describe" parser
 * (`parseDescription` in @archflow/scenario-synthesizer). The LLM reply is untrusted data: only
 * values that pass these checks reach the instructions, and the instructions still go through
 * the normal parser, canonical validator and renderer when the user generates the diagram.
 */

export interface InstructionStep {
  from: string;
  to: string;
  /** May be empty. */
  label: string;
}

export interface InstructionScenario {
  title: string;
  /** What the first component sends, e.g. "GET /api/products/101"; empty when not applicable. */
  request: string;
  steps: InstructionStep[];
}

export const SCENARIO_LIMITS = {
  maxSteps: 40,
  maxComponents: 20,
  maxName: 60,
  maxLabel: 120,
  maxTitle: 120,
  maxRequest: 120,
} as const;

export type ScenarioResult =
  { ok: true; scenario: InstructionScenario } | { ok: false; problems: string[] };

// Characters with a meaning in the description grammar (arrows, fan-out, labels, statements).
const NAME_FORBIDDEN = /[:,<>=~→←↔⇢—;|"`\\{}[\]]|--|\.\.|\.-/;
const LABEL_FORBIDDEN = /[→←↔⇢`]/;
const CONTROL = /\p{Cc}/u;

/** Collapse spaces and drop sentence-ending punctuation (the parser splits sentences on it). */
function tidy(s: string): string {
  return s
    .replace(/ +/g, " ")
    .replace(/[.!?]+(?= |$)/g, "")
    .trim();
}

function field(
  value: unknown,
  path: string,
  max: number,
  problems: string[],
  required: boolean,
): string {
  if (value === undefined || value === null || value === "") {
    if (required) problems.push(`${path} is missing`);
    return "";
  }
  if (typeof value !== "string") {
    problems.push(`${path} must be a string`);
    return "";
  }
  if (CONTROL.test(value)) {
    problems.push(`${path} contains line breaks or control characters`);
    return "";
  }
  const t = tidy(value);
  if (required && !t) problems.push(`${path} is empty`);
  if (t.length > max) problems.push(`${path} is longer than ${max} characters`);
  return t;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function closed(obj: Record<string, unknown>, allowed: string[], path: string, problems: string[]) {
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) problems.push(`${path} has an unexpected field "${k}"`);
}

/** Closed, strict check of the reply shape; nothing is repaired by guessing. */
export function validateScenario(raw: unknown): ScenarioResult {
  const problems: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ["the reply is not a JSON object"] };
  closed(raw, ["title", "request", "steps"], "reply", problems);
  const title = field(raw["title"], "title", SCENARIO_LIMITS.maxTitle, problems, true);
  const request = field(raw["request"], "request", SCENARIO_LIMITS.maxRequest, problems, false);
  if (/^(title|request|entry|fail|monitor)$/i.test(title)) problems.push("title is a keyword");

  const stepsRaw = raw["steps"];
  const steps: InstructionStep[] = [];
  if (!Array.isArray(stepsRaw)) problems.push("steps must be an array");
  else if (!stepsRaw.length) problems.push("steps is empty");
  else if (stepsRaw.length > SCENARIO_LIMITS.maxSteps)
    problems.push(`more than ${SCENARIO_LIMITS.maxSteps} steps`);
  else
    stepsRaw.forEach((s: unknown, i) => {
      const p = `steps[${i}]`;
      if (!isRecord(s)) {
        problems.push(`${p} must be an object`);
        return;
      }
      closed(s, ["from", "to", "label"], p, problems);
      const from = field(s["from"], `${p}.from`, SCENARIO_LIMITS.maxName, problems, true);
      const to = field(s["to"], `${p}.to`, SCENARIO_LIMITS.maxName, problems, true);
      const label = field(s["label"], `${p}.label`, SCENARIO_LIMITS.maxLabel, problems, false);
      if (from && NAME_FORBIDDEN.test(from))
        problems.push(`${p}.from "${from}" contains characters reserved by the syntax`);
      if (to && NAME_FORBIDDEN.test(to))
        problems.push(`${p}.to "${to}" contains characters reserved by the syntax`);
      if (label && LABEL_FORBIDDEN.test(label))
        problems.push(`${p}.label contains characters reserved by the syntax`);
      if (from && to && from.toLowerCase() === to.toLowerCase())
        problems.push(`${p} connects "${from}" to itself`);
      steps.push({ from, to, label });
    });

  const components = new Set(steps.flatMap((s) => [s.from.toLowerCase(), s.to.toLowerCase()]));
  if (components.size > SCENARIO_LIMITS.maxComponents)
    problems.push(`more than ${SCENARIO_LIMITS.maxComponents} components`);
  if (problems.length) return { ok: false, problems };
  return { ok: true, scenario: { title, request, steps } };
}

/**
 * Replies sometimes wrap the JSON in a code fence or a sentence: take the outermost object.
 * Anything that is not valid JSON is a bad reply.
 */
export function parseModelReply(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(content.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

/** The editable instructions, in the syntax of the "Describe" source format. */
export function renderInstructions(s: InstructionScenario): string {
  const head = [`title: ${s.title}`, ...(s.request ? [`request: ${s.request}`] : [])];
  const lines = s.steps.map((x) => `${x.from} -> ${x.to}${x.label ? ` : ${x.label}` : ""}`);
  return `${head.join("\n")}\n\n${lines.join("\n")}\n`;
}
