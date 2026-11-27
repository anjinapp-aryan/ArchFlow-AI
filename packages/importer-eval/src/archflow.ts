import { readFileSync } from "node:fs";
import type { CanonicalDocument } from "@archflow/canonical-model";
import {
  importDrawio,
  importMermaid,
  importPlantUml,
  type ImportResult,
} from "@archflow/diagram-importers";
import type { ImportOutcome, Imported } from "./score.ts";

/** ArchFlow's own importers (`@archflow/diagram-importers`): canonical document -> scorer view. */
export function canonicalToImported(doc: CanonicalDocument, warnings: string[]): Imported {
  const label = new Map(doc.diagram.nodes.map((n) => [n.id, n.label]));
  const groupLabel = new Map(doc.diagram.groups.map((g) => [g.id, g.label]));
  return {
    nodes: doc.diagram.nodes.map((n) => ({
      label: n.label,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      ...(n.groupId !== undefined ? { group: groupLabel.get(n.groupId)! } : {}),
    })),
    edges: doc.diagram.edges.map((e) => ({
      from: label.get(e.from)!,
      to: label.get(e.to)!,
      ...(e.label !== undefined ? { label: e.label } : {}),
      direction: e.direction,
      stroke: e.stroke === "solid" ? "solid" : "dashed",
      routing: e.routing,
    })),
    groups: doc.diagram.groups.map((g) => ({
      label: g.label,
      ...(g.parentId !== undefined ? { parent: groupLabel.get(g.parentId)! } : {}),
    })),
    messages: (doc.scenario?.events ?? []).flatMap((ev) =>
      ev.type === "packet"
        ? [
            {
              from: label.get(ev.from)!,
              to: label.get(ev.to)!,
              ...(ev.label !== undefined ? { label: ev.label } : {}),
              reply: ev.variant === "response" || ev.variant === "success",
            },
          ]
        : [],
    ),
    warnings,
  };
}

export function toOutcome(r: ImportResult): ImportOutcome {
  if (!r.ok) return { ok: false, error: r.errors.map((e) => `${e.code}: ${e.message}`).join("; ") };
  return {
    ok: true,
    imported: canonicalToImported(
      r.document,
      r.warnings.map((w) => w.code),
    ),
  };
}

export async function runArchflow(
  path: string,
  kind: "drawio" | "mmd" | "puml",
): Promise<ImportOutcome> {
  const text = readFileSync(path, "utf8");
  if (kind === "drawio") return toOutcome(await importDrawio(text));
  if (kind === "puml") return toOutcome(importPlantUml(text));
  return toOutcome(importMermaid(text));
}
