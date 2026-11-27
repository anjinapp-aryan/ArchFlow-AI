import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, WARNING_CODES, validateCanonical } from "../src/index.ts";

type Rec = Record<string, unknown>;
interface Doc {
  schema: string;
  diagram: { id: string; name: string; nodes: Rec[]; edges: Rec[]; groups?: Rec[] };
  scenario: { id: string; diagramId?: string; durationMs: number; flows: Rec[]; events: Rec[] };
}

/** Small, fully valid document every mutation below starts from. */
function base(): Doc {
  const node = (id: string, x: number): Rec => ({ id, label: id, x, y: 0, w: 100, h: 50 });
  const pk = (
    id: string,
    from: string,
    to: string,
    variant: string,
    t: number,
    x: Rec = {},
  ): Rec => ({
    type: "packet",
    id,
    t,
    durationMs: 500,
    flowId: "f1",
    from,
    to,
    variant,
    ...x,
  });
  return {
    schema: "archflow/canonical@1",
    diagram: {
      id: "d",
      name: "d",
      nodes: [node("a", 0), node("b", 200), node("c", 400), node("d", 600)],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "bc", from: "b", to: "c" },
        { id: "bd", from: "b", to: "d" },
      ],
    },
    scenario: {
      id: "s",
      durationMs: 10000,
      flows: [{ id: "f1" }, { id: "f2" }],
      events: [
        pk("q1", "a", "b", "request", 1000),
        pk("r1", "b", "a", "response", 2000, { respondsTo: "q1" }),
        pk("e1", "b", "c", "error", 3000),
        pk("y1", "b", "c", "retry", 4000, { attempt: 2, retryOf: "e1" }),
        {
          type: "node_state",
          id: "st1",
          t: 3000,
          durationMs: 1000,
          flowId: "f1",
          nodeId: "c",
          state: "down",
        },
        {
          type: "node_state",
          id: "st2",
          t: 5000,
          durationMs: 500,
          flowId: "f1",
          nodeId: "c",
          state: "ok",
          recovers: "st1",
        },
      ],
    },
  };
}

