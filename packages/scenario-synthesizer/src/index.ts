export * from "./synthesize.ts";
export * from "./text.ts";

import type { CanonicalDocument } from "@archflow/canonical-model";
import { parseDescription } from "./text.ts";
import { synthesizeScenario, type SynthesisIssue, type SynthesisOptions } from "./synthesize.ts";

/** Text description -> animated canonical document (diagram + generated scenario). */
export function textToAnimation(
  text: string,
  overrides: SynthesisOptions = {},
):
  | { ok: true; document: CanonicalDocument; warnings: SynthesisIssue[] }
  | { ok: false; errors: SynthesisIssue[]; warnings: SynthesisIssue[] } {
  const d = parseDescription(text);
  if (!d.ok || !d.document) return { ok: false, errors: d.errors, warnings: d.warnings };
  const r = synthesizeScenario(d.document, { ...d.options, ...overrides });
  if (!r.ok) return { ok: false, errors: r.errors, warnings: d.warnings };
  return { ok: true, document: r.document, warnings: [...d.warnings, ...r.warnings] };
}
