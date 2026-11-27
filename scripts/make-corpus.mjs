#!/usr/bin/env node
// Regenerate fixtures/diagrams/* from packages/importer-eval/src/corpus.ts.
// Needs Node >= 22.18 (native TypeScript type stripping). `--check` fails on drift instead of writing.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS, corpusFiles } from "../packages/importer-eval/src/corpus.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures", "diagrams");
const check = process.argv.includes("--check");
const wanted = new Map();
for (const entry of CORPUS)
  for (const [name, text] of Object.entries(corpusFiles(entry))) wanted.set(name, text);

let drift = 0;
if (!check) mkdirSync(dir, { recursive: true });
for (const [name, text] of wanted) {
  const p = resolve(dir, name);
  const have = existsSync(p) ? readFileSync(p, "utf8") : undefined;
  if (have !== text) {
    drift++;
    if (!check) writeFileSync(p, text);
    else console.error(`drift: ${name}`);
  }
}
for (const f of existsSync(dir) ? readdirSync(dir) : []) {
  if (/\.(drawio|mmd|puml|truth\.json)$/.test(f) && !wanted.has(f)) {
    drift++;
    if (!check) rmSync(resolve(dir, f));
    else console.error(`stale: ${f}`);
  }
}
if (check && drift) process.exit(1);
console.log(`[corpus] ${wanted.size} files, ${drift} ${check ? "drifted" : "written"}`);
