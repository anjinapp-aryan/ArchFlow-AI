import {
  CANONICAL_SCHEMA_ID,
  CANONICAL_SCHEMA_MINOR,
  LIMITS,
  looksLikeMonitoring,
  validateCanonical,
  type CanonicalDocument,
  type CanonicalEdge,
  type CanonicalNode,
} from "@archflow/canonical-model";
import { IdMapper, applyRoutes, layoutGraph } from "@archflow/diagram-importers";
import type { FailureSpec, SynthesisIssue, SynthesisOptions } from "./synthesize.ts";

/**
 * Text description -> diagram (+ synthesis options), with deterministic rules only.
 *
 * Accepted, one statement per line (or per sentence):
 *   User -> API Gateway -> Order Service : HTTPS         chains; `: label` labels every hop
 *   Kafka -> Consumer 1, Consumer 2 -> PostgreSQL        `,` = fan-out / fan-in
 *   A <-> B   A -- B   A ..> B (async)   A <- B (reverse)
 *   The API Gateway forwards the request to the Order Service.   (verb sentences)
 *   Consumer 1 consumes from Kafka.                              (consume = reverse, async)
 *   title: ...   entry: User   fail: Consumer 2 -> PostgreSQL timeout retries 2
 *   request: GET /api/orders    (what the entry sends; rule routers match its path and host)
 *   monitor: ALB Health Check -> Order API, Payment API : GET /health every 30s
 *       (health checks / probes: periodic monitoring, never part of request routing; connectors
 *        labelled like a health check, or starting at a "health check"/"monitor" component, are
 *        treated the same way and reported)
 *   Consumer 2 fails calling PostgreSQL and retries twice.
 * Anything not understood is reported as a warning, never guessed.
 *
 * Ordered interactions: when a description answers a call explicitly (`A -> B` and later
 * `B -> A`) or makes the same call twice with different labels, the lines are one request
 * lifecycle in the order written. Each pair of components then gets one connector, and every
 * line becomes one animated step on it (`options.sequence`), e.g.
 *   Spring Boot API -> Redis : GET product:101
 *   Redis -> Spring Boot API : cache miss          (reply on the same connector)
 *   Spring Boot API -> Redis : SET product:101     (second call on the same connector)
 * Descriptions without such lines keep the graph-routing behaviour.
 */

export interface DescriptionResult {
  ok: boolean;
  document?: CanonicalDocument;
  options: SynthesisOptions;
  warnings: SynthesisIssue[];
  errors: SynthesisIssue[];
}

const ARROWS: {
  re: RegExp;
  dir: CanonicalEdge["direction"];
  stroke: CanonicalEdge["stroke"];
  reverse?: boolean;
}[] = [
  { re: /^(<-->|<->|↔)$/, dir: "both", stroke: "solid" },
  { re: /^(\.\.>|~>|-\.->|⇢)$/, dir: "forward", stroke: "dashed" },
  { re: /^(-->|->|→|=>)$/, dir: "forward", stroke: "solid" },
  { re: /^(<--|<-|←)$/, dir: "forward", stroke: "solid", reverse: true },
  { re: /^(---|--|—)$/, dir: "none", stroke: "solid" },
];
const ARROW_SPLIT = /\s*(<-->|<->|↔|\.\.>|~>|-\.->|⇢|-->|->|→|=>|<--|<-|←|---|--|—)\s*/;

const VERB =
  /^(?:then\s+|and\s+)?(?:the\s+)?(.+?)\s+(sends?|calls?|forwards?|routes?|passes?|publish(?:es)?|writes?|reads?|quer(?:y|ies)|notif(?:y|ies)|emits?|pushes|posts?|requests?|validates?|checks?|stores?|saves?|produces?|consumes?|subscribes?|pulls?|fetch(?:es)?|delegates?|hands?)\b(.*?)\s+(?:to|into|in|from|on|with|via|against)\s+(?:the\s+)?(.+?)$/i;
const DIRECT =
  /^(?:then\s+|and\s+)?(?:the\s+)?(.+?)\s+(calls?|quer(?:y|ies)|invokes?|hits?|uses?|contacts?|reads?|updates?)\s+(?:the\s+)?(.+?)$/i;
