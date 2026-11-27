export * from "./common.ts";
export { importDrawio, inflatePage, parseStyle, type DrawioOptions } from "./drawio.ts";
export { parseXml, type XmlElement } from "./xml.ts";
export { importMermaid } from "./mermaid.ts";
export { importPlantUml } from "./plantuml.ts";
export { MESSAGE_MS, MESSAGE_GAP_MS } from "./mermaid-sequence.ts";
export { layoutGraph, nodeWidth, type RankDir } from "./layout.ts";

import { importDrawio } from "./drawio.ts";
import { importMermaid } from "./mermaid.ts";
import { importPlantUml } from "./plantuml.ts";
import type { ImportOptions, ImportResult } from "./common.ts";

export type SourceFormat = "drawio" | "mermaid" | "plantuml";

/** Guess the format from a file name or, failing that, the content. */
export function detectFormat(text: string, fileName?: string): SourceFormat | undefined {
  const ext = fileName?.toLowerCase().split(".").pop();
  if (ext === "drawio" || ext === "xml" || ext === "dio" || ext === "svg") return "drawio";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (ext === "puml" || ext === "plantuml" || ext === "pu" || ext === "iuml") return "plantuml";
  const t = text.trimStart();
  if (/^@startuml\b/i.test(t)) return "plantuml";
  if (t.startsWith("<")) return "drawio";
  if (/^(---|%%|flowchart|graph|sequenceDiagram)/.test(t)) return "mermaid";
  return undefined;
}

/** Single entry point for UI and CLI. */
export async function importDiagram(
  text: string,
  format: SourceFormat,
  options: ImportOptions & { page?: number } = {},
): Promise<ImportResult> {
  if (format === "drawio") return importDrawio(text, options);
  if (format === "plantuml") return importPlantUml(text, options);
  return importMermaid(text, options);
}
