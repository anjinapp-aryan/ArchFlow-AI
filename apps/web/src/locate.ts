import { edgeInteraction, type CanonicalDocument } from "@archflow/canonical-model";
import type { Issue } from "./pipeline.ts";

/**
 * Where a diagnostic points: a line of the source text, and/or components and connectors of the
 * diagram. Only unambiguous evidence is used (an explicit `line N`, a JSON path, a unique label);
 * when nothing maps reliably, `reason` says why, so the UI never highlights the wrong thing.
 * Pure: no DOM, tested in Node.
 */
export interface IssueLocation {
  /** 1-based line in the source text. */
  line?: number;
  nodes: string[];
  edges: string[];
  /** Why nothing is shown on the diagram (when nodes and edges are empty). */
  reason?: string;
}

const quoted = (m: string): string[] => [...m.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);

/** Node ids whose label is exactly `label` (case-insensitive); empty when not unique. */
function nodeByLabel(doc: CanonicalDocument, label: string): string[] {
  const l = label.trim().toLowerCase();
  const hits = doc.diagram.nodes.filter((n) => n.label.trim().toLowerCase() === l);
  return hits.length === 1 ? [hits[0]!.id] : [];
}

/** Edge ids for "A -> B" pairs (labels), when both ends resolve uniquely. */
function edgesByPairs(doc: CanonicalDocument, pairs: string[]): string[] {
  const out: string[] = [];
  for (const p of pairs) {
    const m = /^(.+?)\s*->\s*(.+)$/.exec(p.trim());
    if (!m) continue;
    const a = nodeByLabel(doc, m[1]!)[0];
    const b = nodeByLabel(doc, m[2]!)[0];
    if (!a || !b) continue;
    for (const e of doc.diagram.edges)
      if ((e.from === a && e.to === b) || (e.from === b && e.to === a)) out.push(e.id);
  }
  return [...new Set(out)];
}

/** First line (1-based) whose text contains `snippet`. */
function lineContaining(text: string, snippet: string): number | undefined {
  const s = snippet.trim();
  if (!s) return undefined;
  const i = text.split(/\r?\n/).findIndex((l) => l.includes(s));
  return i >= 0 ? i + 1 : undefined;
}

export function locateIssue(
  issue: Issue,
  doc: CanonicalDocument | undefined,
  sourceText: string,
): IssueLocation {
  const loc: IssueLocation = { nodes: [], edges: [] };
  const src = issue.source ?? "";
  const line = /^line (\d+)/i.exec(src);
  if (line) loc.line = Number(line[1]);
  if (issue.code === "text.unrecognised" || issue.code === "text.self_loop") {
    const snippet =
      /could not read: "(.*)"$/.exec(issue.message)?.[1] ?? quoted(issue.message)[0] ?? "";
    const n = lineContaining(sourceText, snippet);
    if (n) loc.line = n;
  }

  if (doc) {
    const path = /^\/diagram\/(nodes|edges)\/(\d+)/.exec(src);
    if (path) {
      const list = path[1] === "nodes" ? doc.diagram.nodes : doc.diagram.edges;
      const item = list[Number(path[2])];
      if (item) (path[1] === "nodes" ? loc.nodes : loc.edges).push(item.id);
    } else if (src && !line) {
      // draw.io cell ids are kept when they are valid ids
      if (doc.diagram.nodes.some((n) => n.id === src)) loc.nodes.push(src);
      else if (doc.diagram.edges.some((e) => e.id === src)) loc.edges.push(src);
    }
    const names = quoted(issue.message);
    switch (issue.code) {
      case "synth.unreached":
      case "synth.no_traffic":
      case "synth.route_default":
      case "synth.no_rule_matched":
      case "synth.unknown_node":
        loc.nodes.push(...nodeByLabel(doc, names[0] ?? ""));
        break;
      case "info.routes_not_taken":
        for (const n of names) loc.nodes.push(...nodeByLabel(doc, n));
        break;
      case "synth.probe_retries_ignored":
        loc.edges.push(...edgesByPairs(doc, names));
        break;
      case "text.monitoring_inferred":
      case "mermaid.monitoring_inferred": {
        const list = issue.message
          .slice(issue.message.indexOf(": ") + 2)
          .replace(/\. Write .*$/, "");
        loc.edges.push(...edgesByPairs(doc, list.split(/;\s*/)));
        break;
      }
      case "info.monitoring_labels_merged":
        loc.edges.push(
          ...doc.diagram.edges.filter((e) => edgeInteraction(e) === "monitoring").map((e) => e.id),
        );
        break;
    }
    loc.nodes = [...new Set(loc.nodes)];
    loc.edges = [...new Set(loc.edges)];
  }
  if (!loc.nodes.length && !loc.edges.length)
    loc.reason = !doc
      ? "No animation yet: fix the source first."
      : /^(synth\.unreached|synth\.no_traffic|synth\.route_default|synth\.no_rule_matched|info\.routes_not_taken)$/.test(
            issue.code,
          )
        ? "The component name is not unique in this diagram, so it is not highlighted."
        : "This message is about the whole diagram, not one component.";
  return loc;
}
