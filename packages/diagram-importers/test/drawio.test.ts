import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import { importDrawio, type ImportResult } from "../src/index.ts";

const model = (cells: string): string =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const file = (...pages: string[]): string =>
  `<mxfile>${pages.map((p, i) => `<diagram id="p${i}" name="Page ${i + 1}">${p}</diagram>`).join("")}</mxfile>`;
const v = (
  id: string,
  label: string,
  x: number,
  y: number,
  extra = "",
  parent = "1",
  w = 120,
  h = 60,
): string =>
  `<mxCell id="${id}" value="${label}" style="rounded=1;html=1;${extra}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const ed = (id: string, s: string, t: string, style = "", label = ""): string =>
  `<mxCell id="${id}" value="${label}" style="${style}" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const two = (edge: string): string => file(model(v("a", "A", 0, 0) + v("b", "B", 300, 0) + edge));

function ok(r: ImportResult): CanonicalDocument {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.document;
}
const codes = (r: ImportResult): string[] =>
  (r.ok ? r.warnings : [...r.errors, ...r.warnings]).map((i) => i.code);

describe("draw.io importer: structure", () => {
  it("imports shapes and connectors with absolute geometry", async () => {
    const d = ok(await importDrawio(two(ed("e", "a", "b", "", "call"))));
    expect(d.diagram.nodes.map((n) => [n.id, n.label, n.x, n.y, n.w, n.h])).toEqual([
      ["a", "A", 0, 0, 120, 60],
      ["b", "B", 300, 0, 120, 60],
    ]);
    expect(d.diagram.edges[0]).toMatchObject({
      from: "a",
      to: "b",
      label: "call",
      direction: "forward",
      arrowHead: "triangle",
    });
    expect(d.scenario).toBeUndefined();
  });

  it("accepts a bare <mxGraphModel> root", async () => {
    expect((await importDrawio(model(v("a", "A", 0, 0)))).ok).toBe(true);
  });

  it("converts parent-relative geometry through three container levels", async () => {
    const xml = file(
      model(
        v("g1", "Outer", 100, 100, "swimlane;", "1", 600, 400) +
          v("g2", "Inner", 50, 40, "container=1;", "g1", 400, 300) +
          v("g3", "Innermost", 10, 30, "swimlane;", "g2", 300, 200) +
          v("n", "Deep", 20, 40, "", "g3"),
      ),
    );
    const d = ok(await importDrawio(xml));
    expect(d.diagram.nodes[0]).toMatchObject({ label: "Deep", x: 180, y: 210, groupId: "g3" });
    expect(d.diagram.groups.map((g) => [g.id, g.parentId, g.frame])).toEqual([
      ["g1", undefined, { x: 100, y: 100, w: 600, h: 400 }],
      ["g2", "g1", { x: 150, y: 140, w: 400, h: 300 }],
      ["g3", "g2", { x: 160, y: 170, w: 300, h: 200 }],
    ]);
  });

  it("flattens untitled selection groups but keeps their shapes' absolute positions", async () => {
    const xml = file(
      model(
        `<mxCell id="sel" value="" style="group" vertex="1" parent="1"><mxGeometry x="50" y="60" width="200" height="100" as="geometry"/></mxCell>` +
          v("a", "A", 5, 7, "", "sel"),
      ),
    );
    const r = await importDrawio(xml);
    const d = ok(r);
    expect(d.diagram.groups).toEqual([]);
    expect(d.diagram.nodes[0]).toMatchObject({ x: 55, y: 67 });
    expect(d.diagram.nodes[0]!.groupId).toBeUndefined();
    expect(codes(r)).toContain("drawio.selection_group_flattened");
  });

  it("unwraps UserObject/object wrappers (label and id on the wrapper)", async () => {
    const xml = file(
      model(
        `<UserObject label="Wrapped" id="w"><mxCell style="html=1;" vertex="1" parent="1"><mxGeometry x="1" y="2" width="100" height="50" as="geometry"/></mxCell></UserObject>` +
          `<object label="Obj" id="o"><mxCell style="" vertex="1" parent="1"><mxGeometry x="200" y="2" width="100" height="50" as="geometry"/></mxCell></object>`,
      ),
    );
    expect(ok(await importDrawio(xml)).diagram.nodes.map((n) => [n.id, n.label])).toEqual([
      ["w", "Wrapped"],
      ["o", "Obj"],
    ]);
  });

  it("uses edge-label child cells as connector labels and ignores free text cells", async () => {
    const xml = two(
      ed("e", "a", "b") +
        `<mxCell id="l" value="HTTPS" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e"><mxGeometry relative="1" as="geometry"/></mxCell>` +
        `<mxCell id="t" value="just a note" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="200" width="100" height="20" as="geometry"/></mxCell>`,
    );
    const r = await importDrawio(xml);
    const d = ok(r);
    expect(d.diagram.edges[0]!.label).toBe("HTTPS");
    expect(d.diagram.nodes.map((n) => n.label)).toEqual(["A", "B"]);
    expect(codes(r)).toContain("drawio.text_ignored");
  });

  it("includes shapes on every layer", async () => {
    const xml = file(
      model(
        v("a", "A", 0, 0) +
          `<mxCell id="L2" value="Layer 2" parent="0"/>` +
          v("b", "B", 300, 0, "", "L2"),
      ),
    );
    expect(ok(await importDrawio(xml)).diagram.nodes).toHaveLength(2);
  });

  it("reads waypoints in absolute coordinates", async () => {
    const xml = two(
      `<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="150" y="100"/><mxPoint x="250" y="100"/></Array></mxGeometry></mxCell>`,
    );
    expect(ok(await importDrawio(xml)).diagram.edges[0]).toMatchObject({
      routing: "orthogonal",
      waypoints: [
        { x: 150, y: 100 },
        { x: 250, y: 100 },
      ],
    });
  });
});

