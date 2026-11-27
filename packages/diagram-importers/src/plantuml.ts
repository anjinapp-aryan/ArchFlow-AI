import type { CanonicalNode } from "@archflow/canonical-model";
import {
  IdMapper,
  Issues,
  checkInput,
  emptyDocument,
  finish,
  fitLabel,
  type ImportOptions,
  type ImportResult,
} from "./common.ts";
import { nodeWidth } from "./layout.ts";
import { parseFlowchart } from "./mermaid-flowchart.ts";
import { parseSequence } from "./mermaid-sequence.ts";
import type { Statement } from "./mermaid-text.ts";

/**
 * PlantUML importer (component/deployment-style diagrams and sequence diagrams), written for
 * ArchFlow; PlantUML itself (Java, GPL/LGPL/EPL/MIT editions) is not used.
 *
 * PlantUML text is translated statement by statement into the same intermediate statements the
 * Mermaid parsers consume, so links, groups, layout, sequence timing and reply pairing share one
 * tested implementation. Component kinds (database, queue, actor, cloud) are carried across.
 */

const ELEMENT_KINDS: Record<string, CanonicalNode["kind"]> = {
  component: "service",
  rectangle: "service",
  node: "service",
  agent: "service",
  artifact: "document",
  file: "document",
  card: "service",
  storage: "db",
  database: "db",
  queue: "queue",
  stack: "service",
  actor: "user",
  person: "user",
  boundary: "service",
  control: "service",
  entity: "service",
  collections: "service",
  cloud: "cloud",
  interface: "service",
  usecase: "service",
  hexagon: "service",
  label: "service",
};
const CONTAINERS =
  /^(package|node|folder|frame|cloud|database|rectangle|component|card|stack|together|namespace)$/i;

interface Ref {
  id: string;
  label: string;
}

/** `"Long name" as X`, `X as "Long name"`, `[Long name] as X`, `X`, `[Name]`, `()Name`, `:Name:` */
function parseRef(raw: string): Ref | undefined {
  const t = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(?:\[([^\]]+)\]|"([^"]+)"|\(\)\s*"?([^"]+?)"?|:([^:]+):)\s+as\s+([\w.]+)$/.exec(t)))
    return { id: m[5]!, label: (m[1] ?? m[2] ?? m[3] ?? m[4])!.trim() };
  if ((m = /^([\w.]+)\s+as\s+(?:"([^"]+)"|\[([^\]]+)\])$/.exec(t)))
    return { id: m[1]!, label: (m[2] ?? m[3])!.trim() };
  // `actor Customer as cust`: plain name, then alias
  if ((m = /^([\w.]+)\s+as\s+([\w.]+)$/.exec(t))) return { id: m[2]!, label: m[1]! };
  if ((m = /^\[([^\]]+)\]$/.exec(t))) return { id: m[1]!.trim(), label: m[1]!.trim() };
  if ((m = /^\(\)\s*"?([^"]+?)"?$/.exec(t))) return { id: m[1]!.trim(), label: m[1]!.trim() };
  if ((m = /^:([^:]+):$/.exec(t))) return { id: m[1]!.trim(), label: m[1]!.trim() };
  if ((m = /^"([^"]+)"$/.exec(t))) return { id: m[1]!, label: m[1]! };
  if ((m = /^([\w.]+)$/.exec(t))) return { id: m[1]!, label: m[1]! };
  return undefined;
}

