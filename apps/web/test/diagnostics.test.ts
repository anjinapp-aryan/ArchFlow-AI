import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeIssue, summarizeIssues } from "../src/diagnostics.ts";
import { prepare, type Issue, type SourceKind } from "../src/pipeline.ts";

const fx = (p: string): string =>
  readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

/** The app's examples (apps/web/src/samples.ts) plus inputs that fail. */
const INPUTS: [string, SourceKind, string, Parameters<typeof prepare>[2]?][] = [
  ["aws-alb", "text", fx("regression/aws-alb.txt")],
  ["bench text", "text", fx("benchmark/order-flow.txt")],
  ["bench sentences", "text", fx("benchmark/order-flow.sentences.txt")],
  ["bench mermaid", "mermaid", fx("benchmark/order-flow.mmd")],
  ["sequence", "mermaid", fx("diagrams/15-sequence-rich.mmd")],
  ["mermaid syntax", "mermaid", fx("diagrams/14-mermaid-syntax.mmd")],
  ["drawio order", "drawio", fx("diagrams/10-order-flow.drawio")],
  ["drawio real", "drawio", fx("diagrams/13-drawio-realworld.drawio")],
  ["puml component", "plantuml", fx("diagrams/16-plantuml-component.puml")],
  ["puml sequence", "plantuml", fx("diagrams/17-plantuml-sequence.puml")],
  ["canonical", "json", fx("scenarios/order-flow.canonical.json")],
  ["bad mermaid", "mermaid", "pie title nope\n"],
  ["bad json", "json", "{nope"],
  ["empty text", "text", ""],
  ["unreadable line", "text", "A -> B\nthis is ??? not a link at all ->\n"],
  ["unreached", "text", "A -> B\nC -> D\n"],
];

describe("human-readable diagnostics", () => {
  it("explains health monitoring and merged labels in plain language (AWS ALB)", async () => {
    const r = await prepare("text", fx("regression/aws-alb.txt"));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const d = r.issues.map(describeIssue);
    const mon = d.find((x) => x.code === "text.monitoring_inferred")!;
    expect(mon.title).toBe("Health monitoring detected");
    expect(mon.body).toMatch(
      /^(One|Two|Three|\d+) monitoring connections? (was|were) identified and separated from normal request routing/,
    );
    expect(mon.severity).toBe("Warning");
    const routed = d.find((x) => x.code === "info.routes_not_taken")!;
    expect(routed.title).toBe("Request routed to one target");
    expect(routed.body).toContain("Auth TG");
    expect(routed.severity).toBe("Information");
    // the machine code stays available in the details
    expect(mon.technical).toContain("text.monitoring_inferred");
  });

  it("merged health-check labels", () => {
    const d = describeIssue({
      level: "info",
      code: "info.monitoring_labels_merged",
      message: "3 identical health-check label(s) drawn once instead of repeated",
    });
    expect(d.title).toBe("Health-check labels combined");
    expect(d.body).toBe(
      "Three identical health-check labels were combined for better readability.",
    );
  });

  it.each(INPUTS)(
    "%s: every message has a plain title and sentence, never a bare code",
    async (_n, kind, text, o) => {
      const r = await prepare(kind, text, o);
      const issues: Issue[] = r.issues;
      for (const i of issues) {
        const d = describeIssue(i);
        expect(d.title, i.code).not.toMatch(/^[a-z]+\.[a-z_]+$/);
        expect(d.title).not.toContain(i.code);
        expect(d.body).not.toContain(i.code);
        expect(d.body, i.code).toMatch(/^[A-Z“"(0-9]/);
        expect(d.body.trim(), i.code).toMatch(/[.!?…]$/);
        expect(d.technical).toContain(i.code);
        expect(["Error", "Warning", "Information"]).toContain(d.severity);
      }
    },
  );

  it("errors are explained", async () => {
    const r = await prepare("mermaid", "pie title nope\n");
    expect(r.ok).toBe(false);
    const d = describeIssue(r.issues.find((i) => i.level === "error")!);
    expect(d.severity).toBe("Error");
    expect(d.title).toBe("Unsupported Mermaid diagram type");
  });

  it("summary line counts by severity", () => {
    const mk = (level: Issue["level"]): Issue => ({ level, code: "x.y", message: "m" });
    expect(summarizeIssues([])).toMatchObject({ status: "ok", text: "Valid · no messages" });
    expect(summarizeIssues([mk("warning"), mk("info"), mk("info")])).toMatchObject({
      status: "warning",
      text: "Valid · 1 warning · 2 notes",
    });
    expect(summarizeIssues([mk("error"), mk("error"), mk("info")])).toMatchObject({
      status: "error",
      text: "Cannot animate · 2 errors · 1 note",
    });
  });
});