const ev = (d: Doc, id: string): Rec => {
  const e = d.scenario.events.find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id}`);
  return e;
};
const add = (d: Doc, e: Rec): void => void d.scenario.events.push(e);
const packet = (
  id: string,
  from: string,
  to: string,
  variant: string,
  t: number,
  x: Rec = {},
): Rec => ({
  type: "packet",
  id,
  t,
  durationMs: 500,
  flowId: "f1",
  from,
  to,
  variant,
  ...x,
});
const timeout = (id: string, nodeId: string, t: number, durationMs: number, x: Rec = {}): Rec => ({
  type: "timeout",
  id,
  t,
  durationMs,
  flowId: "f1",
  nodeId,
  ...x,
});

describe("semantic validation: baseline", () => {
  it("the baseline document is valid", () => {
    const r = validateCanonical(base());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("order-flow and linear-3 fixtures are valid; only the documented warning appears", () => {
    for (const f of ["order-flow", "linear-3"]) {
      const raw = JSON.parse(
        readFileSync(
          new URL(`../../../fixtures/scenarios/${f}.canonical.json`, import.meta.url),
          "utf8",
        ),
      ) as unknown;
      const r = validateCanonical(raw);
      expect(r.errors).toEqual([]);
      for (const w of r.warnings) expect(w.code).toBe("state.down_node_used");
    }
  });

  it("accepts a timeout followed by a retry and a fallback (positive)", () => {
    const d = base();
    add(d, packet("q2", "b", "c", "request", 6000));
    add(d, timeout("to2", "b", 6000, 1000, { waitingFor: "q2" }));
    add(d, packet("q2r", "b", "c", "retry", 7000, { attempt: 2, retryOf: "q2" }));
    add(d, packet("q2f", "b", "d", "request", 7000, { fallbackOf: "q2" }));
    const r = validateCanonical(d);
    expect(r.errors).toEqual([]);
  });

  it("accepts parallel flows that overlap in time", () => {
    const d = base();
    add(d, packet("p1", "b", "c", "event", 6000, { flowId: "f2" }));
    add(d, packet("p2", "b", "d", "event", 6000, { flowId: "f1" }));
    expect(validateCanonical(d).errors).toEqual([]);
  });
});

/** One mutation per error code. The meta-test below forces coverage of the whole catalog. */
const NEGATIVE: Record<string, (d: Doc) => void> = {
  "edge.self_loop": (d) => void d.diagram.edges.push({ id: "x", from: "a", to: "a" }),
  "event.beyond_scenario": (d) => void (ev(d, "q1").t = 9800),
  "event.invalid_duration": (d) => void (ev(d, "q1").durationMs = 0.5),
  "fallback.before_failure": (d) =>
    add(d, packet("fb", "b", "d", "request", 3200, { fallbackOf: "e1" })),
  "fallback.same_destination": (d) =>
    add(d, packet("fb", "b", "c", "request", 4000, { fallbackOf: "e1" })),
  "fallback.self_reference": (d) =>
    add(d, packet("fb", "b", "d", "request", 4000, { fallbackOf: "fb" })),
  "fallback.source_mismatch": (d) =>
    add(d, packet("fb", "d", "b", "success", 4000, { fallbackOf: "e1" })),
  "fallback.target_not_failed": (d) =>
    add(d, packet("fb", "b", "d", "request", 4000, { fallbackOf: "q1" })),
  "fallback.target_not_packet": (d) =>
    add(d, packet("fb", "b", "d", "request", 4000, { fallbackOf: "st1" })),
  "fallback.unknown_target": (d) =>
    add(d, packet("fb", "b", "d", "request", 4000, { fallbackOf: "zzz" })),
  "flow.cycle": (d) => {
    d.scenario.flows = [
      { id: "f1", parentFlowId: "f2" },
      { id: "f2", parentFlowId: "f1" },
    ];
  },
  "flow.mismatch": (d) => void (ev(d, "r1").flowId = "f2"),
  "flow.starts_before_parent": (d) => {
    d.scenario.flows = [{ id: "f1" }, { id: "f2", parentFlowId: "f1" }];
    add(d, {
      type: "note",
      id: "n1",
      t: 500,
      durationMs: 100,
      flowId: "f2",
      text: "x",
      x: 0,
      y: 0,
    });
  },
  "group.cycle": (d) => {
    d.diagram.groups = [
      { id: "g1", label: "1", parentId: "g2" },
      { id: "g2", label: "2", parentId: "g1" },
    ];
  },
  "packet.against_direction": (d) => add(d, packet("p", "b", "a", "request", 6000)),
  "packet.ambiguous_connector": (d) => void d.diagram.edges.push({ id: "ab2", from: "a", to: "b" }),
  "packet.edge_mismatch": (d) => void (ev(d, "q1").edgeId = "bc"),
  "packet.no_connector": (d) => void (ev(d, "q1").to = "c"),
  "packet.same_endpoints": (d) => void (ev(d, "q1").to = "a"),
  "packet.traffic_on_monitoring": (d) =>
    void ((d.diagram.edges[0] as Rec).interaction = "monitoring"),
  "recover.bad_state": (d) => void (ev(d, "st2").state = "busy"),
  "recover.before_failure_end": (d) => void (ev(d, "st2").t = 3500),
  "recover.node_mismatch": (d) => void (ev(d, "st2").nodeId = "b"),
  "recover.target_not_failure": (d) => void (ev(d, "st1").state = "active"),
  "recover.target_not_state": (d) => void (ev(d, "st2").recovers = "q1"),
  "recover.unknown_target": (d) => void (ev(d, "st2").recovers = "zzz"),
  "ref.diagram_mismatch": (d) => void (d.scenario.diagramId = "other"),
  "ref.duplicate_id": (d) => void d.diagram.nodes.push({ ...d.diagram.nodes[0] }),
  "ref.unknown_edge": (d) => void (ev(d, "q1").edgeId = "nope"),
  "ref.unknown_flow": (d) => void (ev(d, "q1").flowId = "nope"),
  "ref.unknown_group": (d) => void (d.diagram.nodes[0]!.groupId = "nope"),
  "ref.unknown_node": (d) => void (ev(d, "q1").from = "zz"),
  "response.before_request": (d) => void (ev(d, "r1").t = 1200),
  "response.duplicate": (d) =>
    add(d, packet("r2", "b", "a", "success", 3000, { respondsTo: "q1" })),
  "response.endpoints_not_reversed": (d) => {
    ev(d, "r1").from = "b";
    ev(d, "r1").to = "c";
  },
  "response.missing_responds_to": (d) => void delete ev(d, "r1").respondsTo,
  "response.self_reference": (d) => void (ev(d, "r1").respondsTo = "r1"),
  "response.target_not_packet": (d) => void (ev(d, "r1").respondsTo = "st1"),
  "response.unknown_target": (d) => void (ev(d, "r1").respondsTo = "zzz"),
  "retry.bad_attempt": (d) => void (ev(d, "y1").attempt = 3),
  "retry.before_failure": (d) => void (ev(d, "y1").t = 3200),
  "retry.duplicate": (d) =>
    add(d, packet("y2", "b", "c", "retry", 6000, { attempt: 2, retryOf: "e1" })),
  "retry.endpoint_mismatch": (d) => void (ev(d, "y1").to = "d"),
  "retry.missing_retry_of": (d) => void delete ev(d, "y1").retryOf,
  "retry.self_reference": (d) => void (ev(d, "y1").retryOf = "y1"),
  "retry.target_not_failed": (d) => void (ev(d, "y1").retryOf = "q1"),
  "retry.target_not_packet": (d) => void (ev(d, "y1").retryOf = "st1"),
  "retry.too_many_attempts": (d) => void (ev(d, "y1").attempt = 11),
  "retry.unexpected_retry_of": (d) => void (ev(d, "y1").variant = "request"),
  "retry.unknown_target": (d) => void (ev(d, "y1").retryOf = "zzz"),
  "state.contradictory_overlap": (d) =>
    add(d, {
      type: "node_state",
      id: "st3",
      t: 3200,
      durationMs: 300,
      nodeId: "c",
      state: "active",
    }),
  "state.disabled_node_used": (d) =>
    add(d, {
      type: "node_state",
      id: "st3",
      t: 3000,
      durationMs: 100,
      nodeId: "c",
      state: "disabled",
    }),
  "timeout.before_packet": (d) => add(d, timeout("to", "a", 500, 5000, { waitingFor: "q1" })),
  "timeout.node_mismatch": (d) => add(d, timeout("to", "b", 1000, 5000, { waitingFor: "q1" })),
  "timeout.response_before_expiry": (d) =>
    add(d, timeout("to", "a", 1000, 3000, { waitingFor: "q1" })),
  "timeout.target_not_packet": (d) => add(d, timeout("to", "a", 1000, 500, { waitingFor: "st1" })),
  "timeout.unknown_packet": (d) => add(d, timeout("to", "a", 1000, 500, { waitingFor: "zzz" })),
};

describe("semantic validation: negative (one test per error code)", () => {
  for (const [code, mutate] of Object.entries(NEGATIVE)) {
    it(`rejects: ${code}`, () => {
      const d = base();
      mutate(d);
      const r = validateCanonical(d);
      expect(r.ok).toBe(false);
      const hit = r.errors.find((e) => e.code === code);
      expect(hit, JSON.stringify(r.errors)).toBeDefined();
      expect(hit?.path.startsWith("/")).toBe(true);
    });
  }

  it("the negative table covers the entire error catalog and nothing else", () => {
    expect(Object.keys(NEGATIVE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("every code used by the rules is in the catalog", () => {
    const src = readFileSync(new URL("../src/rules.ts", import.meta.url), "utf8");
    const used = new Set([...src.matchAll(/"([a-z]+\.[a-z_]+)"/g)].map((m) => m[1]!));
    const known = new Set<string>([...ERROR_CODES, ...WARNING_CODES]);
    expect([...used].filter((c) => !known.has(c))).toEqual([]);
    expect([...known].filter((c) => !used.has(c))).toEqual([]);
  });
});

describe("connector semantics (minor 2)", () => {
  it("probes along a monitoring connector are valid, even to a down target", () => {
    const d = base();
    (d.diagram.edges[2] as Rec).interaction = "monitoring";
    add(d, {
      type: "node_state",
      id: "unhealthy",
      t: 6000,
      durationMs: 2000,
      nodeId: "d",
      state: "down",
      label: "unhealthy",
    });
    add(d, packet("p1", "b", "d", "probe", 6500));
    const r = validateCanonical(d);
    expect(r.errors).toEqual([]);
    // the baseline already warns for c; the probe to the unhealthy d must not add a warning
    expect(r.warnings.filter((w) => w.message.includes('"d" is down'))).toEqual([]);
    expect(r.warnings.map((w) => w.code)).not.toContain("packet.probe_off_monitoring");
  });
});

describe("semantic validation: warnings never block", () => {
  const warns: Record<string, (d: Doc) => void> = {
    "event.unsorted": (d) => void d.scenario.events.reverse(),
    "flow.empty": (d) => void d.scenario.flows.push({ id: "empty" }),
    "geometry.node_outside_group": (d) => {
      d.diagram.groups = [{ id: "g", label: "G", frame: { x: 0, y: 0, w: 50, h: 50 } }];
      d.diagram.nodes[1]!.groupId = "g";
    },
    "geometry.nodes_overlap": (d) => void (d.diagram.nodes[1]!.x = 50),
    "packet.probe_off_monitoring": (d) => add(d, packet("p9", "b", "d", "probe", 6000)),
    "state.down_node_used": () => undefined, // already present in the baseline: e1 -> c while c is down
    "state.redundant_overlap": (d) =>
      add(d, {
        type: "node_state",
        id: "st3",
        t: 3100,
        durationMs: 100,
        nodeId: "c",
        state: "down",
      }),
  };
  for (const [code, mutate] of Object.entries(warns)) {
    it(`warns: ${code}`, () => {
      const d = base();
      mutate(d);
      const r = validateCanonical(d);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.warnings.map((w) => w.code)).toContain(code);
    });
  }
  it("covers the entire warning catalog", () => {
    expect(Object.keys(warns).sort()).toEqual([...WARNING_CODES].sort());
  });
});

describe("semantic validation: direction policy", () => {
  const mk = (): Doc => {
    const d = base();
    add(d, packet("p", "b", "a", "request", 6000));
    return d;
  };
  it("strict (default) errors, warn warns, off is silent", () => {
    expect(validateCanonical(mk()).ok).toBe(false);
    const w = validateCanonical(mk(), { directionPolicy: "warn" });
    expect(w.ok).toBe(true);
    expect(w.warnings.map((x) => x.code)).toContain("packet.against_direction");
    const o = validateCanonical(mk(), { directionPolicy: "off" });
    expect(o.ok).toBe(true);
    expect(o.warnings.map((x) => x.code)).not.toContain("packet.against_direction");
  });
  it("responses, success and errors may travel against the arrow; bidirectional edges allow all", () => {
    const d = base();
    add(d, packet("p", "b", "a", "error", 6000));
    add(d, packet("p2", "b", "a", "success", 7000));
    d.diagram.edges[0]!.direction = "both";
    add(d, packet("p3", "b", "a", "request", 8000));
    expect(validateCanonical(d).errors).toEqual([]);
  });
  it("backward edges: requests must travel to -> from", () => {
    const d = base();
    d.diagram.edges.push({ id: "cd", from: "c", to: "d", direction: "backward" });
    add(d, packet("p", "d", "c", "request", 6000));
    expect(validateCanonical(d).errors).toEqual([]);
    add(d, packet("p2", "c", "d", "request", 7000));
    expect(validateCanonical(d).errors.map((e) => e.code)).toEqual(["packet.against_direction"]);
  });
});

describe("semantic validation: boundaries", () => {
  it("duration 1 ms is valid, 0.999 is not; event may end exactly at scenario end", () => {
    const ok = base();
    ev(ok, "q1").durationMs = 1;
    expect(validateCanonical(ok).errors).toEqual([]);
    const bad = base();
    ev(bad, "q1").durationMs = 0.999;
    expect(validateCanonical(bad).errors.map((e) => e.code)).toContain("event.invalid_duration");
    const edge = base();
    const note: Rec = { type: "note", id: "n9", t: 9500, durationMs: 500, text: "x", x: 0, y: 0 };
    add(edge, note);
    expect(validateCanonical(edge).errors).toEqual([]);
    note.t = 9500.001;
    expect(validateCanonical(edge).errors.map((e) => e.code)).toContain("event.beyond_scenario");
  });

  it("5000 events are valid, 5001 are not", () => {
    const mk = (n: number): Doc => {
      const d = base();
      d.scenario.events = Array.from({ length: n }, (_, i) => ({
        type: "note",
        id: `n${i}`,
        t: 0,
        durationMs: 1,
        text: "x",
        x: 0,
        y: 0,
      }));
      return d;
    };
    expect(validateCanonical(mk(5000)).errors).toEqual([]);
    expect(validateCanonical(mk(5001)).ok).toBe(false);
  });

  it("id length 64 valid, 65 invalid", () => {
    const d = base();
    d.diagram.nodes[0]!.id = "n".repeat(64);
    d.diagram.edges[0]!.from = "n".repeat(64);
    ev(d, "q1").from = "n".repeat(64);
    ev(d, "r1").to = "n".repeat(64);
    expect(validateCanonical(d).errors).toEqual([]);
    d.diagram.nodes[0]!.id = "n".repeat(65);
    expect(validateCanonical(d).ok).toBe(false);
  });

  it("coordinates +-100000 valid, beyond invalid", () => {
    const d = base();
    d.diagram.nodes[0]!.x = 100000;
    d.diagram.nodes[0]!.y = -100000;
    expect(validateCanonical(d).errors).toEqual([]);
    d.diagram.nodes[0]!.x = 100000.5;
    expect(validateCanonical(d).ok).toBe(false);
  });

  it("node size 20 valid, 19.99 invalid", () => {
    const d = base();
    d.diagram.nodes[0]!.w = 20;
    d.diagram.nodes[0]!.h = 20;
    expect(validateCanonical(d).errors).toEqual([]);
    d.diagram.nodes[0]!.h = 19.99;
    expect(validateCanonical(d).ok).toBe(false);
  });

  it("32 waypoints valid, 33 invalid", () => {
    const pts = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
    const d = base();
    d.diagram.edges[0]!.waypoints = pts(32);
    expect(validateCanonical(d).errors).toEqual([]);
    d.diagram.edges[0]!.waypoints = pts(33);
    expect(validateCanonical(d).ok).toBe(false);
  });

  it("label 200 valid, 201 invalid", () => {
    const d = base();
    d.diagram.nodes[0]!.label = "x".repeat(200);
    expect(validateCanonical(d).errors).toEqual([]);
    d.diagram.nodes[0]!.label = "x".repeat(201);
    expect(validateCanonical(d).ok).toBe(false);
  });

  it("retry chain: attempt 10 valid, attempt 11 invalid (default limit); limit is configurable", () => {
    const chain = (retries: number): Doc => {
      const d = base();
      d.scenario.durationMs = 60000;
      d.scenario.events = [packet("c0", "b", "c", "error", 1000)];
      let prev = "c0";
      let t = 2000;
      for (let k = 1; k <= retries; k++) {
        const id = `c${k}`;
        add(d, packet(id, "b", "c", "retry", t, { attempt: k + 1, retryOf: prev }));
        add(d, timeout(`t${k}`, "b", t, 500, { waitingFor: id }));
        prev = id;
        t += 1000;
      }
      return d;
    };
    expect(validateCanonical(chain(9)).errors).toEqual([]);
    expect(validateCanonical(chain(10)).errors.map((e) => e.code)).toEqual([
      "retry.too_many_attempts",
    ]);
    expect(validateCanonical(chain(10), { maxRetryAttempts: 11 }).errors).toEqual([]);
    expect(validateCanonical(chain(2), { maxRetryAttempts: 2 }).errors.map((e) => e.code)).toEqual([
      "retry.too_many_attempts",
    ]);
  });

  it("a retry may start exactly when the failure ends; a response exactly when the request ends", () => {
    const d = base();
    ev(d, "y1").t = 3500;
    ev(d, "r1").t = 1500;
    expect(validateCanonical(d).errors).toEqual([]);
  });
});

describe("semantic validation: regression (engine would silently repair these)", () => {
  it.each([
    [
      "step references unknown node",
      "ref.unknown_node",
      (d: Doc) => void (ev(d, "q1").to = "ghost"),
    ],
    [
      "self-loop edge",
      "edge.self_loop",
      (d: Doc) => void d.diagram.edges.push({ id: "z", from: "a", to: "a" }),
    ],
    ["zero-length step", "event.invalid_duration", (d: Doc) => void (ev(d, "q1").durationMs = 0)],
    ["duplicate event id", "ref.duplicate_id", (d: Doc) => void (ev(d, "r1").id = "q1")],
    [
      "step after scenario end",
      "event.beyond_scenario",
      (d: Doc) => void (d.scenario.durationMs = 1000),
    ],
  ])("%s -> %s", (_n, code, mutate) => {
    const d = base();
    mutate(d);
    expect(validateCanonical(d).errors.map((e) => e.code)).toContain(code);
  });
});

describe("semantic validation: robustness", () => {
  /** mulberry32: tiny seeded PRNG so failures reproduce. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const paths = (v: unknown, p: (string | number)[] = [], out: (string | number)[][] = []) => {
    out.push(p);
    if (typeof v === "object" && v !== null)
      for (const [k, c] of Object.entries(v))
        paths(c, [...p, Array.isArray(v) ? Number(k) : k], out);
    return out;
  };

  it("never throws, and ok === (no errors), on 600 seeded random mutations", () => {
    const rand = rng(12345);
    const junk: unknown[] = [
      null,
      -1,
      0,
      1e9,
      "",
      "x y",
      "zz",
      {},
      [],
      true,
      NaN,
      Infinity,
      0.5,
      "q1",
    ];
    for (let i = 0; i < 600; i++) {
      const d = structuredClone(base()) as unknown as Rec;
      const all = paths(d).filter((p) => p.length > 0);
      for (let m = 0; m < 1 + Math.floor(rand() * 3); m++) {
        const p = all[Math.floor(rand() * all.length)]!;
        let parent = d as Rec | undefined | null;
        for (const k of p.slice(0, -1))
          parent = (parent as Rec | undefined | null)?.[k] as Rec | undefined | null;
        const last = p[p.length - 1]!;
        if (typeof parent !== "object" || parent === null) continue;
        if (rand() < 0.25) delete (parent as Rec)[last];
        else (parent as Rec)[last] = junk[Math.floor(rand() * junk.length)];
      }
      const r = validateCanonical(d);
      expect(r.ok).toBe(r.errors.length === 0);
      for (const e of [...r.errors, ...r.warnings]) {
        expect(typeof e.code).toBe("string");
        expect(typeof e.path).toBe("string");
      }
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const d = base();
    const copy = structuredClone(d);
    ev(d, "q1").to = "ghost";
    ev(copy, "q1").to = "ghost";
    const a = validateCanonical(d);
    const b = validateCanonical(d);
    expect(a).toEqual(b);
    expect(d).toEqual(copy);
  });
});
