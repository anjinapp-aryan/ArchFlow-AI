import { CANONICAL_SCHEMA_MAJOR, CANONICAL_SCHEMA_MINOR } from "./schema.ts";
import { validateCanonical, type ValidationOptions, type ValidationResult } from "./validate.ts";

/**
 * Schema versioning.
 *
 * The `schema` string is `archflow/canonical@<major>`. The major changes only for breaking
 * changes; additive changes bump `schemaMinor` and keep older documents valid. A migration is a
 * pure function from the raw JSON of major N to major N+1 and is registered here. Reading an
 * old document = apply migrations N..current, then validate.
 */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[n]` upgrades major `n` to `n + 1`. Empty until a second major exists. */
export const MIGRATIONS: Record<number, Migration> = {};

export interface MigrationError {
  code: "version.unrecognized" | "version.newer_than_supported" | "version.minor_newer";
  path: string;
  message: string;
}

export type MigrationResult =
  | { ok: true; doc: Record<string, unknown>; migrated: boolean }
  | { ok: false; errors: MigrationError[] };

const SCHEMA_RE = /^archflow\/canonical@(0|[1-9][0-9]{0,3})$/;

export function parseSchemaMajor(schema: unknown): number | undefined {
  if (typeof schema !== "string") return undefined;
  const m = SCHEMA_RE.exec(schema);
  return m ? Number(m[1]) : undefined;
}

export function migrateCanonical(
  input: unknown,
  registry: Record<number, Migration> = MIGRATIONS,
  currentMajor: number = CANONICAL_SCHEMA_MAJOR,
): MigrationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return {
      ok: false,
      errors: [{ code: "version.unrecognized", path: "", message: "document must be an object" }],
    };
  let doc = input as Record<string, unknown>;
  const major = parseSchemaMajor(doc.schema);
  if (major === undefined)
    return {
      ok: false,
      errors: [
        {
          code: "version.unrecognized",
          path: "/schema",
          message: 'expected "archflow/canonical@<major>"',
        },
      ],
    };
  if (major > currentMajor)
    return {
      ok: false,
      errors: [
        {
          code: "version.newer_than_supported",
          path: "/schema",
          message: `document major ${major} is newer than supported major ${currentMajor}`,
        },
      ],
    };
  if (
    major === currentMajor &&
    typeof doc.schemaMinor === "number" &&
    currentMajor === CANONICAL_SCHEMA_MAJOR &&
    doc.schemaMinor > CANONICAL_SCHEMA_MINOR
  )
    return {
      ok: false,
      errors: [
        {
          code: "version.minor_newer",
          path: "/schemaMinor",
          message: `document minor ${doc.schemaMinor} is newer than supported minor ${CANONICAL_SCHEMA_MINOR}; unknown fields cannot be preserved`,
        },
      ],
    };
  let migrated = false;
  for (let v = major; v < currentMajor; v++) {
    const step = registry[v];
    if (!step)
      return {
        ok: false,
        errors: [
          {
            code: "version.unrecognized",
            path: "/schema",
            message: `no migration from major ${v} to ${v + 1}`,
          },
        ],
      };
    doc = step(doc);
    migrated = true;
  }
  return { ok: true, doc, migrated };
}

/** Migrate then validate. The only entry point importers and the UI should use for stored files. */
export function parseCanonical(
  input: unknown,
  options: ValidationOptions = {},
): ValidationResult | { ok: false; errors: MigrationError[]; warnings: [] } {
  const m = migrateCanonical(input);
  if (!m.ok) return { ok: false, errors: m.errors, warnings: [] };
  return validateCanonical(m.doc, options);
}
