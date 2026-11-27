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
import { parseFlowchart } from "./mermaid-flowchart.ts";
import { parseSequence } from "./mermaid-sequence.ts";
import { preprocess } from "./mermaid-text.ts";

/**
 * Mermaid importer: `flowchart`/`graph` (diagram only) and `sequenceDiagram` (diagram + scenario).
 * Every other Mermaid diagram type is rejected explicitly. Pure string processing (no DOM, no
 * Mermaid runtime), so it behaves identically in Node and in browsers.
 */
export function importMermaid(text: string, options: ImportOptions = {}): ImportResult {
  const issues = new Issues();
  if (!checkInput(text, issues, "mermaid"))
    return { ok: false, errors: issues.errors, warnings: [] };
  const pre = preprocess(text);
  const head = pre.statements[0]?.text ?? "";
  const type = /^[A-Za-z-]+/.exec(head)?.[0] ?? "";
  const name = fitLabel(options.name ?? pre.title ?? "Imported Mermaid diagram", issues, "name");
  const id = new IdMapper("diagram").assign(options.diagramId ?? "mermaid");

  if (/^(flowchart|graph|flowchart-elk)$/i.test(type)) {
    const out = parseFlowchart(pre.statements, issues);
    if (!out) return { ok: false, errors: issues.errors, warnings: issues.warnings };
    if (out.nodes.length === 0) issues.error("mermaid.no_nodes", "the flowchart contains no nodes");
    const doc = emptyDocument(id, name);
    Object.assign(doc.diagram, { nodes: out.nodes, edges: out.edges, groups: out.groups });
    return finish(doc, issues);
  }
  if (type === "sequenceDiagram") {
    const out = parseSequence(pre.statements, issues);
    if (!out) return { ok: false, errors: issues.errors, warnings: issues.warnings };
    const doc = emptyDocument(id, name);
    Object.assign(doc.diagram, { nodes: out.nodes, edges: out.edges, groups: out.groups });
    doc.scenario = { ...out.scenario, diagramId: id };
    return finish(doc, issues);
  }
  issues.error(
    "mermaid.unsupported_diagram",
    type
      ? `Mermaid "${type}" diagrams are not supported (supported: flowchart, graph, sequenceDiagram)`
      : "no Mermaid diagram header found",
  );
  return { ok: false, errors: issues.errors, warnings: issues.warnings };
}
