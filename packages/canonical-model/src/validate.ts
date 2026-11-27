import { CanonicalDocumentSchema, type CanonicalDocument } from "./schema.ts";
import { runRules, type Issue, type ValidationOptions } from "./rules.ts";

/** Machine-readable validation issue. `path` is a JSON Pointer into the input. */
export type ValidationError = Issue;
export type { ValidationOptions };

export type ValidationResult =
  | { ok: true; value: CanonicalDocument; errors: []; warnings: ValidationError[] }
  | { ok: false; value?: undefined; errors: ValidationError[]; warnings: ValidationError[] };

const pointer = (segments: readonly PropertyKey[]): string =>
  segments.length === 0
    ? ""
    : "/" + segments.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

/**
 * Validate untrusted input. Never throws.
 *
 * Stage 1: structural (strict schema; unknown keys are errors; limits).
 * Stage 2: semantic rules (see `rules.ts` and docs/architecture/CANONICAL_MODEL.md): references,
 * connector geometry/direction, durations, event ordering, request/response pairing, retry and
 * fallback sequences, timeouts, contradictory node states, flow hierarchy.
 *
 * The upstream engine silently repairs or erases invalid data, so everything it would repair
 * must be an error here. `errors` block rendering; `warnings` never do.
 */
export function validateCanonical(
  input: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  const parsed = CanonicalDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: `schema.${i.code}`,
        path: pointer(i.path),
        message: i.message,
      })),
      warnings: [],
    };
  }
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  runRules({
    doc: parsed.data,
    opts: {
      directionPolicy: options.directionPolicy ?? "strict",
      maxRetryAttempts: options.maxRetryAttempts ?? 10,
    },
    error: (code, path, message) => void errors.push({ code, path, message }),
    warn: (code, path, message) => void warnings.push({ code, path, message }),
  });
  return errors.length === 0
    ? { ok: true, value: parsed.data, errors: [], warnings }
    : { ok: false, errors, warnings };
}
