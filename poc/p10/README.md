# P1.0 proof of concept (throwaway; not product code)

Proves: upstream AnimatedDiagrams engine core -> WASM (built from source) -> browser player -> deterministic WebM export via WebCodecs, served from a Cloudflare-style static-assets Worker (local workerd).

Files: `fill-player.mjs` (placeholder filler, mirrors upstream `HtmlPlayer.cpp`), `export-webm.mjs` (frame-exact VP9/WebM export), `codec-probe.mjs`, `cf/wrangler.jsonc` (static assets only), `out/` (results).
Exact commands and results: `docs/research/DEPLOYMENT_FEASIBILITY.md` §2. Dependencies pinned in `package.json` (webm-muxer 5.1.4 MIT, puppeteer-core 25.18.1 Apache-2.0; cf/: wrangler 4.168.0).
Scripts take a Chrome path from `CHROME_EXE` (puppeteer-core downloads no browser).
