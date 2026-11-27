/**
 * AnimatedDiagrams document, format version 3 (the engine's input).
 * Field names mirror upstream `src/Io/JsonCodec.cpp` at the pinned revision.
 * This is the *engine* format, not the ArchFlow canonical model.
 */
export const ENGINE_DOCUMENT_VERSION = 3 as const;

export interface EngineEdgeStyle {
  strokeStyle?: string;
  arrowEnd?: string;
  arrowStart?: string;
  routing?: string;
}

export interface EngineNode {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  subtitle?: string;
  /** Only set when the title must be smaller than the engine's default 15 px to fit the box. */
  style?: { fontSize: number };
}

export interface EngineEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  curve?: number;
  waypoints?: { x: number; y: number }[];
  style: EngineEdgeStyle;
}

export type EngineStep =
  | {
      id: string;
      type: "message";
      start: number;
      duration: number;
      from: string;
      to: string;
      edgeId?: string;
      variant: string;
      label: string;
      packet?: string;
      packetCount?: number;
    }
  | {
      id: string;
      type: "state";
      start: number;
      duration: number;
      nodeId: string;
      state: string;
      label?: string;
    }
  | {
      id: string;
      type: "timer";
      start: number;
      duration: number;
      nodeId: string;
      seconds: number;
      unit: "s";
      label: string;
    }
  | {
      id: string;
      type: "note";
      start: number;
      duration: number;
      text: string;
      x: number;
      y: number;
    };

export interface EngineDocument {
  version: typeof ENGINE_DOCUMENT_VERSION;
  meta: { name: string; description?: string; createdAt: 0 };
  view: { zoom: 1; panX: 0; panY: 0 };
  scene?: { background: string };
  nodes: EngineNode[];
  edges: EngineEdge[];
  scenario: { duration: number; userDuration: true; steps: EngineStep[] };
}
