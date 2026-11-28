#!/usr/bin/env node
// Minimal local static server for apps/web/dist that applies dist/_headers exactly as
// Cloudflare Static Assets would (path patterns `/x`, `/dir/*`, `/*`). Local preview and e2e
// tests only; binds to 127.0.0.1. Usage: node scripts/serve-web.mjs [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ARCHFLOW_DIST serves another copy of the build (e.g. a frozen snapshot for long QA runs)
const root = process.env.ARCHFLOW_DIST
  ? resolve(process.env.ARCHFLOW_DIST)
  : resolve(fileURLToPath(new URL("../apps/web/dist", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function parseHeaders(text) {
  const rules = [];
  let cur;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), headers: [] };
      rules.push(cur);
    } else if (cur) {
      const i = line.indexOf(":");
      cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}
const matches = (pattern, path) =>
  pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

export function startServer(port = 0) {
  if (!existsSync(join(root, "index.html")))
    throw new Error("apps/web/dist is not built (npm run web:build)");
  const rules = parseHeaders(readFileSync(join(root, "_headers"), "utf8"));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad request");
      return;
    }
    const file = normalize(join(root, path === "/" ? "index.html" : path));
    if (
      !file.startsWith(root + sep) ||
      !existsSync(file) ||
      !statSync(file).isFile() ||
      path.includes("_headers")
    ) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    for (const r of rules)
      if (matches(r.pattern, path)) for (const [k, v] of r.headers) res.setHeader(k, v);
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.argv[2] ?? 8788));
  console.log(`[serve] http://127.0.0.1:${server.address().port}/  (Ctrl+C to stop)`);
}