describe("draw.io importer: connector semantics", () => {
  it.each([
    ["", "forward", "triangle"],
    ["endArrow=classic;", "forward", "triangle"],
    ["startArrow=classic;endArrow=classic;", "both", "triangle"],
    ["startArrow=block;endArrow=none;", "backward", "triangle"],
    ["endArrow=none;", "none", "none"],
    ["endArrow=open;", "forward", "open"],
    ["endArrow=oval;", "forward", "circle"],
    ["endArrow=diamondThin;", "forward", "diamond"],
  ])("style %j -> direction %s, head %s", async (style, direction, head) => {
    expect(ok(await importDrawio(two(ed("e", "a", "b", style)))).diagram.edges[0]).toMatchObject({
      direction,
      arrowHead: head,
    });
  });

  it("maps unknown arrowheads to triangle with a warning", async () => {
    const r = await importDrawio(two(ed("e", "a", "b", "endArrow=ERmandOne;")));
    expect(ok(r).diagram.edges[0]!.arrowHead).toBe("triangle");
    expect(codes(r)).toContain("drawio.arrow_mapped");
  });

  it.each([
    ["dashed=1;", "dashed"],
    ["dashed=1;dashPattern=1 4;", "dotted"],
    ["", "solid"],
  ])("stroke %j -> %s", async (style, stroke) => {
    expect(ok(await importDrawio(two(ed("e", "a", "b", style)))).diagram.edges[0]!.stroke).toBe(
      stroke,
    );
  });

  it.each([
    ["curved=1;", "curved"],
    ["edgeStyle=elbowEdgeStyle;", "orthogonal"],
    ["edgeStyle=entityRelationEdgeStyle;", "orthogonal"],
    ["edgeStyle=none;", "straight"],
  ])("routing %j -> %s", async (style, routing) => {
    expect(ok(await importDrawio(two(ed("e", "a", "b", style)))).diagram.edges[0]!.routing).toBe(
      routing,
    );
  });

  it.each([
    [
      "dangling",
      `<mxCell id="e" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"/></mxCell>`,
      "drawio.dangling_edge",
    ],
    ["self loop", ed("e", "a", "a"), "drawio.self_loop"],
    [
      "to a container",
      v("g", "G", 600, 0, "swimlane;", "1", 200, 200) + ed("e", "a", "g"),
      "drawio.edge_to_group",
    ],
    [
      "to a text cell",
      `<mxCell id="t" value="x" style="text;" vertex="1" parent="1"><mxGeometry x="0" y="300" width="50" height="20" as="geometry"/></mxCell>` +
        ed("e", "a", "t"),
      "drawio.edge_unsupported_endpoint",
    ],
  ])("drops a connector %s with a warning (never silently)", async (_n, cells, code) => {
    const r = await importDrawio(two(cells));
    expect(ok(r).diagram.edges).toEqual([]);
    expect(codes(r)).toContain(code);
  });
});

