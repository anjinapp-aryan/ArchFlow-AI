#!/usr/bin/env node
/**
 * Guarded deployment of the ArchFlow web app to Cloudflare Workers Static Assets.
 *
 *   npm run deploy               build apps/web/dist, then `wrangler deploy`
 *   npm run deploy -- --dry-run  build and validate the upload without publishing anything
 *   npm run deploy -- --skip-build  deploy the existing apps/web/dist (used by CI)
 *
 * GitHub Actions deploys main through this script (job "deploy" in .github/workflows/ci.yml).
 * Do not use Cloudflare's own Git integration (Workers Builds): it cannot build the WASM engine,
 * so it fails with "assets.directory ... does not exist".
 *
 * Refuses to run unless wrangler.jsonc names the Worker "app" and pins an "account_id" that is
 * not a known shared account. The workers.dev subdomain is account-wide, so deploying into an
 * account that also hosts another project would publish ArchFlow under that project's name
 * (this happened with the first deployment). After a real deploy it checks
 * that wrangler reported the expected URL.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_NAME = "app";
const EXPECTED_URL = "https://app.archflow-ai.workers.dev";
/** Accounts ArchFlow must never deploy into (id -> reason). */
const FORBIDDEN_ACCOUNTS = {
  "1cbccc5695dac3663f9e6c6dd6f9507e":
    "shared with another project (its workers.dev subdomain is not ArchFlow's)",
};

const dryRun = process.argv.includes("--dry-run");
const skipBuild = process.argv.includes("--skip-build");
const fail = (msg) => {
  console.error(`[deploy] REFUSED: ${msg}`);
  process.exit(1);
};

/** Minimal JSONC: drop // and block comments outside strings, then trailing commas. */
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) fail("unterminated comment in wrangler.jsonc");
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const config = parseJsonc(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
if (config.name !== EXPECTED_NAME)
  fail(`wrangler.jsonc "name" is "${config.name}", expected "${EXPECTED_NAME}".`);
const account = config.account_id;
if (typeof account !== "string" || !/^[0-9a-f]{32}$/.test(account))
  fail(
    'wrangler.jsonc has no "account_id". Set it to the dedicated ArchFlow Cloudflare account ' +
      "(see docs/architecture/DEPLOYMENT.md, migration checklist).",
  );
if (FORBIDDEN_ACCOUNTS[account])
  fail(`account ${account} is ${FORBIDDEN_ACCOUNTS[account]}; ArchFlow must use its own account.`);

/** Run a fixed command (no user input reaches it), capturing stdout. */
const run = (label, r) => {
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) fail(`${label} exited with ${r.status}`);
  return r.stdout ?? "";
};
const opts = { cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] };
/** Exact wrangler version (docs/architecture/DEPENDENCY_DECISIONS.md); not an npm dependency. */
const WRANGLER = "wrangler@4.168.0";

if (skipBuild) {
  // CI deploys the dist it already built and tested (artifact archflow-web-dist)
  if (!existsSync(resolve(root, "apps/web/dist/index.html")))
    fail("--skip-build given but apps/web/dist/index.html does not exist.");
} else run("web build", spawnSync(process.execPath, [resolve(root, "apps/web/build.mjs")], opts));
// npx is a .cmd shim on Windows, so it needs a shell; the command is a constant string
const deployCmd = `npx --yes ${WRANGLER} deploy${dryRun ? " --dry-run" : ""}`;
const out = run(deployCmd, spawnSync(deployCmd, { ...opts, shell: true }));
if (dryRun) {
  console.log(`[deploy] dry run OK for account ${account}; nothing was published.`);
} else {
  const urls = out.match(/https:\/\/[^\s]+\.workers\.dev/g) ?? [];
  if (!urls.includes(EXPECTED_URL)) {
    console.error(
      `[deploy] WARNING: wrangler reported ${urls.join(", ") || "no workers.dev URL"}, ` +
        `expected ${EXPECTED_URL}. Check the account's workers.dev subdomain before announcing.`,
    );
    process.exit(2);
  }
  console.log(
    `[deploy] live at ${EXPECTED_URL}. Next: ARCHFLOW_BASE_URL=${EXPECTED_URL} npm run smoke:live`,
  );
}
