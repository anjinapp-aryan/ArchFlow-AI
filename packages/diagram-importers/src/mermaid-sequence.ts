import {
  LIMITS,
  type CanonicalEdge,
  type CanonicalEvent,
  type CanonicalGroup,
  type CanonicalNode,
  type CanonicalScenario,
  type PacketEvent,
} from "@archflow/canonical-model";
import { IdMapper, Issues, fitLabel } from "./common.ts";
import { NODE_H, nodeWidth } from "./layout.ts";
import { ignorable, unquote, type Statement } from "./mermaid-text.ts";

/**
 * Mermaid `sequenceDiagram` -> canonical diagram + scenario.
 *
 * A sequence diagram is an interaction, so it maps to BOTH: participants become components laid
 * out in a row, each communicating pair becomes one connector, and every message becomes a timed
 * packet in document order (fixed, deterministic timing). Replies (dashed arrows) are paired with
 * the request they answer (`respondsTo`); `-x` is a failed message (`error`); `-)` is async
 * (`event`); `par`/`and` branches start at the same instant; activations become `active` states;
 * `box` becomes a group. Other blocks (loop/alt/opt/...) are flattened in order, with a warning.
 */

export const MESSAGE_MS = 800;
export const MESSAGE_GAP_MS = 200;
const START_MS = 300;
const NOTE_MS = 1200;
const NOTE_ADVANCE_MS = 600;
const COLUMN_GAP = 80;

const CSS_COLOR =
  /^(?:rgb|rgba|hsl|hsla)\([^)]*\)\s*|^#[0-9a-fA-F]{3,8}\s+|^(?:transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|white|yellow|pink|cyan|magenta|brown|gold|beige|ivory|lavender|coral|salmon|khaki|violet|indigo|turquoise|tan|lightblue|lightgreen|lightyellow|lightgrey|lightgray|lightpink|lightcyan|darkblue|darkgreen|darkred|darkgray|darkgrey|aliceblue|honeydew|mintcream|azure|seashell|linen|wheat|plum|orchid|thistle)\s+/i;

const MESSAGE_RE =
  /^([^\s:<>+-]+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^\s:<>+-][^\s:]*?)\s*(?::(.*))?$/;

export interface SequenceOutput {
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  groups: CanonicalGroup[];
  scenario: CanonicalScenario;
}

