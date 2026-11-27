#!/usr/bin/env node
// Production build of the web app into apps/web/dist (static files for Cloudflare Workers
// Static Assets or any static host). Deterministic: content-hashed asset names, no timestamps.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(here, "dist");
const assets = join(dist, "assets");
const hash8 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

const engineSrc = join(root, "build", "engine", "ad_player_engine.js");
if (!existsSync(engineSrc)) {
  console.error(
    "[web] missing build/engine/ad_player_engine.js - run `npm run engine:build` first",
  );
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(assets, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  write: false,
  legalComments: "none",
  logLevel: "warning",
  target: "es2022",
};
const js = await build({
  ...common,
  entryPoints: [join(here, "src", "main.ts")],
  format: "iife",
  loader: { ".txt": "text", ".mmd": "text", ".drawio": "text", ".puml": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const css = await build({ ...common, entryPoints: [join(here, "src", "styles.css")] });
const appJs = js.outputFiles[0].contents;
const appCss = css.outputFiles[0].contents;
if (/\beval\(|new Function\(/.test(Buffer.from(appJs).toString("utf8"))) {
  console.error("[web] the app bundle contains eval/new Function - refusing to build");
  process.exit(1);
}
const engine = readFileSync(engineSrc);
const files = {
  APP: `assets/app-${hash8(appJs)}.js`,
  CSS: `assets/app-${hash8(appCss)}.css`,
  ENGINE: `assets/engine-${hash8(engine)}.js`,
};
writeFileSync(join(dist, files.APP), appJs);
writeFileSync(join(dist, files.CSS), appCss);
writeFileSync(join(dist, files.ENGINE), engine);

let html = readFileSync(join(here, "index.html"), "utf8");
for (const [k, v] of Object.entries(files)) html = html.replace(`{{${k}}}`, v);
if (/\{\{[A-Z]+\}\}/.test(html)) throw new Error("unfilled placeholder in index.html");
writeFileSync(join(dist, "index.html"), html);
for (const f of readdirSync(join(here, "public")))
  copyFileSync(join(here, "public", f), join(dist, f));

// Licences shipped with the page (the bundle contains MIT/ISC/Zlib/Apache code: notices must travel with it).
const lic = join(dist, "licenses");
mkdirSync(lic, { recursive: true });
copyFileSync(join(root, "THIRD_PARTY_NOTICES.md"), join(lic, "THIRD_PARTY_NOTICES.txt"));
copyFileSync(join(root, "LICENSE"), join(lic, "ArchFlow-LICENSE.txt"));
for (const f of readdirSync(join(root, "licenses")))
  if (f.endsWith(".txt")) copyFileSync(join(root, "licenses", f), join(lic, f));

// Security and caching headers (Cloudflare Static Assets `_headers` format; also used by `npm run web:serve`).
const csp = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");
writeFileSync(
  join(dist, "_headers"),
  `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY

/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
writeFileSync(join(dist, "robots.txt"), "User-agent: *\nAllow: /\n");

const report = Object.fromEntries(
  Object.values(files).map((f) => {
    const b = readFileSync(join(dist, f));
    return [f, { bytes: b.length, gzip: gzipSync(b).length }];
  }),
);
writeFileSync(join(dist, "build-manifest.json"), JSON.stringify(report, null, 2) + "\n");
for (const [f, s] of Object.entries(report))
  console.log(`[web] ${f}  ${s.bytes} B  (${s.gzip} B gzip)`);
console.log(`[web] built ${dist}`);
