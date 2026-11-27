import { describe, expect, it } from "vitest";
import type { CanonicalDocument, PacketEvent } from "@archflow/canonical-model";
import { MESSAGE_GAP_MS, MESSAGE_MS, importMermaid, type ImportResult } from "../src/index.ts";

function ok(r: ImportResult): CanonicalDocument {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.document;
}
const codes = (r: ImportResult): string[] =>
  (r.ok ? r.warnings : [...r.errors, ...r.warnings]).map((i) => i.code);
const fc = (body: string, dir = "LR"): string => `flowchart ${dir}\n${body}\n`;
const edges = (d: CanonicalDocument) =>
  d.diagram.edges.map((e) => [e.from, e.to, e.label ?? "", e.direction, e.stroke]);

describe("mermaid flowchart: links", () => {
  it.each([
    ["A --> B", "forward", "solid", "triangle"],
    ["A --- B", "none", "solid", "none"],
    ["A -.-> B", "forward", "dashed", "triangle"],
    ["A -.- B", "none", "dashed", "none"],
    ["A ==> B", "forward", "solid", "triangle"],
    ["A <--> B", "both", "solid", "triangle"],
    ["A <-.-> B", "both", "dashed", "triangle"],
    ["A o--o B", "both", "solid", "circle"],
    ["A --o B", "forward", "solid", "circle"],
    ["A x--x B", "both", "solid", "triangle"],
    ["A ----> B", "forward", "solid", "triangle"],
    ["A-->B", "forward", "solid", "triangle"],
  ])("%s -> %s / %s / %s", (src, direction, stroke, head) => {
    const d = ok(importMermaid(fc(src)));
    expect(d.diagram.edges).toHaveLength(1);
    expect(d.diagram.edges[0]).toMatchObject({
      from: "A",
      to: "B",
      direction,
      stroke,
      arrowHead: head,
    });
  });

  it.each([
    ["A -->|call| B", "call"],
    ['A -->|"a | b"| B', "a | b"],
    ["A -- call --> B", "call"],
    ["A == call ==> B", "call"],
    ["A -. call .-> B", "call"],
    ["A -- call --- B", "call"],
  ])("label form %s", (src, label) => {
    expect(ok(importMermaid(fc(src))).diagram.edges[0]!.label).toBe(label);
  });

  it("expands chains and & fan-out", () => {
    const d = ok(importMermaid(fc("A & B --> C --> D & E")));
    expect(edges(d).map((e) => `${e[0]}>${e[1]}`)).toEqual(["A>C", "B>C", "C>D", "C>E"]);
  });

  it("keeps multiple links between the same pair", () => {
    const d = ok(importMermaid(fc("A -->|x| B\nA -.->|y| B\nB --> A")));
    expect(edges(d)).toEqual([
      ["A", "B", "x", "forward", "solid"],
      ["A", "B", "y", "forward", "dashed"],
      ["B", "A", "", "forward", "solid"],
    ]);
  });

  it("drops invisible links, self-loops and links to subgraphs, with warnings", () => {
    const r = importMermaid(fc("A ~~~ B\nA --> A\nsubgraph S\nC\nend\nA --> S"));
    expect(ok(r).diagram.edges).toEqual([]);
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        "mermaid.invisible_link",
        "mermaid.self_loop",
        "mermaid.edge_to_group",
      ]),
    );
    expect(
      ok(r)
        .diagram.nodes.map((n) => n.label)
        .sort(),
    ).toEqual(["A", "B", "C"]);
  });

  it("supports edge ids (`e1@-->`) without using them as canonical ids", () => {
    expect(edges(ok(importMermaid(fc("A e1@--> B"))))).toEqual([
      ["A", "B", "", "forward", "solid"],
    ]);
  });
});