export function parseSequence(statements: Statement[], issues: Issues): SequenceOutput | undefined {
  if (!/^sequenceDiagram\b/.test(statements[0]?.text ?? "")) {
    issues.error("mermaid.not_sequence", "expected a `sequenceDiagram` header");
    return undefined;
  }
  interface P {
    key: string;
    label: string;
    kind: CanonicalNode["kind"];
    box?: number;
  }
  const parts = new Map<string, P>();
  const boxes: { label: string }[] = [];
  const blocks: { kind: string; start: number; maxEnd: number }[] = [];
  let currentBox: number | undefined;
  const ensure = (key: string, label?: string, kind?: CanonicalNode["kind"]): P => {
    let p = parts.get(key);
    if (!p) {
      p = {
        key,
        label: label ?? key,
        kind: kind ?? "service",
        ...(currentBox !== undefined ? { box: currentBox } : {}),
      };
      parts.set(key, p);
    } else {
      if (label !== undefined) p.label = label;
      if (kind !== undefined) p.kind = kind;
    }
    return p;
  };

  interface Msg {
    id: string;
    from: string;
    to: string;
    label: string;
    t: number;
    variant: PacketEvent["variant"];
    dashed: boolean;
    respondsTo?: string;
    line: number;
  }
  const msgs: Msg[] = [];
  const notes: { t: number; text: string; over: string[]; side: string; line: number }[] = [];
  const active = new Map<string, { count: number; since: number }>();
  const activations: { key: string; t: number; end: number }[] = [];
  let cursor = START_MS;

  const activate = (key: string, t: number): void => {
    const a = active.get(key) ?? { count: 0, since: t };
    if (a.count === 0) a.since = t;
    a.count++;
    active.set(key, a);
  };
  const deactivate = (key: string, t: number, where: string): void => {
    const a = active.get(key);
    if (!a || a.count === 0) {
      issues.warn("mermaid.deactivate_inactive", `"${key}" deactivated while not active`, where);
      return;
    }
    a.count--;
    if (a.count === 0) activations.push({ key, t: a.since, end: Math.max(t, a.since + 1) });
  };

  for (const st of statements.slice(1)) {
    const t = st.text;
    const where = `line ${st.line}`;
    let m: RegExpExecArray | null;
    if (
      (m = /^(?:create\s+)?(participant|actor)\s+([^\s@]+)(@\{[^}]*\})?(?:\s+as\s+(.+))?$/i.exec(t))
    ) {
      const meta = m[3] ?? "";
      const type = /"?type"?\s*:\s*"?(\w+)"?/.exec(meta)?.[1]?.toLowerCase();
      const kind: CanonicalNode["kind"] =
        m[1]!.toLowerCase() === "actor" || type === "actor"
          ? "user"
          : type === "database"
            ? "db"
            : type === "queue"
              ? "queue"
              : "service";
      ensure(m[2]!, m[4] !== undefined ? unquote(m[4]) : undefined, kind);
      continue;
    }
    if (/^destroy\s+/i.test(t)) {
      issues.warnOnce(
        "mermaid.destroy_ignored",
        "`destroy` is not represented; the participant stays",
        where,
      );
      continue;
    }
    if ((m = /^box(?:\s+(.*))?$/i.exec(t))) {
      const title = (m[1] ?? "").replace(CSS_COLOR, "").trim();
      boxes.push({ label: unquote(title) || "Box" });
      currentBox = boxes.length - 1;
      blocks.push({ kind: "box", start: cursor, maxEnd: cursor });
      continue;
    }
    if ((m = /^(loop|alt|opt|par|critical|break|rect)\b/i.exec(t))) {
      const kind = m[1]!.toLowerCase();
      if (kind !== "par" && kind !== "rect")
        issues.warnOnce(
          "mermaid.block_flattened",
          "loop/alt/opt/critical/break blocks are played once, in document order (their logic is not represented)",
          where,
        );
      blocks.push({ kind, start: cursor, maxEnd: cursor });
      continue;
    }
    if ((m = /^(else|and|option)\b/i.exec(t))) {
      const top = blocks[blocks.length - 1];
      if (top?.kind === "par" && m[1]!.toLowerCase() === "and") {
        top.maxEnd = Math.max(top.maxEnd, cursor);
        cursor = top.start;
      }
      continue;
    }
    if (/^end$/i.test(t)) {
      const top = blocks.pop();
      if (!top) issues.warn("mermaid.unbalanced_end", "`end` without an open block", where);
      else if (top.kind === "par") cursor = Math.max(cursor, top.maxEnd);
      else if (top.kind === "box") currentBox = undefined;
      continue;
    }
    if ((m = /^(activate|deactivate)\s+(\S+)$/i.exec(t))) {
      ensure(m[2]!);
      if (m[1]!.toLowerCase() === "activate") activate(m[2]!, cursor);
      else deactivate(m[2]!, cursor, where);
      continue;
    }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(t))) {
      const over = m[2]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const k of over) ensure(k);
      notes.push({
        t: cursor,
        text: unquote(m[3]!),
        over,
        side: m[1]!.toLowerCase(),
        line: st.line,
      });
      cursor += NOTE_ADVANCE_MS;
      continue;
    }
    if (
      ignorable(
        st,
        issues,
        /^(autonumber|title|accTitle|accDescr|links?|properties|details)\b/i,
        "not represented and were ignored",
      )
    )
      continue;
    if ((m = MESSAGE_RE.exec(t))) {
      const [, from, arrow, marker, to, text] = m as unknown as [
        string,
        string,
        string,
        string,
        string,
        string?,
      ];
      ensure(from);
      ensure(to);
      if (from === to) {
        issues.warn("mermaid.self_message", "self-messages are not supported; dropped", where);
        continue;
      }
      const dashed = arrow.startsWith("--") || arrow === "<<-->>";
      let variant: PacketEvent["variant"] = "request";
      if (arrow.endsWith("x")) variant = "error";
      else if (arrow.endsWith(")")) variant = "event";
      else if (arrow.startsWith("<<")) {
        variant = "event";
        issues.warnOnce(
          "mermaid.bidirectional_message",
          "bidirectional messages are imported as one message",
          where,
        );
      }
      const msg: Msg = {
        id: `m${msgs.length + 1}`,
        from,
        to,
        label: fitLabel(unquote(text ?? ""), issues, where),
        t: cursor,
        variant,
        dashed,
        line: st.line,
      };
      if (dashed && variant !== "error") {
        // reply: pair with the latest unanswered request in the opposite direction that has ended
        const answered = new Set(msgs.filter((x) => x.respondsTo).map((x) => x.respondsTo!));
        const req = [...msgs]
          .reverse()
          .find(
            (r) =>
              r.from === to &&
              r.to === from &&
              !r.dashed &&
              (r.variant === "request" || r.variant === "event") &&
              !answered.has(r.id) &&
              r.t + MESSAGE_MS <= cursor,
          );
        if (req) {
          msg.variant = "response";
          msg.respondsTo = req.id;
        } else msg.variant = "success";
      }
      msgs.push(msg);
      if (marker === "+") activate(to, cursor);
      cursor += MESSAGE_MS + MESSAGE_GAP_MS;
      if (marker === "-") deactivate(from, cursor - MESSAGE_GAP_MS, where);
      continue;
    }
    issues.warn("mermaid.unrecognised_statement", `could not read: "${t.slice(0, 80)}"`, where);
  }
  if (blocks.length > 0)
    issues.warn("mermaid.unclosed_block", `${blocks.length} block(s) not closed with \`end\``);
  for (const [key, a] of active)
    if (a.count > 0) activations.push({ key, t: a.since, end: Math.max(cursor, a.since + 1) });

  if (parts.size === 0) {
    issues.error("mermaid.no_participants", "the sequence diagram has no participants");
    return undefined;
  }

  // ---- diagram ----
  const nodeIds = new IdMapper("node");
  let x = 40;
  const nodes: CanonicalNode[] = [];
  for (const p of parts.values()) {
    const w = nodeWidth(p.label, p.kind);
    nodes.push({
      id: nodeIds.assign(p.key),
      label: fitLabel(p.label, issues, p.key),
      kind: p.kind,
      x,
      y: 60,
      w,
      h: NODE_H,
    });
    x += w + COLUMN_GAP;
  }
  const groupIds = new IdMapper("group");
  const groups: CanonicalGroup[] = [];
  boxes.forEach((b, i) => {
    const members = [...parts.values()]
      .filter((p) => p.box === i)
      .map((p) => nodes.find((n) => n.id === nodeIds.get(p.key))!);
    if (members.length === 0) return;
    const id = groupIds.assign(`box${i + 1}`);
    for (const n of members) n.groupId = id;
    const x0 = Math.min(...members.map((n) => n.x)) - 16;
    const x1 = Math.max(...members.map((n) => n.x + n.w)) + 16;
    groups.push({
      id,
      label: fitLabel(b.label, issues, `box ${i + 1}`),
      frame: { x: x0, y: 60 - 16 - 28, w: x1 - x0, h: NODE_H + 32 + 28 },
    });
  });

  // one connector per communicating pair; arrow follows the request/event directions used
  const edgeIds = new IdMapper("edge");
  const pairs = new Map<string, { a: string; b: string; ab: boolean; ba: boolean; edge: string }>();
  const pairKey = (a: string, b: string): string => [a, b].sort().join("\u0000");
  for (const msg of msgs) {
    const k = pairKey(msg.from, msg.to);
    let p = pairs.get(k);
    if (!p) {
      p = {
        a: msg.from,
        b: msg.to,
        ab: false,
        ba: false,
        edge: edgeIds.assign(`e${pairs.size + 1}`),
      };
      pairs.set(k, p);
    }
    if (msg.variant === "request" || msg.variant === "event") {
      if (msg.from === p.a) p.ab = true;
      else p.ba = true;
    }
  }
  // Participants sit in one row: a connector that skips participants arcs above the row (one
  // lane per skipped distance) so it never runs through another participant's box.
  const column = new Map([...parts.keys()].map((k, i) => [k, i]));
  const lanes = new Map<number, number>();
  const edges: CanonicalEdge[] = [...pairs.values()].map((p) => {
    const ia = column.get(p.a)!;
    const ib = column.get(p.b)!;
    const span = Math.abs(ia - ib);
    const na = nodes[ia]!;
    const nb = nodes[ib]!;
    let waypoints: { x: number; y: number }[] | undefined;
    if (span > 1) {
      const lane = (lanes.get(span) ?? 0) + 1;
      lanes.set(span, lane);
      const y = 60 - 30 - 18 * (span - 2) - 10 * (lane - 1);
      waypoints = [
        { x: na.x + na.w / 2, y },
        { x: nb.x + nb.w / 2, y },
      ];
    }
    return {
      id: p.edge,
      from: nodeIds.get(p.a)!,
      to: nodeIds.get(p.b)!,
      direction: p.ab && p.ba ? "both" : p.ba ? "backward" : "forward",
      arrowHead: "triangle",
      stroke: "solid",
      routing: "straight",
      ...(waypoints ? { waypoints } : {}),
    };
  });

  // ---- scenario ----
  const events: CanonicalEvent[] = [];
  for (const msg of msgs)
    events.push({
      type: "packet",
      id: msg.id,
      t: msg.t,
      durationMs: MESSAGE_MS,
      from: nodeIds.get(msg.from)!,
      to: nodeIds.get(msg.to)!,
      edgeId: pairs.get(pairKey(msg.from, msg.to))!.edge,
      variant: msg.variant,
      ...(msg.label ? { label: msg.label } : {}),
      ...(msg.respondsTo ? { respondsTo: msg.respondsTo } : {}),
    });
  activations.forEach((a, i) =>
    events.push({
      type: "node_state",
      id: `act${i + 1}`,
      t: a.t,
      durationMs: a.end - a.t,
      nodeId: nodeIds.get(a.key)!,
      state: "active",
    }),
  );
  notes.forEach((n, i) => {
    const anchor = nodes.find((x) => x.id === nodeIds.get(n.over[0]!))!;
    events.push({
      type: "note",
      id: `note${i + 1}`,
      t: n.t,
      durationMs: NOTE_MS,
      text: n.text.slice(0, 500),
      x:
        n.side === "left of"
          ? anchor.x - 40
          : n.side === "right of"
            ? anchor.x + anchor.w + 10
            : anchor.x,
      y: anchor.y + anchor.h + 30,
    });
  });
  // Canonical events are kept sorted by start time (stable: messages keep document order on ties).
  events.sort((p, q) => p.t - q.t);
  const lastEnd = Math.max(START_MS, ...events.map((e) => e.t + e.durationMs));
  const durationMs = Math.max(1000, lastEnd + 500);
  if (durationMs > LIMITS.maxDurationMs) {
    issues.error(
      "mermaid.sequence_too_long",
      `${msgs.length} messages exceed the ${LIMITS.maxDurationMs / 1000} s scenario limit`,
    );
    return undefined;
  }
  if (events.length > LIMITS.maxEvents) {
    issues.error(
      "mermaid.too_many_events",
      `more than ${LIMITS.maxEvents} messages/notes/activations`,
    );
    return undefined;
  }
  return {
    nodes,
    edges,
    groups,
    scenario: { id: "sequence", durationMs, flows: [], events },
  };
}
