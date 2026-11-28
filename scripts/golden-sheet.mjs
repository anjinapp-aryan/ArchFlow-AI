#!/usr/bin/env node
// Contact sheets of the recorded pixel goldens, for review and approval.
//
//   npm run golden:sheet                          every golden case, this environment
//   npm run golden:sheet -- --case aws-alb        one case
//   npm run golden:sheet -- --case aws-alb --times 0,7100,11400
//   npm run golden:sheet -- --env win32-x64-chrome158 --out some/dir
//
// Writes <out>/<case>-<env>.png (default out: artifacts/contact-sheets, git-ignored). Reads the
// goldens only; never writes into fixtures/. Needs Chrome (the same one the QA tests use).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = {
  cases: [],
  times: undefined,
  env: undefined,
  out: resolve(root, "artifacts", "contact-sheets"),
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => {
    const v = args[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    return v;
  };
  if (a === "--case") opt.cases.push(next());
  else if (a === "--times")
    opt.times = next()
      .split(",")
      .map((s) => Number(s.trim()));
  else if (a === "--env") opt.env = next();
  else if (a === "--out") opt.out = resolve(next());
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (opt.times?.some((t) => !Number.isFinite(t))) {
  console.error("--times takes comma-separated milliseconds, e.g. 0,7100");
  process.exit(2);
}

// The QA package is TypeScript inside the workspace: bundle the parts needed, then import them.
const cache = resolve(root, "artifacts", ".cache");
mkdirSync(cache, { recursive: true });
const bundled = resolve(cache, "golden-sheet.mjs");
await build({
  stdin: {
    contents: `export { GOLDEN_CASES, goldenSheetSource, renderContactSheet, launch } from "./packages/qa/src/index.ts";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundled,
  external: ["puppeteer-core"],
  logLevel: "silent",
});
const qa = await import(pathToFileURL(bundled).href);

const { browser, envId } = await qa.launch();
try {
  const env = opt.env ?? envId;
  const cases = opt.cases.length > 0 ? opt.cases : qa.GOLDEN_CASES.map((c) => c.id);
  mkdirSync(opt.out, { recursive: true });
  for (const id of cases) {
    const src = qa.goldenSheetSource(root, id, env, opt.times);
    const png = await qa.renderContactSheet(browser, src.spec);
    const file = resolve(opt.out, `${id}-${env}.png`);
    writeFileSync(file, png);
    console.log(`${file}  (${src.spec.frames.length} frames)`);
  }
} finally {
  await browser.close();
}