// lhs, start head, line, direction, line, end head, rhs, label. Letter heads (`o`, `x`) only
// count when separated by whitespace from the element name, so `foo-->bar` stays a plain arrow.
const ARROW =
  /^(.+?)(?:\s+([o*#+x])|\s*(<\|?)|\s*)([-.=]+)(?:\[[^\]]*\])?(?:(?:up|down|left|right|u|d|l|r)(?=[-.=]))?([-.=]*)(\|?>|[*o#+x](?=\s))?\s*(.+?)(?:\s*:\s*(.*))?$/i;

/** Remove comments, @start/@end, skinparams; join block comments. */
function lines(text: string): Statement[] {
  const out: Statement[] = [];
  let inBlock = false;
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, i) => {
      let l = raw.trim();
      if (inBlock) {
        if (l.includes("'/")) {
          inBlock = false;
          l = l.slice(l.indexOf("'/") + 2).trim();
        } else return;
      }
      if (l.startsWith("/'")) {
        if (!l.includes("'/")) inBlock = true;
        return;
      }
      if (!l || l.startsWith("'")) return;
      out.push({ text: l, line: i + 1 });
    });
  return out;
}

export function importPlantUml(text: string, options: ImportOptions = {}): ImportResult {
  const issues = new Issues();
  if (!checkInput(text, issues, "plantuml"))
    return { ok: false, errors: issues.errors, warnings: [] };
  const src = lines(text);
  let title: string | undefined;
  let lr = false;
  const body: Statement[] = [];
  for (const st of src) {
    let m: RegExpExecArray | null;
    if (/^@(start|end)\w*/i.test(st.text)) {
      if (/^@start(?!uml)/i.test(st.text)) {
        issues.error(
          "plantuml.unsupported_diagram",
          `"${st.text}" diagrams are not supported (use @startuml)`,
        );
        return { ok: false, errors: issues.errors, warnings: issues.warnings };
      }
      continue;
    }
    if ((m = /^title\s+(.+)$/i.exec(st.text))) {
      title = m[1]!.trim();
      continue;
    }
    if (/^left\s+to\s+right\s+direction$/i.test(st.text)) {
      lr = true;
      continue;
    }
    if (
      /^(top\s+to\s+bottom\s+direction|skinparam|!|hide|show|scale|autonumber|legend|endlegend|footer|header|caption|newpage|allowmixing|set\s)/i.test(
        st.text,
      )
    ) {
      issues.warnOnce(
        `plantuml.ignored_${st.text.split(/\s+/)[0]!.replace(/\W/g, "").toLowerCase() || "directive"}`,
        `"${st.text.split(/\s+/)[0]}" is presentation only and was ignored`,
        `line ${st.line}`,
      );
      continue;
    }
    body.push(st);
  }
  // PlantUML picks the diagram type from the keywords used; count the unambiguous signals.
  const COMPONENT_KW =
    /^(component|package|node|folder|frame|cloud|rectangle|interface|usecase|artifact|storage|card|agent|stack|file|hexagon)\b/i;
  const SEQUENCE_KW =
    /^(participant|boundary|control|entity|collections|activate|deactivate|autoactivate|box|end\s*box|alt|else|loop|opt|par|critical|break|group|return)\b/i;
  const comp =
    body.filter(
      (b) =>
        COMPONENT_KW.test(b.text) ||
        /\[[^\]]+\]/.test(b.text) ||
        /\{\s*$/.test(b.text) ||
        /-(up|down|left|right|u|d|l|r)-/i.test(b.text),
    ).length + (lr ? 1 : 0);
  const seq = body.filter((b) => SEQUENCE_KW.test(b.text) || /->x|->>|<<-/.test(b.text)).length;
  const isSequence = seq > 0 && seq >= comp;
  const name = fitLabel(options.name ?? title ?? "Imported PlantUML diagram", issues, "name");
  const id = new IdMapper("diagram").assign(options.diagramId ?? "plantuml");
  return isSequence ? sequence(body, issues, id, name) : component(body, issues, id, name, lr);
}

// ---------------------------------------------------------------- sequence

function sequence(body: Statement[], issues: Issues, id: string, name: string): ImportResult {
  const out: Statement[] = [{ text: "sequenceDiagram", line: 0 }];
  const kinds = new Map<string, CanonicalNode["kind"]>();
  for (const st of body) {
    const t = st.text;
    let m: RegExpExecArray | null;
    const push = (text: string): void => void out.push({ text, line: st.line });
    if (
      (m =
        /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+?)(?:\s+order\s+\d+)?(?:\s+#\w+)?$/i.exec(
          t,
        ))
    ) {
      const ref = parseRef(m[2]!);
      if (!ref) {
        issues.warn(
          "plantuml.unrecognised_statement",
          `could not read: "${t.slice(0, 80)}"`,
          `line ${st.line}`,
        );
        continue;
      }
      const kw = m[1]!.toLowerCase();
      kinds.set(ref.id, ELEMENT_KINDS[kw] ?? "service");
      push(`${kw === "actor" ? "actor" : "participant"} ${ref.id} as ${ref.label}`);
      continue;
    }
    if ((m = /^box(?:\s+"([^"]*)")?/i.exec(t))) {
      push(`box ${m[1] ?? "Box"}`);
      continue;
    }
    if (/^end\s*box$/i.test(t)) {
      push("end");
      continue;
    }
    if ((m = /^(alt|else|loop|opt|par|critical|break|group)\b(.*)$/i.exec(t))) {
      push(`${m[1]!.toLowerCase() === "group" ? "rect" : m[1]!.toLowerCase()}${m[2]}`);
      continue;
    }
    if (/^end$/i.test(t)) {
      push("end");
      continue;
    }
    if ((m = /^(activate|deactivate)\s+(\S+)/i.exec(t))) {
      push(`${m[1]!.toLowerCase()} ${m[2]}`);
      continue;
    }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(t))) {
      push(`Note ${m[1]} ${m[2]}: ${m[3]}`);
      continue;
    }
    if (
      /^(note|end\s*note|ref|end\s*ref|==|\.\.\.|\|\|\||return|hnote|rnote|destroy|create|autoactivate|delay)/i.test(
        t,
      )
    ) {
      issues.warnOnce(
        "plantuml.sequence_construct_ignored",
        "notes spanning lines, dividers, delays, references and `return` are not imported",
        `line ${st.line}`,
      );
      continue;
    }
    if (
      (m =
        /^("?[\w ]+?"?|\w+)\s*([<]?-{1,2}(?:\[[^\]]*\])?>{0,2}x?)\s*("?[\w ]+?"?|\w+)\s*(?::\s*(.*))?$/.exec(
          t,
        ))
    ) {
      let from = m[1]!.replace(/"/g, "").trim();
      let to = m[3]!.replace(/"/g, "").trim();
      let arrow = m[2]!.replace(/\[[^\]]*\]/, "");
      if (arrow.startsWith("<")) {
        [from, to] = [to, from];
        arrow = arrow.slice(1) + ">";
      }
      const dashed = arrow.startsWith("--");
      const op = arrow.endsWith("x")
        ? dashed
          ? "--x"
          : "-x"
        : arrow.endsWith(">>")
          ? dashed
            ? "--)"
            : "-)"
          : dashed
            ? "-->>"
            : "->>";
      push(`${from.replace(/\s+/g, "_")}${op}${to.replace(/\s+/g, "_")}: ${m[4] ?? ""}`);
      continue;
    }
    issues.warn(
      "plantuml.unrecognised_statement",
      `could not read: "${t.slice(0, 80)}"`,
      `line ${st.line}`,
    );
  }
  const res = parseSequence(out, issues);
  if (!res) return { ok: false, errors: issues.errors, warnings: issues.warnings };
  for (const n of res.nodes) {
    const k = kinds.get(n.id);
    if (k && k !== n.kind) {
      n.kind = k;
      const w = nodeWidth(n.label, k);
      if (w > n.w) {
        n.x -= Math.round((w - n.w) / 2);
        n.w = w;
      }
    }
  }
  const doc = emptyDocument(id, name);
  Object.assign(doc.diagram, { nodes: res.nodes, edges: res.edges, groups: res.groups });
  doc.scenario = { ...res.scenario, diagramId: id };
  return finish(doc, issues);
}