describe("mermaid flowchart: nodes and labels", () => {
  it.each([
    ["A[Rect]", "Rect", "service"],
    ["A(Round)", "Round", "service"],
    ["A([Stadium])", "Stadium", "service"],
    ["A[[Sub]]", "Sub", "service"],
    ["A[(Database)]", "Database", "db"],
    ["A((Circle))", "Circle", "service"],
    ["A(((Double)))", "Double", "service"],
    ["A{Decide}", "Decide", "decision"],
    ["A{{Hex}}", "Hex", "service"],
    ["A[/Para/]", "Para", "service"],
    ["A[/Trap\\]", "Trap", "service"],
    ["A>Flag]", "Flag", "service"],
    ['A@{ shape: cyl, label: "Store" }', "Store", "db"],
    ['A@{ shape: diam, label: "Q?" }', "Q?", "decision"],
  ])("%s -> %s (%s)", (src, label, kind) => {
    const n = ok(importMermaid(fc(src))).diagram.nodes[0]!;
    expect([n.label, n.kind]).toEqual([label, kind]);
  });

  it("decodes quotes, entity codes, <br> and markdown strings", () => {
    const d = ok(
      importMermaid(
        fc(
          'A["say #quot;hi#quot; #35;1"]\nB["line<br/>two"]\nC["`**Bold** text`"]\nD["caf&eacute;"]',
        ),
      ),
    );
    expect(d.diagram.nodes.map((n) => n.label)).toEqual([
      'say "hi" #1',
      "line two",
      "Bold text",
      "caf&eacute;",
    ]);
  });

  it("later explicit labels win; bare references do not erase labels", () => {
    const d = ok(importMermaid(fc("A --> B\nA[Alpha]\nA --> C")));
    expect(d.diagram.nodes.find((n) => n.id === "A")!.label).toBe("Alpha");
  });

  it("rewrites non-ASCII ids but keeps labels", () => {
    const r = importMermaid(fc("Größe --> Ünit"));
    const d = ok(r);
    expect(d.diagram.nodes.map((n) => n.label)).toEqual(["Größe", "Ünit"]);
    for (const n of d.diagram.nodes) expect(n.id).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(codes(r)).toContain("import.ids_rewritten");
  });
});

describe("mermaid flowchart: subgraphs and layout", () => {
  it.each([
    ["subgraph s1 [Title one]", "s1", "Title one"],
    ['subgraph s1["Title one"]', "s1", "Title one"],
    ['subgraph "Title one"', "Title_one", "Title one"],
    ["subgraph Title one", "Title_one", "Title one"],
    ["subgraph s1", "s1", "s1"],
  ])("%s", (head, id, label) => {
    const d = ok(importMermaid(fc(`${head}\nA\nend`)));
    expect(d.diagram.groups[0]).toMatchObject({ id, label });
    expect(d.diagram.nodes[0]!.groupId).toBe(id);
  });

  it("nests subgraphs and lets a node join the first subgraph that lists it", () => {
    const d = ok(
      importMermaid(fc("A --> B\nsubgraph outer\n  subgraph inner\n    B\n  end\n  A\nend")),
    );
    expect(d.diagram.groups.map((g) => [g.id, g.parentId])).toEqual([
      ["outer", undefined],
      ["inner", "outer"],
    ]);
    expect(Object.fromEntries(d.diagram.nodes.map((n) => [n.id, n.groupId]))).toEqual({
      A: "outer",
      B: "inner",
    });
  });

  it("lays out without overlaps, with every node inside its group frame (validator finds nothing)", () => {
    const r = importMermaid(
      fc(
        "subgraph g1[Front]\nA --> B\nsubgraph g2[Back]\nC --> D\nend\nend\nB --> C\nD --> E[Outside]\nA --> E",
        "TB",
      ),
    );
    ok(r);
    expect(codes(r).filter((c) => c.startsWith("validation.geometry"))).toEqual([]);
  });

  it("is deterministic and respects the direction", () => {
    const src = (dir: string) => fc("A --> B --> C --> D", dir);
    const lr = ok(importMermaid(src("LR")));
    expect(ok(importMermaid(src("LR")))).toEqual(lr);
    const tb = ok(importMermaid(src("TB")));
    const spread = (d: CanonicalDocument, k: "x" | "y") =>
      Math.max(...d.diagram.nodes.map((n) => n[k])) - Math.min(...d.diagram.nodes.map((n) => n[k]));
    expect(spread(lr, "x")).toBeGreaterThan(spread(lr, "y"));
    expect(spread(tb, "y")).toBeGreaterThan(spread(tb, "x"));
  });

  it("ignores styling statements with a warning and never follows click URLs", () => {
    const r = importMermaid(
      fc(
        'A --> B\nclassDef x fill:#f00\nclass A x\nstyle B fill:#0f0\nlinkStyle 0 stroke:red\nclick A "https://example.com" _blank\nA:::x',
      ),
    );
    expect(ok(r).diagram.nodes).toHaveLength(2);
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        "mermaid.ignored_classdef",
        "mermaid.ignored_click",
        "mermaid.ignored_style",
      ]),
    );
  });

  it("handles frontmatter title, init directives, comments and semicolons", () => {
    const d = ok(
      importMermaid(
        '---\ntitle: My system\n---\n%%{init: {"theme":"dark"}}%%\ngraph TD;\n%% comment\nA-->B;B-->C;',
      ),
    );
    expect(d.diagram.name).toBe("My system");
    expect(d.diagram.edges).toHaveLength(2);
  });

  it("warns about unreadable statements and keeps the rest", () => {
    const r = importMermaid(fc("A --> B\nthis is ??? not mermaid\nB --> C"));
    expect(ok(r).diagram.edges).toHaveLength(2);
    expect(codes(r)).toContain("mermaid.unrecognised_statement");
  });
});

