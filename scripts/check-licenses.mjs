#!/usr/bin/env node
// License gate: every installed (production + dev) npm package must carry an SPDX expression
// that is covered by the allowlist. Anything unknown, copyleft-only or non-OSS fails the run.
//
// Allowlist reasoning (see docs/architecture/DEPENDENCY_DECISIONS.md):
//   permissive: MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0, Python-2.0, Zlib
//   OR-expressions are allowed when at least one alternative is on the list (we elect that one).
//   The product itself is MIT-licensed (root LICENSE).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "Zlib",
]);
// Reviewed exceptions: package@version -> reason. Keep short; each needs a rationale.
const EXCEPTIONS = JSON.parse(
  readFileSync(join(root, "scripts", "license-exceptions.json"), "utf8"),
);

const bin = join(
  root,
  "node_modules",
  "license-checker-rseidelsohn",
  "bin",
  "license-checker-rseidelsohn",
);
const r = spawnSync(process.execPath, [bin, "--json", "--start", root], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
});
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(2);
}
const data = JSON.parse(r.stdout);

function ok(expr) {
  const parts = expr
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const isAnd = /\sAND\s/i.test(expr);
  const isOr = /\sOR\s/i.test(expr);
  if (isAnd && !isOr) return parts.every((p) => ALLOW.has(p));
  return parts.some((p) => ALLOW.has(p));
}

const failures = [];
const rows = [];
for (const [name, info] of Object.entries(data)) {
  if (name.startsWith("archflow-ai@") || name.startsWith("@archflow/")) continue;
  const lic = String(info.licenses ?? "UNKNOWN");
  const row = { name, license: lic };
  if (EXCEPTIONS[name]) row.exception = EXCEPTIONS[name];
  else if (!ok(lic)) failures.push(`${name}: ${lic}`);
  rows.push(row);
}
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build", "npm-licenses.json"), JSON.stringify(rows, null, 2) + "\n");
const summary = {};
for (const x of rows) summary[x.license] = (summary[x.license] ?? 0) + 1;
console.log(`[licenses] ${rows.length} packages scanned`, JSON.stringify(summary));
if (failures.length) {
  console.error("[licenses] NOT ALLOWED:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("[licenses] OK (exceptions:", Object.keys(EXCEPTIONS).length + ")");
