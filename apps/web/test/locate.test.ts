import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { locateIssue } from "../src/locate.ts";
import { prepare, type Prepared } from "../src/pipeline.ts";

const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

async function ok(kind: Parameters<typeof prepare>[0], text: string): Promise<Prepared> {
  const r = await prepare(kind, text);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
}

describe("diagnostic locations", () => {
  it("AWS ALB: routed-past components and inferred health checks map to the diagram", async () => {
    const text = fx("regression/aws-alb.txt");
    const r = await ok("text", text);
    const label = (id: string) => r.document.diagram.nodes.find((n) => n.id === id)!.label;
    const routed = r.issues.find((i) => i.code === "info.routes_not_taken")!;
    const a = locateIssue(routed, r.document, text);
    expect(a.nodes.map(label).sort()).toEqual(
      // Frontend ECS is reached by health probes, so it is not listed as routed past
      ["Auth Service", "Auth TG", "Web TG"],
    );
    const mon = r.issues.find((i) => i.code === "text.monitoring_inferred")!;
    const b = locateIssue(mon, r.document, text);
    expect(b.edges.length).toBeGreaterThan(0);
    for (const id of b.edges) {
      const e = r.document.diagram.edges.find((x) => x.id === id)!;
      expect(e.interaction ?? "monitoring").toBe("monitoring");
    }
    expect(b.reason).toBeUndefined();
  });

  it("unreached component: highlighted by its unique name", async () => {
    const text = "A -> B\nC -> D\n";
    const r = await ok("text", text);
    const i = r.issues.find((x) => x.code === "synth.unreached")!;
    const loc = locateIssue(i, r.document, text);
    expect(loc.nodes).toHaveLength(1);
    expect(r.document.diagram.nodes.find((n) => n.id === loc.nodes[0])!.label).toMatch(/^[CD]$/);
  });

  it("unreadable description line: points at its source line", async () => {
    const text = "A -> B\nthis line ??? is not a link at all\nB -> C\n";
    const r = await ok("text", text);
    const i = r.issues.find((x) => x.code === "text.unrecognised")!;
    expect(locateIssue(i, r.document, text).line).toBe(2);
  });

  it("Mermaid and PlantUML `line N` sources become editor lines", async () => {
    const text = "flowchart LR\n  A --> B\n  this is not mermaid ::: at all\n  B --> C\n";
    const r = await prepare("mermaid", text);
    const i = r.issues.find((x) => x.source?.startsWith("line "));
    expect(i, JSON.stringify(r.issues)).toBeDefined();
    expect(locateIssue(i!, r.ok ? r.document : undefined, text).line).toBe(
      Number(/line (\d+)/.exec(i!.source!)![1]),
    );
  });

  it("canonical JSON paths map to the component or connector", async () => {
    const text = fx("scenarios/order-flow.canonical.json");
    const r = await ok("json", text);
    const node = r.document.diagram.nodes[2]!;
    const edge = r.document.diagram.edges[1]!;
    const n = locateIssue(
      {
        level: "warning",
        code: "geometry.nodes_overlap",
        message: "x",
        source: "/diagram/nodes/2/x",
      },
      r.document,
      text,
    );
    expect(n.nodes).toEqual([node.id]);
    const e = locateIssue(
      { level: "warning", code: "edge.self_loop", message: "x", source: "/diagram/edges/1" },
      r.document,
      text,
    );
    expect(e.edges).toEqual([edge.id]);
  });

  it("never guesses: ambiguous names and whole-diagram messages give a reason instead", async () => {
    const text = "A -> B\nA -> C\n";
    const r = await ok("text", text);
    const doc = structuredClone(r.document);
    doc.diagram.nodes[1]!.label = "Same";
    doc.diagram.nodes[2]!.label = "Same";
    const amb = locateIssue(
      {
        level: "warning",
        code: "synth.unreached",
        message: '"Same" receives no traffic from the entry component',
      },
      doc,
      text,
    );
    expect(amb.nodes).toEqual([]);
    expect(amb.reason).toMatch(/not unique/);
    const whole = locateIssue(
      { level: "info", code: "info.groups_flattened", message: "2 group(s) not drawn" },
      doc,
      text,
    );
    expect(whole).toMatchObject({
      nodes: [],
      edges: [],
      reason: expect.stringMatching(/whole diagram/),
    });
    expect(
      locateIssue({ level: "error", code: "json.malformed", message: "x" }, undefined, "{").reason,
    ).toMatch(/No animation yet/);
  });
});
