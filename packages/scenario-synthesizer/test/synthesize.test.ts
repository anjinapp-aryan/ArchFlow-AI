import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateCanonical,
  type CanonicalDocument,
  type PacketEvent,
} from "@archflow/canonical-model";
import { detectFormat, importDiagram } from "@archflow/diagram-importers";
import { inferKind, parseDescription, synthesizeScenario, textToAnimation } from "../src/index.ts";

const diagram = (text: string): CanonicalDocument => {
  const d = parseDescription(text);
  if (!d.ok || !d.document) throw new Error(JSON.stringify(d.errors));
  return d.document;
};
const packets = (d: CanonicalDocument): PacketEvent[] =>
  (d.scenario?.events ?? []).filter((e): e is PacketEvent => e.type === "packet");
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const codes = (r: { warnings?: { code: string }[]; errors?: { code: string }[] }) =>
  [...(r.errors ?? []), ...(r.warnings ?? [])].map((w) => w.code);

describe("synthesizer: traffic rules", () => {
  it("sync calls get responses; async calls do not", () => {
    const d = ok(synthesizeScenario(diagram("A -> B -> C\nB ..> Q"))).document;
    const p = packets(d).map((x) => `${x.from}>${x.to}:${x.variant}`);
    expect(p).toEqual(["a>b:request", "b>c:request", "c>b:response", "b>q:event", "b>a:response"]);
  });

  it("queue-like components make calls asynchronous even on solid arrows", () => {
    const d = ok(synthesizeScenario(diagram("Svc -> Kafka -> Worker"))).document;
    expect(packets(d).map((x) => x.variant)).toEqual(["event", "event"]);
  });

  it("follows arrow direction; plain and bidirectional lines may be used", () => {
    const d1 = ok(synthesizeScenario(diagram("A -> B\nC -> B"))).document;
    expect(packets(d1).some((p) => p.to === "c")).toBe(false);
    const d2 = ok(synthesizeScenario(diagram("A -- B\nB <-> C"))).document;
    expect(
      packets(d2)
        .filter((p) => p.variant === "request")
        .map((p) => p.to),
    ).toEqual(["b", "c"]);
  });

  it("terminates on cycles", () => {
    const r = ok(synthesizeScenario(diagram("A -> B -> C -> A")));
    expect(packets(r.document).length).toBe(4);
  });

  it("chooses the entry: user/client first, else a source node, or as configured", () => {
    expect(
      packets(ok(synthesizeScenario(diagram("Svc -> DB\nUser -> Svc"))).document)[0]!.from,
    ).toBe("user");
    expect(
      packets(ok(synthesizeScenario(diagram("X -> Y -> Z"), { entry: "Y" })).document)[0]!.from,
    ).toBe("y");
  });

  it("reports unreached components and missing traffic", () => {
    const r = synthesizeScenario(diagram("A -> B\nC -> D"));
    expect(codes(r)).toContain("synth.unreached");
    const r2 = synthesizeScenario(diagram("A -- A2\nB -> C"), { entry: "C" });
    expect(codes(r2)).toContain("synth.no_traffic");
  });

  it("responses can be turned off", () => {
    const d = ok(synthesizeScenario(diagram("A -> B -> C"), { responses: false })).document;
    expect(packets(d).every((p) => p.variant === "request")).toBe(true);
  });
});

describe("synthesizer: failures", () => {
  it("error mode: failed calls are red error packets, then a retry succeeds", () => {
    const d = ok(
      synthesizeScenario(diagram("A -> B"), {
        failures: [{ from: "A", to: "B", mode: "error", retries: 3 }],
      }),
    ).document;
    const p = packets(d).filter((x) => x.from === "a");
    expect(p.map((x) => [x.variant, x.attempt ?? 1])).toEqual([
      ["error", 1],
      ["error", 2],
      ["error", 3],
      ["retry", 4],
    ]);
    expect(p[3]!.retryOf).toBe(p[2]!.id);
  });

  it("timeout mode: retry chain of timed-out attempts, caller warns then recovers", () => {
    const d = ok(
      synthesizeScenario(diagram("A -> B -> C"), {
        failures: [{ from: "B", to: "C", retries: 2 }],
      }),
    ).document;
    const ev = d.scenario!.events;
    expect(ev.filter((e) => e.type === "timeout")).toHaveLength(2);
    const warn = ev.find((e) => e.type === "node_state" && e.state === "warn")!;
    expect(ev.some((e) => e.type === "node_state" && e.recovers === warn.id)).toBe(true);
    expect(validateCanonical(d).ok).toBe(true);
  });

  it("rejects failures on unknown components and warns when the call never happens", () => {
    expect(
      codes(synthesizeScenario(diagram("A -> B"), { failures: [{ from: "A", to: "Nope" }] })),
    ).toContain("synth.unknown_node");
    expect(
      codes(synthesizeScenario(diagram("A -> B\nC -> D"), { failures: [{ from: "C", to: "D" }] })),
    ).toContain("synth.failure_not_reached");
  });
});

