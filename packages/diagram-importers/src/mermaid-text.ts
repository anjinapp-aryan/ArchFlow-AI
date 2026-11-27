import { collapse, decodeEntities, Issues } from "./common.ts";

/** Shared Mermaid text handling: frontmatter, comments, statements, label unescaping. */

export interface Statement {
  text: string;
  line: number;
}

export interface Preprocessed {
  title?: string;
  statements: Statement[];
}

/** Split into statements: strips frontmatter, `%%` comments/directives, splits on `;` outside quotes. */
export function preprocess(text: string): Preprocessed {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let title: string | undefined;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() === "---") {
    for (i++; i < lines.length && lines[i]!.trim() !== "---"; i++) {
      const m = /^\s*title\s*:\s*(.+?)\s*$/.exec(lines[i]!);
      if (m) title = unquote(m[1]!);
    }
    i++;
  }
  const statements: Statement[] = [];
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (t === "" || t.startsWith("%%")) continue;
    for (const part of splitOutsideQuotes(t, ";")) {
      const p = part.trim();
      if (p) statements.push({ text: p, line: i + 1 });
    }
  }
  return { ...(title !== undefined ? { title } : {}), statements };
}

export function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let depth = 0;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && "[({".includes(ch)) depth++;
    else if (!quoted && "])}".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === sep && !quoted && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Mermaid entity codes (`#quot;`, `#35;`, `#9829;`) and HTML entities, quotes and markdown strings. */
export function unquote(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  if (t.length >= 2 && t.startsWith("`") && t.endsWith("`"))
    t = t
      .slice(1, -1)
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1");
  t = t.replace(/#([A-Za-z]+|[0-9]+);/g, (_m, b: string) =>
    decodeEntities(/^[0-9]+$/.test(b) ? `&#${b};` : `&${b};`),
  );
  t = decodeEntities(t.replace(/<\s*br\s*\/?\s*>/gi, " "));
  return collapse(t);
}

export function slug(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "group"
  );
}

export function ignorable(
  stmt: Statement,
  issues: Issues,
  keywords: RegExp,
  what: string,
): boolean {
  const m = keywords.exec(stmt.text);
  if (!m) return false;
  issues.warnOnce(
    `mermaid.ignored_${m[1]!.toLowerCase()}`,
    `"${m[1]}" statements are ${what}`,
    `line ${stmt.line}`,
  );
  return true;
}
