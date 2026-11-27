import { describe, expect, it } from "vitest";
import type { CanonicalDocument, PacketEvent } from "@archflow/canonical-model";
import { detectFormat, importPlantUml, type ImportResult } from "../src/index.ts";

function ok(r: ImportResult): CanonicalDocument {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.document;
}
const codes = (r: ImportResult): string[] =>
  (r.ok ? r.warnings : [...r.errors, ...r.warnings]).map((i) => i.code);
const uml = (body: string): string => `@startuml\n${body}\n@enduml\n`;
const edges = (d: CanonicalDocument) => {
  const l = new Map(d.diagram.nodes.map((n) => [n.id, n.label]));
  return d.diagram.edges.map(
    (e) => `${l.get(e.from)}>${l.get(e.to)}|${e.label ?? ""}|${e.direction}|${e.stroke}`,
  );
};

describe("PlantUML component diagrams", () => {
  it.each([
    ["[A] --> [B]", "A>B||forward|solid"],
    ["[A] -> [B]", "A>B||forward|solid"],
    ["[A] ..> [B]", "A>B||forward|dashed"],
    ["[A] <-- [B]", "B>A||forward|solid"],
    ["[A] <--> [B]", "A>B||both|solid"],
    ["[A] -- [B]", "A>B||none|solid"],
    ["[A] .. [B]", "A>B||none|dashed"],
    ["[A] -up-> [B]", "A>B||forward|solid"],
    ["[A] -[#red]-> [B] : hot", "A>B|hot|forward|solid"],
    ["[A] --> [B] : a: b", "A>B|a: b|forward|solid"],
  ])("%s", (line, expected) => {
    expect(edges(ok(importPlantUml(uml(line))))).toEqual([expected]);
  });

  it("aliases, element kinds and quoted names", () => {
    const d = ok(
      importPlantUml(
        uml(
          'actor Customer as c\ndatabase "Orders DB" as db\nqueue Events\ncomponent [Web App] as web\ncloud "S3" as s3\nc --> web\nweb --> db\nweb ..> Events\nweb --> s3',
        ),
      ),
    );
    expect(d.diagram.nodes.map((n) => [n.id, n.label, n.kind])).toEqual([
      ["c", "Customer", "user"],
      ["db", "Orders DB", "db"],
      ["Events", "Events", "queue"],
      ["web", "Web App", "service"],
      ["s3", "S3", "cloud"],
    ]);
    expect(d.diagram.edges).toHaveLength(4);
  });

  it("nested packages become nested groups; edges never relabel declared elements", () => {
    const d = ok(
      importPlantUml(
        uml('package "Outer" {\n  node "Inner" {\n    [Svc] as s\n  }\n}\n[Client] as c\nc --> s'),
      ),
    );
    expect(d.diagram.groups.map((g) => [g.label, g.parentId])).toEqual([
      ["Outer", undefined],
      ["Inner", "Outer"],
    ]);
    expect(d.diagram.nodes.find((n) => n.label === "Svc")!.groupId).toBe("Inner");
  });

  it("ignores comments, skinparams, notes and directions with warnings", () => {
    const r = importPlantUml(
      uml(
        "' comment\n/' block\ncomment '/\nskinparam monochrome true\nleft to right direction\n[A] --> [B]\nnote right of A : hi",
      ),
    );
    expect(edges(ok(r))).toEqual(["A>B||forward|solid"]);
    expect(codes(r)).toEqual(
      expect.arrayContaining(["plantuml.ignored_skinparam", "plantuml.note_ignored"]),
    );
  });

  it("flags UML relation heads", () => {
    expect(codes(importPlantUml(uml("[A] --|> [B]")))).toContain("plantuml.uml_relation");
  });
});

describe("PlantUML sequence diagrams", () => {
  const packets = (d: CanonicalDocument): PacketEvent[] =>
    (d.scenario?.events ?? []).filter((e): e is PacketEvent => e.type === "packet");

  it("participants, replies, failed and async messages", () => {
    const d = ok(
      importPlantUml(
        uml(
          'actor User as U\nparticipant "API" as A\nU -> A : call\nA --> U : ok\nU ->x A : lost\nU ->> A : fire',
        ),
      ),
    );
    expect(d.diagram.nodes.map((n) => [n.label, n.kind])).toEqual([
      ["User", "user"],
      ["API", "service"],
    ]);
    expect(packets(d).map((p) => [p.variant, p.label])).toEqual([
      ["request", "call"],
      ["response", "ok"],
      ["error", "lost"],
      ["event", "fire"],
    ]);
  });

  it("reverse arrows, boxes and activations", () => {
    const d = ok(
      importPlantUml(
        uml(
          'box "Back"\nparticipant S\nend box\nparticipant C\nS <- C : req\nactivate S\nS --> C : res\ndeactivate S',
        ),
      ),
    );
    expect(packets(d).map((p) => [p.from, p.to])).toEqual([
      ["C", "S"],
      ["S", "C"],
    ]);
    expect(d.diagram.groups[0]!.label).toBe("Back");
    expect(d.scenario!.events.some((e) => e.type === "node_state" && e.state === "active")).toBe(
      true,
    );
  });
});

describe("PlantUML: rejected input and detection", () => {
  it.each([
    ["", "plantuml.empty"],
    ["@startmindmap\n* root\n@endmindmap", "plantuml.unsupported_diagram"],
    ["@startuml\n@enduml", "plantuml.no_components"],
  ])("%j -> %s", (src, code) => {
    const r = importPlantUml(src);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(code);
  });
  it("detects PlantUML by name and content", () => {
    expect(detectFormat("", "a.puml")).toBe("plantuml");
    expect(detectFormat("@startuml\nA -> B\n@enduml")).toBe("plantuml");
  });
});