describe("draw.io importer: labels, ids, sizes", () => {
  it("strips HTML without interpreting it", async () => {
    const label =
      "&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;Order&lt;/b&gt;&lt;br&gt;Service&amp;nbsp;&amp;amp; Co";
    const d = ok(await importDrawio(file(model(v("a", label, 0, 0)))));
    expect(d.diagram.nodes[0]!.label).toBe("Order Service & Co");
  });

  it("keeps non-HTML labels verbatim (collapsed whitespace only)", async () => {
    const xml = file(
      model(
        `<mxCell id="a" value="a &lt;b&gt;  c" style="rounded=1;" vertex="1" parent="1"><mxGeometry width="100" height="50" as="geometry"/></mxCell>`,
      ),
    );
    expect(ok(await importDrawio(xml)).diagram.nodes[0]!.label).toBe("a <b> c");
  });

  it("truncates labels over 200 characters with a warning", async () => {
    const r = await importDrawio(file(model(v("a", "x".repeat(300), 0, 0))));
    expect(ok(r).diagram.nodes[0]!.label).toHaveLength(200);
    expect(codes(r)).toContain("import.label_truncated");
  });

  it("rewrites invalid and over-long ids deterministically and keeps them unique", async () => {
    const long = "id".repeat(50);
    const xml = file(
      model(
        v("node #1", "A", 0, 0) +
          v("node_#1", "B", 200, 0) +
          v(long, "C", 400, 0) +
          ed("e e", "node #1", long),
      ),
    );
    const r = await importDrawio(xml);
    const d = ok(r);
    const ids = d.diagram.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
    expect(d.diagram.edges[0]!.from).toBe(ids[0]);
    expect(d.diagram.edges[0]!.to).toBe(ids[2]);
    expect(codes(r)).toContain("import.ids_rewritten");
    expect(ok(await importDrawio(xml))).toEqual(d);
  });

  it("enlarges shapes below the 20 px minimum with a warning", async () => {
    const r = await importDrawio(file(model(v("a", "A", 0, 0, "", "1", 10, 10))));
    expect(ok(r).diagram.nodes[0]).toMatchObject({ w: 20, h: 20 });
    expect(codes(r)).toContain("drawio.node_resized");
  });

  it("maps well-known shapes to node kinds", async () => {
    const xml = file(
      model(
        v("a", "DB", 0, 0, "shape=cylinder3;") +
          v("b", "Q", 200, 0, "rhombus;") +
          v("c", "Doc", 400, 0, "shape=document;") +
          v("d", "U", 600, 0, "shape=umlActor;") +
          v("e", "S", 800, 0),
      ),
    );
    expect(ok(await importDrawio(xml)).diagram.nodes.map((n) => n.kind)).toEqual([
      "db",
      "decision",
      "document",
      "user",
      "service",
    ]);
  });
});

describe("draw.io importer: pages and compression", () => {
  const compress = (xml: string): string =>
    deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64");

  it("decodes compressed pages", async () => {
    const xml = `<mxfile><diagram id="x" name="P">${compress(model(v("a", "A", 0, 0) + v("b", "B", 200, 0) + ed("e", "a", "b")))}</diagram></mxfile>`;
    const d = ok(await importDrawio(xml));
    expect(d.diagram.nodes).toHaveLength(2);
    expect(d.diagram.edges).toHaveLength(1);
    expect(d.diagram.name).toBe("P");
  });

  it("imports the requested page of a multi-page file and says so", async () => {
    const xml = file(model(v("a", "First", 0, 0)), model(v("b", "Second", 0, 0)));
    const r1 = await importDrawio(xml);
    expect(ok(r1).diagram.nodes[0]!.label).toBe("First");
    expect(codes(r1)).toContain("drawio.multiple_pages");
    expect(ok(await importDrawio(xml, { page: 1 })).diagram.nodes[0]!.label).toBe("Second");
    expect(codes(await importDrawio(xml, { page: 5 }))).toContain("drawio.no_page");
  });

  it("rejects corrupt compressed data", async () => {
    expect(
      codes(await importDrawio(`<mxfile><diagram>AAAA$$$notbase64</diagram></mxfile>`)),
    ).toContain("drawio.decompress_failed");
  });

  it("refuses decompression bombs", async () => {
    const huge = deflateRawSync(Buffer.from("A".repeat(20_000_000))).toString("base64");
    const r = await importDrawio(`<mxfile><diagram>${huge}</diagram></mxfile>`);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("drawio.too_complex");
  });
});

describe("draw.io importer: hostile and malformed input", () => {
  it.each([
    ["", "drawio.empty"],
    ["   ", "drawio.empty"],
    ["not xml at all", "drawio.malformed"],
    ["<mxfile><diagram>", "drawio.malformed"],
    [
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><mxfile/>',
      "drawio.doctype_rejected",
    ],
    ['<!DOCTYPE foo SYSTEM "file:///etc/passwd"><mxfile/>', "drawio.doctype_rejected"],
    ["<svg/>", "svg.not_supported"],
    ["<mxfile/>", "drawio.no_model"],
    [file(model("")), "drawio.no_components"],
    ["<a>&undefined;</a>", "drawio.malformed"],
  ])("rejects %j with %s", async (input, code) => {
    const r = await importDrawio(input);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(code);
  });

  it("rejects non-string input", async () => {
    expect((await importDrawio(42 as unknown as string)).ok).toBe(false);
  });

  it("bounds nesting depth", async () => {
    const deep = "<a>".repeat(100) + "</a>".repeat(100);
    expect(codes(await importDrawio(deep))).toContain("drawio.too_complex");
  });
});

describe("draw.io importer: SVG exports", () => {
  it("imports the diagram embedded in a draw.io SVG export (content attribute)", async () => {
    const inner = file(
      model(v("a", "A", 0, 0) + v("b", "B", 300, 0) + ed("e", "a", "b", "", "call")),
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}"><rect width="1" height="1"/></svg>`;
    const r = await importDrawio(svg);
    expect(ok(r).diagram.edges[0]).toMatchObject({ from: "a", to: "b", label: "call" });
    expect(codes(r)).toContain("drawio.from_svg");
  });
  it("rejects a plain SVG with a clear message", async () => {
    const r = await importDrawio(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("svg.not_supported");
  });
});
