import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_SCHEMA_ID,
  CANONICAL_SCHEMA_MAJOR,
  CANONICAL_SCHEMA_MINOR,
  migrateCanonical,
  parseCanonical,
  parseSchemaMajor,
  validateCanonical,
  type Migration,
} from "../src/index.ts";

const fixture = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL("../../../fixtures/scenarios/linear-3.canonical.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;

describe("schema versioning", () => {
  it("constants agree with the schema id", () => {
    expect(CANONICAL_SCHEMA_ID).toBe(`archflow/canonical@${CANONICAL_SCHEMA_MAJOR}`);
    expect(CANONICAL_SCHEMA_MINOR).toBe(2);
  });

  it.each([
    ["archflow/canonical@1", 1],
    ["archflow/canonical@12", 12],
    ["archflow/canonical@0", 0],
    ["archflow/canonical@01", undefined],
    ["archflow/canonical@", undefined],
    ["archflow/canonical@1.2", undefined],
    ["other/canonical@1", undefined],
    [1, undefined],
    [undefined, undefined],
  ])("parseSchemaMajor(%j) = %j", (s, expected) => {
    expect(parseSchemaMajor(s)).toBe(expected);
  });

  it("current-major documents pass through unchanged", () => {
    const d = fixture();
    const r = migrateCanonical(d);
    expect(r).toEqual({ ok: true, doc: d, migrated: false });
    expect(parseCanonical(d).ok).toBe(true);
  });

  it("a document without schemaMinor defaults to 0", () => {
    const r = validateCanonical(fixture());
    expect(r.ok && r.value.schemaMinor).toBe(0);
  });

  it("rejects a newer major with a stable code", () => {
    const r = migrateCanonical({ ...fixture(), schema: "archflow/canonical@2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("version.newer_than_supported");
  });

  it("rejects a newer minor (validator and migrator)", () => {
    const d = { ...fixture(), schemaMinor: CANONICAL_SCHEMA_MINOR + 1 };
    const m = migrateCanonical(d);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.errors[0]?.code).toBe("version.minor_newer");
    expect(validateCanonical(d).ok).toBe(false);
  });

  it.each([null, 3, "x", [], {}, { schema: "nope" }, { schema: "archflow/canonical@x" }])(
    "rejects unrecognised input %j",
    (input) => {
      const r = parseCanonical(input);
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    },
  );

  it("applies registered migrations in order (injected fake v0 -> v1 -> v2)", () => {
    const registry: Record<number, Migration> = {
      0: (d) => ({ ...d, schema: "archflow/canonical@1", steps: undefined }),
      1: (d) => ({ ...d, schema: "archflow/canonical@2", touched: true }),
    };
    const r = migrateCanonical({ schema: "archflow/canonical@0" }, registry, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migrated).toBe(true);
      expect(r.doc.schema).toBe("archflow/canonical@2");
      expect(r.doc.touched).toBe(true);
    }
  });

  it("fails clearly when a migration step is missing", () => {
    const r = migrateCanonical({ schema: "archflow/canonical@0" }, {}, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("no migration from major 0");
  });
});

describe("documentation examples stay valid", () => {
  it("the JSON example in CANONICAL_MODEL.md validates", () => {
    const md = readFileSync(
      new URL("../../../docs/architecture/CANONICAL_MODEL.md", import.meta.url),
      "utf8",
    );
    const m = /```json\n([\s\S]*?)\n```/.exec(md);
    expect(m).not.toBeNull();
    const r = validateCanonical(JSON.parse(m![1]!));
    expect(r.errors).toEqual([]);
    expect(new Set(r.warnings.map((w) => w.code))).toEqual(new Set(["state.down_node_used"]));
  });
});
