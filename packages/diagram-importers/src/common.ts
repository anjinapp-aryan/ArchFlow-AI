import {
  CANONICAL_SCHEMA_ID,
  CANONICAL_SCHEMA_MINOR,
  LIMITS,
  validateCanonical,
  type CanonicalDocument,
} from "@archflow/canonical-model";

/**
 * Shared importer plumbing. Importers turn UNTRUSTED text into a canonical document. They never
 * execute anything from the input, never fetch anything it references, and every output passes
 * the canonical validator before it is returned.
 */

export interface ImportIssue {
  /** Stable machine-readable code, e.g. `drawio.dangling_edge`. */
  code: string;
  message: string;
  /** Where in the source: a draw.io cell id or a Mermaid `line N`. */
  source?: string;
}

export type ImportResult =
  | { ok: true; document: CanonicalDocument; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[]; warnings: ImportIssue[] };

export interface ImportOptions {
  /** Canonical `diagram.id`; default derived from the source. */
  diagramId?: string;
  /** Canonical `diagram.name`; default derived from the source. */
  name?: string;
}

/** Input size cap for any importer (bytes of UTF-16 text, measured as string length * 2 upper bound). */
export const MAX_INPUT_CHARS = 4_000_000;

export class Issues {
  readonly warnings: ImportIssue[] = [];
  readonly errors: ImportIssue[] = [];
  private readonly once = new Set<string>();
  warn(code: string, message: string, source?: string): void {
    this.warnings.push({ code, message, ...(source !== undefined ? { source } : {}) });
  }
  /** Report a code only the first time (used for repetitive, informational findings). */
  warnOnce(code: string, message: string, source?: string): void {
    if (this.once.has(code)) return;
    this.once.add(code);
    this.warn(code, message, source);
  }
  error(code: string, message: string, source?: string): void {
    this.errors.push({ code, message, ...(source !== undefined ? { source } : {}) });
  }
}

/** FNV-1a 32-bit, hex. Deterministic short hash for id shortening. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Maps arbitrary source ids to canonical ids (`^[A-Za-z0-9_.:-]{1,64}$`), unique within one
 * namespace, deterministically. Reports how many ids had to be rewritten.
 */
export class IdMapper {
  private readonly map = new Map<string, string>();
  private readonly used = new Set<string>();
  rewritten = 0;
  constructor(private readonly fallbackPrefix: string) {}
  get(source: string): string | undefined {
    return this.map.get(source);
  }
  assign(source: string): string {
    const existing = this.map.get(source);
    if (existing !== undefined) return existing;
    let id = source.replace(/[^A-Za-z0-9_.:-]/g, "_");
    if (id.length === 0) id = this.fallbackPrefix;
    if (id.length > LIMITS.maxIdLength)
      id = `${id.slice(0, LIMITS.maxIdLength - 9)}_${fnv1a(source)}`;
    let candidate = id;
    for (let n = 2; this.used.has(candidate); n++) {
      const suffix = `_${n}`;
      candidate = id.slice(0, LIMITS.maxIdLength - suffix.length) + suffix;
    }
    if (candidate !== source) this.rewritten++;
    this.used.add(candidate);
    this.map.set(source, candidate);
    return candidate;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rarr: "→",
  larr: "←",
  harr: "↔",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X"))
      return safeCodePoint(parseInt(body.slice(2), 16), m);
    if (body.startsWith("#")) return safeCodePoint(parseInt(body.slice(1), 10), m);
    return NAMED_ENTITIES[body] ?? m;
  });
}

function safeCodePoint(cp: number, fallback: string): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
    return fallback;
  return String.fromCodePoint(cp);
}

/**
 * HTML label -> plain text. Line-breaking tags become spaces, every other tag is removed (never
 * interpreted), entities are decoded once, whitespace is collapsed.
 */
export function htmlToText(html: string): string {
  return collapse(
    decodeEntities(
      html
        .replace(/<\s*br\s*\/?\s*>/gi, " ")
        .replace(/<\/\s*(div|p|li|h[1-6]|tr)\s*>/gi, " ")
        .replace(/<[^>]*>/g, ""),
    ),
  );
}

export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Truncate to the canonical label limit, reporting it. */
export function fitLabel(text: string, issues: Issues, source: string): string {
  if (text.length <= LIMITS.maxLabelLength) return text;
  issues.warn(
    "import.label_truncated",
    `label longer than ${LIMITS.maxLabelLength} characters was truncated`,
    source,
  );
  return text.slice(0, LIMITS.maxLabelLength - 1) + "…";
}

export { estimateTextWidth } from "@archflow/canonical-model";

/** Final step of every importer: validate, and convert validator output into import issues. */
export function finish(doc: CanonicalDocument, issues: Issues): ImportResult {
  if (issues.errors.length > 0)
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  const v = validateCanonical(doc);
  const warnings = [
    ...issues.warnings,
    ...v.warnings.map((w) => ({
      code: `validation.${w.code}`,
      message: w.message,
      source: w.path,
    })),
  ];
  if (!v.ok)
    return {
      ok: false,
      errors: v.errors.map((e) => ({
        code: `validation.${e.code}`,
        message: `importer produced an invalid document: ${e.message}`,
        source: e.path,
      })),
      warnings,
    };
  return { ok: true, document: v.value, warnings };
}

export function emptyDocument(id: string, name: string): CanonicalDocument {
  return {
    schema: CANONICAL_SCHEMA_ID,
    schemaMinor: CANONICAL_SCHEMA_MINOR,
    diagram: { id, name, nodes: [], edges: [], groups: [] },
  };
}

export function checkInput(text: unknown, issues: Issues, format: string): text is string {
  if (typeof text !== "string") {
    issues.error(`${format}.not_text`, "input must be a string");
    return false;
  }
  if (text.length > MAX_INPUT_CHARS) {
    issues.error(`${format}.too_large`, `input exceeds ${MAX_INPUT_CHARS} characters`);
    return false;
  }
  if (text.trim().length === 0) {
    issues.error(`${format}.empty`, "input is empty");
    return false;
  }
  return true;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