describe("mermaid sequence diagrams", () => {
  const seq = (body: string) => importMermaid(`sequenceDiagram\n${body}\n`);
  const packets = (d: CanonicalDocument): PacketEvent[] =>
    (d.scenario?.events ?? []).filter((e): e is PacketEvent => e.type === "packet");

  it("maps participants, aliases, actors and messages", () => {
    const d = ok(seq("actor U as User\nparticipant S as Server\nU->>S: hello\nS-->>U: hi"));
    expect(d.diagram.nodes.map((n) => [n.id, n.label, n.kind])).toEqual([
      ["U", "User", "user"],
      ["S", "Server", "service"],
    ]);
    expect(d.diagram.edges).toEqual([
      expect.objectContaining({ from: "U", to: "S", direction: "forward" }),
    ]);
    const p = packets(d);
    expect(p.map((x) => [x.from, x.to, x.variant, x.label, x.respondsTo])).toEqual([
      ["U", "S", "request", "hello", undefined],
      ["S", "U", "response", "hi", p[0]!.id],
    ]);
    expect(p[0]!.t).toBe(300);
    expect(p[1]!.t).toBe(300 + MESSAGE_MS + MESSAGE_GAP_MS);
    expect(d.scenario!.diagramId).toBe(d.diagram.id);
  });

  it.each([
    ["A->>B: x", "request"],
    ["A->B: x", "request"],
    ["A-)B: x", "event"],
    ["A-xB: x", "error"],
    ["A--xB: x", "error"],
    ["A-->>B: x", "success"],
  ])("%s -> %s", (line, variant) => {
    expect(packets(ok(seq(line)))[0]!.variant).toBe(variant);
  });

  it("pairs replies with the latest unanswered request in the opposite direction", () => {
    const d = ok(seq("A->>B: r1\nA->>B: r2\nB-->>A: a2\nB-->>A: a1"));
    const p = packets(d);
    expect(p.map((x) => x.respondsTo)).toEqual([undefined, undefined, "m2", "m1"]);
  });

  it("makes the connector bidirectional only when requests flow both ways", () => {
    const d = ok(seq("A->>B: a\nB->>A: b"));
    expect(d.diagram.edges[0]!.direction).toBe("both");
  });

  it("starts par branches at the same instant and continues after the longest", () => {
    const d = ok(
      seq("A->>B: before\npar\nA->>B: p1\nA->>B: p1b\nand\nA->>C: p2\nend\nA->>B: after"),
    );
    const t = Object.fromEntries(packets(d).map((x) => [x.label, x.t]));
    expect(t["p1"]).toBe(t["p2"]);
    expect(t["after"]).toBe(t["p1b"]! + MESSAGE_MS + MESSAGE_GAP_MS);
  });

  it("turns activations into active states and boxes into groups", () => {
    const d = ok(
      seq(
        "box Blue Backend\nparticipant S\nend\nA->>+S: go\nS-->>-A: done\nactivate A\nA->>S: more\ndeactivate A",
      ),
    );
    const states = d.scenario!.events.filter((e) => e.type === "node_state");
    expect(states.map((s) => (s.type === "node_state" ? [s.nodeId, s.state] : []))).toEqual([
      ["S", "active"],
      ["A", "active"],
    ]);
    expect(d.diagram.groups).toEqual([expect.objectContaining({ label: "Backend" })]);
    expect(d.diagram.nodes.find((n) => n.id === "S")!.groupId).toBe(d.diagram.groups[0]!.id);
  });

  it("keeps notes as timed annotations and flattens loops with a warning", () => {
    const r = seq("A->>B: x\nNote over A,B: hello\nloop retry\nA->>B: y\nend");
    const d = ok(r);
    expect(d.scenario!.events.some((e) => e.type === "note" && e.text === "hello")).toBe(true);
    expect(codes(r)).toContain("mermaid.block_flattened");
  });

  it("drops self-messages with a warning", () => {
    const r = seq("A->>B: x\nA->>A: think");
    expect(packets(ok(r))).toHaveLength(1);
    expect(codes(r)).toContain("mermaid.self_message");
  });

  it("output always passes the canonical validator (incl. response ordering)", () => {
    const r = seq("A->>B: 1\npar\nB-->>A: early?\nand\nB->>C: 2\nend\nC-->>B: 3");
    expect(r.ok).toBe(true);
  });
});

describe("mermaid: rejected input", () => {
  it.each([
    ["", "mermaid.empty"],
    ['pie title Pets\n"Dogs" : 3', "mermaid.unsupported_diagram"],
    ["classDiagram\nA <|-- B", "mermaid.unsupported_diagram"],
    ["hello world", "mermaid.unsupported_diagram"],
    ["flowchart LR\n", "mermaid.no_nodes"],
    ["sequenceDiagram\n", "mermaid.no_participants"],
  ])("%j -> %s", (src, code) => {
    const r = importMermaid(src);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(code);
  });
});
