import { Graph, layout } from "@dagrejs/dagre";
import { estimateTextWidth } from "./common.ts";
import { titleWidth } from "@archflow/canonical-model";

/**
 * Deterministic layered layout for sources without geometry (Mermaid flowcharts), using dagre
 * (MIT), the same family of algorithm Mermaid itself uses. Inputs are inserted in document order
 * and outputs rounded to integers, so identical input gives identical coordinates in Node and in
 * every browser (no font measurement is involved).
 */

export type RankDir = "TB" | "BT" | "LR" | "RL";

export interface LayoutNode {
  id: string;
  label: string;
  /** Canonical node kind: decides the engine shape and therefore how much room the title needs. */
  kind?: string;
  group?: string;
}
export interface LayoutGroup {
  id: string;
  label: string;
  parent?: string;
}
export interface LayoutEdge {
  from: string;
  to: string;
  label?: string;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NODE_H = 60;
const GROUP_TITLE_BAND = 28;
const GROUP_PAD = 16;
const MARGIN = 20;

/** Width that fits the bold title the engine draws (inverse of titleRoom). */
export function nodeWidth(label: string, kind?: string): number {
  const t = titleWidth(label);
  let w: number;
  if (kind === "user") w = t / 0.8 + 28;
  else if (kind === "decision") w = t * 1.7 + 28;
  else if (kind === "cloud") w = t * 1.3 + 44;
  else w = t + 56;
  return Math.round(Math.min(360, Math.max(120, Math.ceil(w))));
}

export function layoutGraph(
  nodes: LayoutNode[],
  groups: LayoutGroup[],
  edges: LayoutEdge[],
  rankdir: RankDir,
): { nodes: Map<string, Rect>; groups: Map<string, Rect> } {
  const g = new Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir, nodesep: 50, ranksep: 70, edgesep: 20, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  // groups first so they exist as compound parents
  for (const gr of groups) g.setNode(`g:${gr.id}`, { label: gr.label, width: 1, height: 1 });
  for (const gr of groups) if (gr.parent !== undefined) g.setParent(`g:${gr.id}`, `g:${gr.parent}`);
  for (const n of nodes) {
    g.setNode(`n:${n.id}`, { label: n.label, width: nodeWidth(n.label, n.kind), height: NODE_H });
    if (n.group !== undefined) g.setParent(`n:${n.id}`, `g:${n.group}`);
  }
  edges.forEach((e, i) => {
    const labelW = e.label ? Math.round(estimateTextWidth(e.label)) + 10 : 0;
    g.setEdge(
      `n:${e.from}`,
      `n:${e.to}`,
      e.label ? { width: labelW, height: 18, labelpos: "c" } : {},
      `e${i}`,
    );
  });
  layout(g);

  const out = new Map<string, Rect>();
  for (const n of nodes) {
    const l = g.node(`n:${n.id}`) as { x: number; y: number; width: number; height: number };
    out.set(n.id, {
      x: Math.round(l.x - l.width / 2),
      y: Math.round(l.y - l.height / 2),
      w: Math.round(l.width),
      h: Math.round(l.height),
    });
  }

  // Group frames: union of members and child frames, padded, plus a title band; innermost first
  // so every parent strictly contains its children.
  const depth = (id: string): number => {
    let d = 0;
    for (let cur = groups.find((x) => x.id === id); cur?.parent !== undefined; d++)
      cur = groups.find((x) => x.id === cur!.parent);
    return d;
  };
  const frames = new Map<string, Rect>();
  const ordered = [...groups].sort((a, b) => depth(b.id) - depth(a.id));
  for (const gr of ordered) {
    const parts: Rect[] = [
      ...nodes.filter((n) => n.group === gr.id).map((n) => out.get(n.id)!),
      ...groups.filter((c) => c.parent === gr.id).map((c) => frames.get(c.id)!),
    ];
    if (parts.length === 0) {
      const l = g.node(`g:${gr.id}`) as { x: number; y: number };
      frames.set(gr.id, { x: Math.round(l.x - 60), y: Math.round(l.y - 30), w: 120, h: 60 });
      continue;
    }
    const x0 = Math.min(...parts.map((p) => p.x)) - GROUP_PAD;
    const y0 = Math.min(...parts.map((p) => p.y)) - GROUP_PAD - GROUP_TITLE_BAND;
    const x1 = Math.max(...parts.map((p) => p.x + p.w)) + GROUP_PAD;
    const y1 = Math.max(...parts.map((p) => p.y + p.h)) + GROUP_PAD;
    frames.set(gr.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  // Shift everything so the top-left content starts at the margin.
  const all = [...out.values(), ...frames.values()];
  const dx = all.length ? MARGIN - Math.min(...all.map((r) => r.x)) : 0;
  const dy = all.length ? MARGIN - Math.min(...all.map((r) => r.y)) : 0;
  for (const r of all) {
    r.x += dx;
    r.y += dy;
  }
  return { nodes: out, groups: frames };
}