const FAIL_SENTENCE =
  /^(?:the\s+)?(.+?)\s+(?:fails|times\s+out|errors?)\s+(?:when\s+)?(?:calling|writing\s+to|reading\s+from|talking\s+to|to\s+reach|reaching|on|to)\s+(?:the\s+)?(.+?)(?:\s+and\s+retries(?:\s+(once|twice|three\s+times|\d+\s+times))?)?$/i;

const KIND_RULES: [RegExp, CanonicalNode["kind"]][] = [
  [/\b(user|customer|person|actor|admin|operator)s?\b/i, "user"],
  [/\b(client|browser|mobile|frontend|front-end|web\s*app|spa|ui)\b/i, "client"],
  [/\bgateway\b/i, "gateway"],
  [/\b(load\s*balancer|lb|nginx|haproxy|alb|elb)\b/i, "balancer"],
  [
    /\b(kafka|queue|rabbit\s*mq|rabbitmq|sqs|sns|pub\s*\/?\s*sub|kinesis|event\s*(bus|hub)|topic|nats|broker)\b/i,
    "queue",
  ],
  [/\b(redis|memcached|cache)\b/i, "cache"],
  [
    /\b(postgres(ql)?|mysql|mariadb|mongo(db)?|dynamo(db)?|cassandra|sqlite|oracle|database|db|sql\s*server|elasticsearch|warehouse)\b/i,
    "db",
  ],
  [/\b(s3|bucket|blob|storage|cdn)\b/i, "cloud"],
  [/\b(stripe|paypal|twilio|sendgrid|third[- ]party|external)\b/i, "external"],
];

export function inferKind(label: string): CanonicalNode["kind"] {
  for (const [re, kind] of KIND_RULES) if (re.test(label)) return kind;
  return "service";
}

