#!/usr/bin/env node
// Regenerate golden frames for THIS environment. Review the diff (and PNGs) before committing.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitest = resolve(root, "node_modules", "vitest", "vitest.mjs");
const r = spawnSync(process.execPath, [vitest, "run", "--project", "browser"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ARCHFLOW_GOLDEN_UPDATE: "1" },
});
process.exit(r.status ?? 1);
