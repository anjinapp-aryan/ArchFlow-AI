#!/usr/bin/env node
// Re-run both importers over fixtures/diagrams and rewrite fixtures/diagrams/results.json (the recorded baseline). Review the diff before committing.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitest = resolve(root, "node_modules", "vitest", "vitest.mjs");
const r = spawnSync(
  process.execPath,
  [vitest, "run", "--project", "browser", "packages/importer-eval"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ARCHFLOW_IMPORT_REPORT: "1" },
  },
);
process.exit(r.status ?? 1);