// ---------------------------------------------------------------- component / deployment

function component(
  body: Statement[],
  issues: Issues,
  id: string,
  name: string,
  lr: boolean,
): ImportResult {
  const out: Statement[] = [{ text: `flowchart ${lr ? "LR" : "TB"}`, line: 0 }];
  const kinds = new Map<string, CanonicalNode["kind"]>();
  const known = new Map<string, string>(); // label or alias -> id
  let groupCount = 0;
  const nodeId = (ref: Ref): string => {
    const key = known.get(ref.id) ?? known.get(ref.label);
    if (key) return key;
    const nid = ref.id.replace(/[^\w]/g, "_");
    known.set(ref.id, nid);
    known.set(ref.label, nid);
    return nid;
  };
  const q = (s: string): string => `"${s.replace(/"/g, "#quot;")}"`;
  const declared = new Set<string>();
  for (const st of body) {
    const t = st.text;
    const push = (text: string): void => void out.push({ text, line: st.line });
    let m: RegExpExecArray | null;
    // container start: `package "Title" {`, `node X {`, `cloud {`
    if ((m = /^(\w+)\s*(.*?)\s*\{$/.exec(t)) && CONTAINERS.test(m[1]!)) {
      const ref = m[2] ? parseRef(m[2].replace(/#\w+$/, "").trim()) : undefined;
      groupCount++;
      const gid = (ref?.id ?? `group${groupCount}`).replace(/[^\w]/g, "_");
      push(`subgraph ${gid}[${q(ref?.label ?? m[1]!)}]`);
      continue;
    }
    if (t === "}") {
      push("end");
      continue;
    }
    // element declaration: `database "Orders DB" as db`, `component [API] as api`, `[API]`, `actor User`
    if (
      (m = /^(\w+)\s+(.+?)(?:\s+<<[^>]*>>)?(?:\s+#\w+)?$/.exec(t)) &&
      ELEMENT_KINDS[m[1]!.toLowerCase()] !== undefined &&
      !/[-.=]{2,}|->|<-/.test(m[2]!)
    ) {
      const ref = parseRef(m[2]!);
      if (ref) {
        const nid = nodeId(ref);
        kinds.set(nid, ELEMENT_KINDS[m[1]!.toLowerCase()]!);
        declared.add(nid);
        push(`${nid}[${q(ref.label)}]`);
        continue;
      }
    }
    if ((m = /^\[([^\]]+)\](?:\s+as\s+([\w.]+))?$/.exec(t))) {
      const ref: Ref = { id: m[2] ?? m[1]!, label: m[1]! };
      declared.add(nodeId(ref));
      push(`${nodeId(ref)}[${q(ref.label)}]`);
      continue;
    }
    if (/^note\b/i.test(t) || /^end\s*note$/i.test(t)) {
      issues.warnOnce("plantuml.note_ignored", "notes are not imported", `line ${st.line}`);
      continue;
    }
    if ((m = ARROW.exec(t))) {
      const [, lhs, letterHead, angleHead, line1, line2, head2, rhs, label] = m;
      const head1 = letterHead ?? angleHead;
      const a = parseRef(lhs!);
      const b = parseRef(rhs!);
      if (!a || !b) {
        issues.warn(
          "plantuml.unrecognised_statement",
          `could not read: "${t.slice(0, 80)}"`,
          `line ${st.line}`,
        );
        continue;
      }
      const dashed = (line1! + line2!).includes(".");
      const start = !!head1;
      const end = !!head2;
      if ((head1 && /\|/.test(head1)) || (head2 && /\|/.test(head2)))
        issues.warnOnce(
          "plantuml.uml_relation",
          "UML relation heads (extension, composition, aggregation) are imported as arrows",
          `line ${st.line}`,
        );
      const op =
        start && end
          ? dashed
            ? "<-.->"
            : "<-->"
          : end
            ? dashed
              ? "-.->"
              : "-->"
            : start
              ? dashed
                ? "-.->"
                : "-->"
              : dashed
                ? "-.-"
                : "---";
      const [x, y] = start && !end ? [b, a] : [a, b];
      const lbl = label?.trim() ? `|${q(label.trim())}|` : "";
      const xi = nodeId(x);
      const yi = nodeId(y);
      // declare on first use only: a bare reference must not overwrite a declared label
      if (!declared.has(xi)) push(`${xi}[${q(x.label)}]`);
      if (!declared.has(yi)) push(`${yi}[${q(y.label)}]`);
      declared.add(xi);
      declared.add(yi);
      push(`${xi} ${op}${lbl} ${yi}`);
      continue;
    }
    issues.warn(
      "plantuml.unrecognised_statement",
      `could not read: "${t.slice(0, 80)}"`,
      `line ${st.line}`,
    );
  }
  const res = parseFlowchart(out, issues);
  if (!res) return { ok: false, errors: issues.errors, warnings: issues.warnings };
  for (const n of res.nodes) {
    const k = kinds.get(n.id);
    if (k && k !== n.kind) {
      n.kind = k;
      const w = nodeWidth(n.label, k);
      if (w > n.w) {
        n.x -= Math.round((w - n.w) / 2);
        n.w = w;
      }
    }
  }
  if (res.nodes.length === 0) issues.error("plantuml.no_components", "no components found");
  const doc = emptyDocument(id, name);
  Object.assign(doc.diagram, { nodes: res.nodes, edges: res.edges, groups: res.groups });
  return finish(doc, issues);
}
