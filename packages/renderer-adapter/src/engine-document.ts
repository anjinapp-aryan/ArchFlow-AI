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
  color?: string;
  width?: number;
  labelColor?: string;
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
  /** Connection points (offsets from the node's top-left), referenced by edges. */
  ports?: { id: string; dx: number; dy: number }[];
}

export interface EngineEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  curve?: number;
  waypoints?: { x: number; y: number }[];
  fromPort?: string;
  toPort?: string;
  /** Label anchor: fraction of the path length, perpendicular offset ("up" > 0), size (px). */
  labelPos?: number;
  labelOff?: number;
  labelSize?: number;
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
      packetSize?: number;
      color?: string;
      trail?: boolean;
    }
  | {
      /** Edge animation (e.g. running dashes along an asynchronous connector). */
      id: string;
      type: "link";
      start: number;
      duration: number;
      edgeId: string;
      anim: "flow" | "dash" | "solid" | "pulse";
      color: string;
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
    }
  | {
      /** Node effect (opacity/scale/glow keyframes), built-in or from the document library. */
      id: string;
      type: "effect";
      start: number;
      duration: number;
      nodeId: string;
      effect: string;
      intensity?: number;
    };

export interface EngineDocument {
  version: typeof ENGINE_DOCUMENT_VERSION;
  meta: { name: string; description?: string; createdAt: 0 };
  view: { zoom: 1; panX: 0; panY: 0 };
  scene?: { background: string; edgeColor?: string; textColor?: string };
  /** Engine design system (built-in id) the engine resolves node, state and packet colours from. */
  designSystem?: string;
  /** Document library: ArchFlow's own design systems and effects (never the engine's ids). */
  library?: { designSystems?: Record<string, unknown>[]; effects?: Record<string, unknown>[] };
  nodes: EngineNode[];
  edges: EngineEdge[];
  scenario: { duration: number; userDuration: true; steps: EngineStep[] };
}
