#!/usr/bin/env node
// Minimal local static server for apps/web/dist that applies dist/_headers exactly as
// Cloudflare Static Assets would (path patterns `/x`, `/dir/*`, `/*`). Local preview and e2e
// tests only; binds to 127.0.0.1. Usage: node scripts/serve-web.mjs [port]
//
// `GET /api/instructions/stats` reports per-provider attempts, success rate and latency of this
// process (names and numbers only).
// It also serves `POST /api/instructions` (one line -> architecture instructions through the LLM
// provider configured in ArchFlow's own `.env.local`). The provider call and its key stay in this
// process; the static production build has no such endpoint and the page says so.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  PROMPT_LIMITS,
  createProviderStats,
  handleInstructionsRequest,
  readLlmConfig,
} from "../packages/llm-instructions/src/index.ts";

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

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * ArchFlow's own environment: `.env.local` at the repository root (git-ignored), overridden by
 * real environment variables. Nothing outside this repository is read.
 */
export function loadLocalEnv(file = join(repoRoot, ".env.local")) {
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return { ...fromFile, ...process.env };
}

// Usage limits for the paid provider: one conversion at a time, at most 30 per 10 minutes.
const RATE = { windowMs: 10 * 60_000, max: 30 };

function apiHandler(port, llm) {
  const config = readLlmConfig(llm.env ?? loadLocalEnv());
  const stats = createProviderStats();
  let busy = false;
  const recent = [];
  const send = (res, status, body, rules) => {
    for (const r of rules)
      if (matches(r.pattern, "/api/instructions"))
        for (const [k, v] of r.headers) res.setHeader(k, v);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const err = (code, message) => ({ ok: false, code, message });
  return (req, res, rules, pathname) => {
    // only this page may call it: same host (no DNS rebinding), same origin, JSON (forces a
    // CORS preflight from any other site, which is never answered)
    const host = req.headers.host ?? "";
    const own = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    if (!own.includes(host)) return send(res, 403, err("http.host", "Forbidden host."), rules);
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`)
      return send(res, 403, err("http.origin", "Cross-origin requests are refused."), rules);
    if (pathname === "/api/instructions/stats") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return send(res, 405, err("http.method", "Use GET."), rules);
      }
      return send(
        res,
        200,
        {
          ok: true,
          configured: config.ok,
          order: config.ok ? config.config.routes.map((r) => `${r.id}/${r.model}`) : [],
          timeoutMs: config.ok ? config.config.timeoutMs : null,
          providers: stats.snapshot(),
        },
        rules,
      );
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, err("http.method", "Use POST."), rules);
    }
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? ""))
      return send(res, 415, err("http.type", "Send application/json."), rules);
    const now = Date.now();
    while (recent.length && now - recent[0] > RATE.windowMs) recent.shift();
    if (busy || recent.length >= RATE.max)
      return send(
        res,
        429,
        err(
          "llm.busy",
          busy ? "A conversion is already running." : "Too many conversions; wait a few minutes.",
        ),
        rules,
      );

    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > PROMPT_LIMITS.maxBodyBytes) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", async () => {
      if (tooBig) return send(res, 413, err("input.too_long", "Request too large."), rules);
      busy = true;
      recent.push(Date.now());
      const ctrl = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) ctrl.abort();
      };
      res.on("close", onClose);
      const started = Date.now();
      try {
        const r = await handleInstructionsRequest(Buffer.concat(chunks).toString("utf8"), {
          config,
          signal: ctrl.signal,
          stats,
          ...(llm.fetch ? { fetch: llm.fetch } : {}),
        });
        // one log line: outcome and timing only (never the prompt, the reply or credentials)
        const tries = (r.body.attempts ?? [])
          .map((a) => `${a.provider} ${a.outcome} ${a.ms} ms`)
          .join("; ");
        if (!llm.quiet)
          console.log(
            `[llm] ${r.status} ${r.body.ok ? `${r.body.provider} ${r.body.model}` : r.body.code} ${Date.now() - started} ms${tries ? ` (${tries})` : ""}`,
          );
        send(res, r.status, r.body, rules);
      } catch {
        send(res, 500, err("llm.internal", "The conversion failed unexpectedly."), rules);
      } finally {
        busy = false;
        res.off("close", onClose);
      }
    });
  };
}

/**
 * options.llm: { env?, fetch?, quiet? } - tests inject an environment and a mock fetch so no
 * provider is ever called from CI.
 */
export function startServer(port = 0, options = {}) {
  if (!existsSync(join(root, "index.html")))
    throw new Error("apps/web/dist is not built (npm run web:build)");
  const rules = parseHeaders(readFileSync(join(root, "_headers"), "utf8"));
  let server;
  const api = apiHandler(() => server.address().port, options.llm ?? {});
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/instructions" || url.pathname === "/api/instructions/stats")
      return api(req, res, rules, url.pathname);
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