describe("synthesizer: robustness", () => {
  it("every importer corpus diagram gets a valid scenario", async () => {
    const dir = new URL("../../../fixtures/diagrams/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => /\.(drawio|mmd|puml)$/.test(x))) {
      const text = readFileSync(new URL(f, dir), "utf8");
      const imp = await importDiagram(text, detectFormat(text, f)!);
      if (!imp.ok) throw new Error(f);
      const r = synthesizeScenario(imp.document);
      expect(r.ok, `${f}: ${JSON.stringify(r.ok ? "" : r.errors)}`).toBe(true);
    }
  });

  it("caps traffic on path-explosion graphs", () => {
    const lines: string[] = [];
    for (let l = 0; l < 12; l++) lines.push(`L${l}a, L${l}b -> L${l + 1}a, L${l + 1}b`);
    const r = synthesizeScenario(diagram(lines.join("\n")));
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain("synth.truncated");
  });

  it("does not modify its input", () => {
    const d = diagram("A -> B");
    const copy = structuredClone(d);
    synthesizeScenario(d);
    expect(d).toEqual(copy);
  });
});

describe("text descriptions", () => {
  it("arrows, labels, fan-out/fan-in, reverse, undirected and async links", () => {
    const d = diagram("A -> B, C -> D : call\nE <- A\nA <-> F\nA -- G\nA ..> H");
    const l = (id: string) => d.diagram.nodes.find((n) => n.id === id)!.label;
    expect(
      d.diagram.edges.map(
        (e) => `${l(e.from)}>${l(e.to)}|${e.label ?? ""}|${e.direction}|${e.stroke}`,
      ),
    ).toEqual([
      "A>B|call|forward|solid",
      "A>C|call|forward|solid",
      "B>D|call|forward|solid",
      "C>D|call|forward|solid",
      "A>E||forward|solid",
      "A>F||both|solid",
      "A>G||none|solid",
      "A>H||forward|dashed",
    ]);
  });

  it("verb sentences, consume = reverse async", () => {
    const d = diagram("The Web App calls the Orders API. Worker consumes from the Queue.");
    const l = (id: string) => d.diagram.nodes.find((n) => n.id === id)!.label;
    expect(d.diagram.edges.map((e) => `${l(e.from)}>${l(e.to)}:${e.stroke}`)).toEqual([
      "Web App>Orders API:solid",
      "Queue>Worker:dashed",
    ]);
  });

  it("infers component kinds from names", () => {
    expect(
      [
        "Customer",
        "React Frontend",
        "API Gateway",
        "Postgres DB",
        "Kafka",
        "Redis",
        "S3 Bucket",
        "Stripe",
        "Billing",
      ].map(inferKind),
    ).toEqual([
      "user",
      "client",
      "gateway",
      "db",
      "queue",
      "cache",
      "cloud",
      "external",
      "service",
    ]);
  });

  it("title, entry and failure directives", () => {
    const r = parseDescription("title: Shop\nentry: B\nA -> B -> C\nfail: B -> C error retries 2");
    expect(r.document!.diagram.name).toBe("Shop");
    expect(r.options).toEqual({
      entry: "B",
      failures: [{ from: "B", to: "C", mode: "error", retries: 2 }],
    });
  });

  it("reports unreadable statements and rejects empty descriptions", () => {
    expect(codes(parseDescription("A -> B\nthis means nothing"))).toContain("text.unrecognised");
    expect(codes(parseDescription(""))).toContain("text.empty");
    expect(codes(parseDescription("just words here"))).toContain("text.no_components");
  });

  it("text -> animation end to end validates", () => {
    const r = ok(textToAnimation("User -> Shop -> Payments\nShop ..> Events -> Mailer"));
    expect(validateCanonical(r.document).ok).toBe(true);
  });
});
