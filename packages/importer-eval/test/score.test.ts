import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CORPUS,
  perfectImport,
  scoreImport,
  summarize,
  type CorpusEntry,
  type CorpusResults,
  type Format,
  type Imported,
} from "../src/index.ts";
import { corpusInputs } from "../src/run.ts";

const entry = (id: string): CorpusEntry => CORPUS.find((c) => c.id === id)!;
const run = (id: string, format: Format, mutate: (i: Imported) => void) => {
  const imp = perfectImport(entry(id), format);
  mutate(imp);
  return scoreImport(entry(id), format, { ok: true, imported: imp });
};
const check = (s: ReturnType<typeof run>, name: string) => s.checks.find((c) => c.name === name)!;

describe("fidelity scorer (self-tests: it must not be able to pass a bad importer)", () => {
  it.each(corpusInputs().map((i) => [i.file, i] as const))(
    "a perfect importer passes %s",
    (_f, { entry: e, format }) => {
      const s = scoreImport(e, format, { ok: true, imported: perfectImport(e, format) });
      expect(s.pass, JSON.stringify(s.checks.filter((c) => c.details.length))).toBe(true);
      expect(s.extraEdges).toEqual([]);
    },
  );

  it("a rejected import never passes", () => {
    const s = scoreImport(entry("01-linear"), "drawio", { ok: false, error: "boom" });
    expect(s.outcome).toBe("rejected");
    expect(s.pass).toBe(false);
    expect(s.error).toBe("boom");
  });

  it("missing node fails nodes", () => {
    const s = run("01-linear", "drawio", (i) => void i.nodes.pop());
    expect(s.pass).toBe(false);
    expect(check(s, "nodes").matched).toBe(3);
  });

  it("an extra node or an invented edge fails even if everything expected is present", () => {
    const a = run("01-linear", "drawio", (i) => void i.nodes.push({ label: "Ghost" }));
    expect(a.pass).toBe(false);
    expect(a.extraNodes).toEqual(["Ghost"]);
    const b = run(
      "09-ambiguous-direction",
      "drawio",
      (i) =>
        void i.edges.push({ from: "Alpha", to: "Delta", label: "dangling", direction: "forward" }),
    );
    expect(b.pass).toBe(false);
    expect(b.extraEdges).toEqual(['Alpha -> Delta "dangling"']);
  });

  it("position tolerance boundary: 1 px passes, 1.01 px fails", () => {
    expect(run("01-linear", "drawio", (i) => void (i.nodes[0]!.x! += 1)).pass).toBe(true);
    const s = run("01-linear", "drawio", (i) => void (i.nodes[0]!.x! += 1.01));
    expect(s.pass).toBe(false);
    expect(check(s, "node-position").matched).toBe(3);
  });

  it("missing size / position is a failure, not a silent pass", () => {
    const a = run("01-linear", "drawio", (i) => i.nodes.forEach((n) => delete n.w));
    expect(check(a, "node-size").matched).toBe(0);
    const b = run("01-linear", "drawio", (i) => i.nodes.forEach((n) => delete n.x));
    expect(check(b, "node-position").matched).toBe(0);
  });

  it("direction: forward is not accepted for a plain line, and backward may be expressed reversed", () => {
    const a = run("09-ambiguous-direction", "drawio", (i) => {
      i.edges.find((e) => e.label === "plain line")!.direction = "forward";
    });
    expect(check(a, "edge-direction").matched).toBe(2);
    expect(a.pass).toBe(false);
    const ok = run("09-ambiguous-direction", "drawio", (i) => {
      const e = i.edges.find((x) => x.label === "arrow at source")!;
      [e.from, e.to] = [e.to, e.from];
      e.direction = "forward";
    });
    expect(check(ok, "edge-direction").matched).toBe(3);
    const wrong = run("09-ambiguous-direction", "drawio", (i) => {
      i.edges.find((e) => e.label === "arrow at source")!.direction = "forward";
    });
    expect(check(wrong, "edge-direction").matched).toBe(2);
  });

  it("bidirectional edges must stay bidirectional", () => {
    const s = run("05-bidirectional", "drawio", (i) => {
      i.edges.find((e) => e.label === "websocket")!.direction = "forward";
    });
    expect(check(s, "edge-direction").matched).toBe(2);
  });

  it("dashed and routing are checked only where the truth has them", () => {
    const s = run("08-dashed-curved", "drawio", (i) => {
      for (const e of i.edges) {
        delete e.stroke;
        delete e.routing;
      }
    });
    expect(check(s, "edge-dashed").matched).toBe(0);
    expect(check(s, "edge-routing").matched).toBe(0);
    expect(check(s, "edge-dashed").expected).toBe(2);
    expect(check(s, "edge-routing").expected).toBe(3);
    expect(
      check(
        run("01-linear", "drawio", () => undefined),
        "edge-dashed",
      ).applicable,
    ).toBe(false);
  });

  it("multiple connectors between one pair must all survive (multiset)", () => {
    const s = run("04-multiple-connectors", "mermaid-flowchart", (i) => {
      i.edges = i.edges.filter((e) => e.label !== "gRPC");
    });
    expect(check(s, "edges").matched).toBe(3);
    expect(s.pass).toBe(false);
  });

  it("groups: missing groups, lost nesting and lost membership each fail separately", () => {
    const none = run("06-nested-groups", "drawio", (i) => {
      i.groups = [];
      i.nodes.forEach((n) => delete n.group);
    });
    expect(check(none, "groups").matched).toBe(0);
    expect(check(none, "group-nesting").matched).toBe(0);
    expect(check(none, "group-membership").matched).toBe(0);
    const flat = run("06-nested-groups", "drawio", (i) => i.groups.forEach((g) => delete g.parent));
    expect(check(flat, "groups").matched).toBe(2);
    expect(check(flat, "group-nesting").matched).toBe(0);
  });

  it("groups imported as ordinary nodes are reported as extra nodes", () => {
    const s = run("06-nested-groups", "drawio", (i) => {
      i.nodes.push({ label: "VPC" }, { label: "Private subnet" });
    });
    expect(s.extraNodes).toEqual(["VPC", "Private subnet"]);
    expect(s.pass).toBe(false);
  });

  it("features a format cannot express are not applicable (and not counted)", () => {
    const s = run("08-dashed-curved", "mermaid-flowchart", () => undefined);
    for (const n of ["node-position", "node-size", "edge-routing"]) {
      expect(check(s, n).applicable, n).toBe(false);
      expect(check(s, n).expected, n).toBe(0);
    }
    expect(check(s, "edge-dashed").applicable).toBe(true);
    const seq = run("11-sequence", "mermaid-sequence", () => undefined);
    expect(check(seq, "groups").applicable).toBe(false);
  });

  it("the Mermaid ground truth omits edges Mermaid cannot express", () => {
    const s = run("09-ambiguous-direction", "mermaid-flowchart", () => undefined);
    expect(check(s, "edges").expected).toBe(2);
    const d = run("09-ambiguous-direction", "drawio", () => undefined);
    expect(check(d, "edges").expected).toBe(3);
  });

  it("sequence diagrams: messages must keep order, endpoints, labels and reply-ness", () => {
    const ok = run("11-sequence", "mermaid-sequence", () => undefined);
    expect(ok.pass).toBe(true);
    expect(check(ok, "sequence-messages").expected).toBe(4);
    expect(check(ok, "sequence-replies").expected).toBe(2);
    // connectors are the distinct participant pairs, not one per message
    expect(check(ok, "edges").expected).toBe(2);
    const swapped = run("11-sequence", "mermaid-sequence", (i) => {
      i.messages = [i.messages![1]!, i.messages![0]!, ...i.messages!.slice(2)];
    });
    expect(check(swapped, "sequence-messages").matched).toBe(2);
    const noReply = run("11-sequence", "mermaid-sequence", (i) =>
      i.messages!.forEach((m) => (m.reply = false)),
    );
    expect(check(noReply, "sequence-replies").matched).toBe(0);
    const dropped = run(
      "11-sequence",
      "mermaid-sequence",
      (i) => void (i.messages = i.messages!.slice(0, 2)),
    );
    expect(check(dropped, "sequence-messages").matched).toBe(2);
    expect(dropped.pass).toBe(false);
    const none = run("11-sequence", "mermaid-sequence", (i) => void delete i.messages);
    expect(check(none, "sequence-messages").matched).toBe(0);
  });

  it("summaries add up", () => {
    const scores = [
      run("01-linear", "drawio", () => undefined),
      run("01-linear", "drawio", (i) => void i.nodes.pop()),
    ];
    const s = summarize(scores);
    expect(s).toMatchObject({ diagrams: 2, imported: 2, rejected: 0, passed: 1 });
    expect(s.checks["nodes"]).toEqual({ expected: 8, matched: 7 });
  });
});

describe("recorded baseline (fixtures/diagrams/results.json)", () => {
  const path = new URL("../../../fixtures/diagrams/results.json", import.meta.url);
  const results = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as CorpusResults)
    : undefined;

  it("exists and covers both importers over the whole corpus", () => {
    expect(results).toBeDefined();
    expect(results!.results.map((r) => r.importer).sort()).toEqual([
      "archflow-ts",
      "cogniflow-ts",
      "native-animateddiagrams-2.2.0",
    ]);
    for (const r of results!.results) expect(r.scores.length).toBe(corpusInputs().length);
  });

  it("is internally consistent: pass implies every applicable check is complete and nothing extra", () => {
    for (const r of results!.results)
      for (const s of r.scores) {
        if (s.pass) {
          expect(s.outcome).toBe("imported");
          expect(s.extraEdges).toEqual([]);
          expect(s.extraNodes).toEqual([]);
          for (const c of s.checks) if (c.applicable) expect(c.matched).toBe(c.expected);
        }
        for (const c of s.checks) expect(c.matched).toBeLessThanOrEqual(c.expected);
      }
  });
});