const clean = (s: string): string =>
  s
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[.;!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

function retriesWord(w: string | undefined): number {
  if (!w) return 1;
  if (/^once$/i.test(w)) return 1;
  if (/^twice$/i.test(w)) return 2;
  if (/^three/i.test(w)) return 3;
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 1;
}

export function parseDescription(text: string): DescriptionResult {
  const warnings: SynthesisIssue[] = [];
  const errors: SynthesisIssue[] = [];
  const options: SynthesisOptions = {};
  const failures: FailureSpec[] = [];
  let title = "Described architecture";
  if (typeof text !== "string" || text.trim() === "")
    return {
      ok: false,
      options,
      warnings,
      errors: [{ code: "text.empty", message: "the description is empty" }],
    };
  if (text.length > 200_000)
    return {
      ok: false,
      options,
      warnings,
      errors: [{ code: "text.too_large", message: "the description is too long" }],
    };

  const labels = new Map<string, string>(); // lowercase -> display label (first spelling wins)
  const order: string[] = [];
  const node = (raw: string): string | undefined => {
    const label = clean(raw);
    if (!label) return undefined;
    const key = label.toLowerCase();
    if (!labels.has(key)) {
      labels.set(key, label.slice(0, LIMITS.maxLabelLength));
      order.push(key);
    }
    return key;
  };
  const rawEdges: {
    from: string;
    to: string;
    label?: string;
    direction: CanonicalEdge["direction"];
    stroke: CanonicalEdge["stroke"];
    monitoring?: true;
  }[] = [];
  /** Every non-monitoring interaction in the order written (before connector de-duplication). */
  const steps: { from: string; to: string; label?: string; sync: boolean }[] = [];
  let monitoringStatement = false;
  const edge = (
    a: string,
    b: string,
    label: string | undefined,
    direction: CanonicalEdge["direction"],
    stroke: CanonicalEdge["stroke"],
  ): void => {
    if (a === b) {
      warnings.push({
        code: "text.self_loop",
        message: `"${labels.get(a)}" connected to itself; ignored`,
      });
      return;
    }
    if (!monitoringStatement)
      steps.push({
        from: a,
        to: b,
        ...(label ? { label: label.slice(0, LIMITS.maxLabelLength) } : {}),
        sync: direction === "forward" && stroke === "solid",
      });
    if (rawEdges.some((e) => e.from === a && e.to === b && (e.label ?? "") === (label ?? "")))
      return;
    rawEdges.push({
      from: a,
      to: b,
      ...(label ? { label: label.slice(0, LIMITS.maxLabelLength) } : {}),
      direction,
      stroke,
      ...(monitoringStatement ? { monitoring: true as const } : {}),
    });
  };

  // statements: lines, and sentences within lines (". " followed by a capital letter)
  const statements = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((s) => s.trim().replace(/^[-*•\d.)\s]+(?=[A-Za-z])/, ""))
    .filter((s) => s && !s.startsWith("#") && !s.startsWith("//"));

  for (const statement of statements) {
    let m: RegExpExecArray | null;
    let st = statement;
    monitoringStatement = false;
    if ((m = /^(?:monitor(?:ing)?|health(?:s*-?s*checks?)?|probes?)s*:s*(.+)$/i.exec(st))) {
      monitoringStatement = true;
      st = m[1]!;
    }
    if ((m = /^title\s*:\s*(.+)$/i.exec(st))) {
      title = clean(m[1]!) || title;
      continue;
    }
    if ((m = /^entry\s*:\s*(.+)$/i.exec(st))) {
      options.entry = clean(m[1]!);
      continue;
    }
    if ((m = /^request\s*:\s*(.+)$/i.exec(st))) {
      options.request = m[1]!.trim().slice(0, LIMITS.maxLabelLength);
      continue;
    }
    if (
      (m =
        /^fail(?:ure)?\s*:\s*(.+?)\s*(?:->|→)\s*(.+?)(?:\s+(timeout|error))?(?:\s+retr(?:y|ies)\s*(\d+))?\s*$/i.exec(
          st,
        ))
    ) {
      failures.push({
        from: clean(m[1]!),
        to: clean(m[2]!),
        mode: (m[3]?.toLowerCase() as "timeout" | "error") ?? "timeout",
        retries: m[4] ? parseInt(m[4], 10) : 1,
      });
      continue;
    }
    if ((m = FAIL_SENTENCE.exec(st.replace(/[.!]+$/, "")))) {
      failures.push({
        from: clean(m[1]!),
        to: clean(m[2]!),
        mode: /time/i.test(st) ? "timeout" : "error",
        retries: retriesWord(m[3]),
      });
      continue;
    }
    // arrow chains
    if (ARROW_SPLIT.test(st)) {
      const [body, ...labelParts] = st.split(/\s:\s|:\s*(?=[^:]*$)/);
      const label = labelParts.length ? clean(labelParts.join(":")) : undefined;
      const parts = body!.split(ARROW_SPLIT);
      if (parts.length < 3 || parts.length % 2 === 0) {
        warnings.push({
          code: "text.unrecognised",
          message: `could not read: "${st.slice(0, 80)}"`,
        });
        continue;
      }
      let ok = true;
      for (let i = 0; i + 2 < parts.length; i += 2) {
        const op = ARROWS.find((a) => a.re.test(parts[i + 1]!.trim()));
        const left = parts[i]!.split(",")
          .map(node)
          .filter((x): x is string => !!x);
        const right = parts[i + 2]!.split(",")
          .map(node)
          .filter((x): x is string => !!x);
        if (!op || left.length === 0 || right.length === 0) {
          ok = false;
          break;
        }
        for (const a of left)
          for (const b of right)
            if (op.reverse) edge(b, a, label, op.dir, op.stroke);
            else edge(a, b, label, op.dir, op.stroke);
      }
      if (!ok)
        warnings.push({
          code: "text.unrecognised",
          message: `could not read: "${st.slice(0, 80)}"`,
        });
      continue;
    }
    // verb sentences
    if ((m = VERB.exec(st.replace(/[.!]+$/, "")))) {
      const verb = m[2]!.toLowerCase();
      const obj = clean(m[3] ?? "").replace(/^(a|an|the|it|them|its)\s+/i, "");
      const a = node(m[1]!);
      const b = node(m[4]!);
      if (!a || !b) continue;
      const reverse = /^(consume|subscribe|pull)/.test(verb);
      const async = /^(publish|emit|produce|consume|subscribe|notif|push)/.test(verb);
      const label = obj && obj.length <= 40 ? obj : undefined;
      if (reverse) edge(b, a, label, "forward", async ? "dashed" : "solid");
      else edge(a, b, label, "forward", async ? "dashed" : "solid");
      continue;
    }
    if ((m = DIRECT.exec(st.replace(/[.!]+$/, "")))) {
      const a = node(m[1]!);
      const b = node(m[3]!);
      if (a && b) edge(a, b, undefined, "forward", "solid");
      continue;
    }
    warnings.push({ code: "text.unrecognised", message: `could not read: "${st.slice(0, 80)}"` });
  }

  if (order.length === 0)
    return {
      ok: false,
      options,
      warnings,
      errors: [
        {
          code: "text.no_components",
          message: 'no components found; write e.g. "User -> API -> Database"',
        },
      ],
    };
  if (order.length > LIMITS.maxNodes)
    return {
      ok: false,
      options,
      warnings,
      errors: [{ code: "text.too_many", message: `more than ${LIMITS.maxNodes} components` }],
    };

  // an ordered lifecycle: one connector per pair of components, every line a step on it
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const sequential = steps.some((s, j) =>
    steps.some(
      (r, i) =>
        i < j &&
        ((s.sync && r.sync && r.from === s.to && r.to === s.from) ||
          (r.from === s.from && r.to === s.to && (r.label ?? "") !== (s.label ?? ""))),
    ),
  );
  if (sequential) {
    const seen = new Set<string>();
    const kept = rawEdges.filter((e) => {
      if (e.monitoring) return true;
      const k = pairKey(e.from, e.to);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    rawEdges.splice(0, rawEdges.length, ...kept);
    options.sequence = steps.map((s) => ({
      from: labels.get(s.from)!,
      to: labels.get(s.to)!,
      ...(s.label ? { label: s.label } : {}),
    }));
  }

  const ids = new IdMapper("node");
  const idOf = new Map(
    order.map((k) => [k, ids.assign(labels.get(k)!.replace(/\s+/g, "-").toLowerCase())]),
  );
  const nodes: CanonicalNode[] = order.map((k) => ({
    id: idOf.get(k)!,
    label: labels.get(k)!,
    kind: inferKind(labels.get(k)!),
    x: 0,
    y: 0,
    w: 120,
    h: 60,
  }));
  const inferred: string[] = [];
  const edges: CanonicalEdge[] = rawEdges.map((e, i) => {
    let interaction: CanonicalEdge["interaction"] = e.monitoring
      ? "monitoring"
      : e.stroke === "solid"
        ? "sync_request"
        : "async_message";
    if (!e.monitoring && looksLikeMonitoring(e.label, { label: labels.get(e.from)! })) {
      interaction = "monitoring";
      inferred.push(`${labels.get(e.from)} -> ${labels.get(e.to)}`);
    }
    return {
      id: `e${i + 1}`,
      from: idOf.get(e.from)!,
      to: idOf.get(e.to)!,
      ...(e.label ? { label: e.label } : {}),
      direction: e.direction,
      arrowHead: e.direction === "none" ? "none" : "triangle",
      stroke: interaction === "monitoring" ? "dashed" : e.stroke,
      routing: "curved",
      interaction,
    };
  });
  if (inferred.length)
    warnings.push({
      code: "text.monitoring_inferred",
      message: `treated as health checks (monitoring, not request routing): ${inferred.slice(0, 5).join("; ")}${inferred.length > 5 ? "; …" : ""}. Write "monitor: A -> B" to say so explicitly.`,
    });
  const placed = layoutGraph(
    nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
    [],
    edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      ...(e.interaction ? { interaction: e.interaction } : {}),
      arrowStart: e.direction === "backward" || e.direction === "both",
      arrowEnd: e.direction === "forward" || e.direction === "both",
    })),
    "LR",
  );
  for (const n of nodes) Object.assign(n, placed.nodes.get(n.id)!);
  applyRoutes(edges, placed.edges);
  if (failures.length) options.failures = failures;

  const doc: CanonicalDocument = {
    schema: CANONICAL_SCHEMA_ID,
    schemaMinor: CANONICAL_SCHEMA_MINOR,
    diagram: {
      id: "described",
      name: title.slice(0, LIMITS.maxLabelLength),
      nodes,
      edges,
      groups: [],
    },
  };
  const v = validateCanonical(doc);
  if (!v.ok)
    return {
      ok: false,
      options,
      warnings,
      errors: v.errors.map((e) => ({ code: `text.invalid_output.${e.code}`, message: e.message })),
    };
  return { ok: true, document: v.value, options, warnings, errors };
}
