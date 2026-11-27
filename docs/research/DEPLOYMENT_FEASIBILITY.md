# ArchFlow AI — P1.0 Deployment Feasibility Spike

Date: 2026-11-25. Question: can the Phase 0 foundation (AnimatedDiagrams v2.2.0) serve a **public, free-tier Cloudflare deployment** with browser-side rendering and WebM export?

**Decision: GO — Option A (WebAssembly build of the engine core, from source), with importers and scenario tooling written in TypeScript.** The native Qt/FFmpeg binary is *not* used in the deployed product. Details, evidence and the remaining gaps are below. Strategy document: `docs/architecture/RENDERER_STRATEGY.md`.

## 1. Evidence summary (everything here was executed unless marked otherwise)

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Can AnimatedDiagrams v2.2.0 run in a browser? | **Yes — the engine core, not the Qt app.** Upstream already ships a browser target: `ad_engine` (Qt-free C++23, deps: nlohmann_json + nanosvg only) compiled with Emscripten into a single-file HTML player (`player/`). | Built from source here (below); ran it in headless Chrome 131 and via local `workerd`. |
| 2 | Is a WASM port feasible? | **Already done upstream; reproduced.** | `emcmake cmake` + `cmake --build` → `player.html` 405,716 B (396 KiB; 172,256 B gzip) in **62 s** on Windows 11 (emsdk 7.0.1 / clang 24.0.0git), exit 0. Exact source revision `3ce17fc3be7cacdb6b65dce362c86674043a4baa` = tag `v2.2.0` (verified with the GitHub API). |
| 3 | What blocks browser execution of the *full* app? | Qt Widgets UI, libav (FFmpeg) export, libzip/pugixml/zlib (PPTX, draw.io import), merman (Rust Mermaid import), file system. All live outside `ad_engine`. `CMakeLists.txt` forces `BUILD_APP=OFF, WITH_LIBAV=OFF, WITH_MERMAID=OFF` under Emscripten and `src/CMakeLists.txt` says "Do not add libav / zip / XML / zlib / file system code" to `ad_engine`. | Source inspection + successful configure/build with those switches. |
| 4 | Can the rendering model be separated from Qt? | **Yes, by upstream design.** The engine produces a flat display list (`Engine/FrameBuffer`, `DisplayList`); JS draws it on a `<canvas>` (`player/player.js`, 711 lines, no GSAP — `grep -ci gsap` = 0). Text is measured by the browser (`measureText`). | Source + run. |
| 5 | Can the JSON scenario format be reused independently of the native renderer? | **Yes.** The same `bench.json` (AnimatedDiagrams document v3) rendered in the native release CLI (Phase 0) and in the WASM player built here. The document is plain JSON; the player loads it from a `<script type="application/json">`. | Phase 0 `benchmark/animated-diagrams/bench.mp4` vs `poc/p10/out/webm-contact.png`: same scenario, same states (Consumer 2 Down → retry → Success, `ack`, etc.). Pixel-level equality between native Qt and browser canvas was **not** tested (different rasterizers/sizes). |
| 6 | Can browser SVG/canvas reproduce packet movement and highlighting without GSAP? | **Yes** — the WASM engine + canvas player does exactly this with no GSAP. I did *not* build an independent SVG/canvas renderer (Option C) because Option A already meets the need. | Contact sheet `poc/p10/out/webm-contact.png`: packets with labels on edges, parallel `consume` packets, Consumer 2 red/"Down" with a yellow `retry` packet, green "Success", `ack`. |
| 7 | Can browser-side rendering export WebM with supported APIs? | **Yes.** WebCodecs `VideoEncoder` (VP9, `vp09.00.10.08`) + `webm-muxer@5.1.4` (MIT) driven frame-by-frame through the player's `postMessage` seek API. 481 frames, 1280×560, 16.000 s, valid VP9/WebM (ffprobe), 1,183,059 B, **16.1 s wall** (≈ real time: the loop waits two `requestAnimationFrame`s per frame). JS heap ≈ 31 MB. | `poc/p10/export-webm.mjs`; `out/bench.webm`. Codec probe in headless Chrome 131: VP9, VP8, AV1 and H.264 `isConfigSupported` all true (**H.264 availability is browser-build dependent; do not rely on it**). |
| 8 | Practical fallback if the native engine can't be deployed? | Not needed. Fallbacks, in order: (B) the same WASM engine + native CLI only for local/CI use; (C) a small TS canvas renderer consuming the same JSON; (D) HyperFrames ≥0.9 server-side (not Cloudflare-compatible; Chrome+FFmpeg). | Reasoned, see strategy doc. Only A was built. |
| 9 | Can a fallback keep the same canonical JSON? | **Yes**, by construction: the canonical model is renderer-independent and mapped by a renderer adapter; AnimatedDiagrams document JSON (format version 3) is the *engine input*, not the canonical model (see strategy). | Design; to be proven in P1.2. |
| 10 | Does it fit Cloudflare free-tier limits? | **Yes for the static, browser-side design.** | See §3. |

## 2. Reproducible build (commands actually run)

Environment: Windows 11, Git Bash. Tools were installed under `research/tools/` (outside the product tree, not global): `pip install --target pylibs cmake ninja` (cmake 4.4.5, ninja 1.13.2), `emsdk` cloned from `emscripten-core/emsdk`, `emsdk install latest && emsdk activate latest` (emcc 7.0.1, node 24.19.0, python 3.13.3; ≈2.1 GB on disk).

```bash
export PYTHONUTF8=1 PATH="<python3 shim dir>:$PATH"      # Windows: python3 resolves to the Store stub (blocker B1 again, emsdk needs it)
source research/tools/emsdk/emsdk_env.sh
export PATH="research/tools/pylibs/bin:$PATH" PYTHONPATH=research/tools/pylibs
emcmake cmake -S research/upstream/AnimatedDiagrams -B research/build/ad-player -G Ninja   # exit 0, 6.7 s
cmake --build research/build/ad-player                                                     # exit 0, 62 s
# fill placeholders with a document, then export
node poc/p10/fill-player.mjs research/build/ad-player/player/player.html bench.json poc/p10/out/bench-player.html
CHROME_EXE=<chrome-headless-shell 131> node poc/p10/export-webm.mjs poc/p10/out/bench-player.html poc/p10/out/bench.webm 30 16000
```

Notes:
- The upstream CMake build downloads its small dependencies with pinned SHA-256: `nlohmann_json` v3.11.3 (`json.tar.xz`, `d6c65aca…757d`) and the `nanosvg.h` header at commit `93ce879d…` (`b0057538…dcc31`). Out-of-tree build; the upstream clone stayed clean (`git status` empty).
- The Closure-minified, `-Oz -flto -fwasm-exceptions`, `DYNAMIC_EXECUTION=0` (no `eval`) engine is a single JS file with the WASM embedded as base64 (`ad_player_engine.js` 375,849 B).
- Build-system blocker: Windows `python3` Store stub again (emsdk install failed with exit 49 until a PATH shim was used).

## 3. Cloudflare free-tier fit

Sources: Cloudflare docs, *Workers limits* (developers.cloudflare.com/workers/platform/limits) and *Static assets billing and limitations* (developers.cloudflare.com/workers/static-assets/billing-and-limitations), retrieved via web search 2026-11-25. Limits can change; the docs pages disagreed on Worker script size (3 MB compressed vs 64 MiB uncompressed) so verify in the dashboard before relying on it.

| Limit (Workers Free) | Value found | Our need | Fit |
|---|---|---|---|
| Static asset files per Worker version | 20,000 | tens | ✅ |
| Max single static asset | 25 MiB | player ≈ 0.4 MB; fixtures/examples small | ✅ |
| Static asset requests | free and unlimited (unless `run_worker_first` routes them through the Worker) | all page loads | ✅ |
| Worker requests/day | 100,000 (only for Worker-executed requests) | none for MVP (no API) | ✅ |
| Worker script size | 3 MB compressed (per main limits page; conflicting 64 MiB elsewhere) | no Worker script needed for MVP | ✅ |

Verified locally (not on Cloudflare): `wrangler@4.168.0` (MIT OR Apache-2.0) + `workerd` (Apache-2.0) served the 408,851-byte page from a Static Assets config (`wrangler.jsonc`, `assets.directory`); loading it from `http://127.0.0.1:8799/` and running the same WebM export produced a file **byte-identical** (SHA-256 `c2ce0a28f880…`) to the `file://` run. **Nothing was deployed to Cloudflare** (no account/credentials used; publishing is out of scope until you authorize it).

D1 and R2: not researched and not required — the product stores nothing by default (Phase 1 constraint). Shared artifacts can be URL-encoded (CogniFlow's `share.ts` shows an MIT pattern) without storage.

## 4. Determinism evidence

| Test | Result |
|---|---|
| Browser WebM export run twice (file://) | decoded-frame MD5 stream identical; file SHA-256 identical (`c2ce0a28f8808d8a…`) |
| Same export through local workerd | file SHA-256 identical to the above |
| Sampled canvas hashes (every 60th frame) across runs | identical; frame 0 and last frame hash equal (idle state) |

Scope: one machine, one Chrome (131 headless-shell), one VP9 encoder build. **Cross-browser/cross-machine byte equality is not claimed**; golden tests must compare decoded/PNG frames from the canvas (Phase 1 P1.2), not WebM bytes.

## 5. Limitations and risks found

1. **Importers are not in the WASM engine.** draw.io (pugixml/zlib) and Mermaid (merman/Rust) importers are native-only. In the browser we must import via TypeScript (adapt CogniFlow's MIT `mermaid.ts`/`drawio.ts` ideas) and emit AnimatedDiagrams JSON. Whether `merman` compiles to wasm32 was **not tested**.
2. **Export speed ≈ real time** with the `requestAnimationFrame`-synchronised loop (16 s for a 16 s clip). Fine for ≤1–2 min clips; larger needs a faster path (call the engine's `ad_player_build` + own canvas draw without rAF) — not attempted.
3. **Player API surface is small and upstream-internal**: seek via `postMessage({type:'ad-player',action:'seek',time})`; speed via URL option. We rely on it; a tiny wrapper may need an upstream patch/fork for stepping and speed controls (Phase 1 P1.2).
4. **Browser coverage**: only headless Chrome 131 was exercised. Firefox/Safari WebCodecs `VideoEncoder` support is not verified; the MediaRecorder fallback (real-time canvas capture) exists in Chrome (`MediaRecorder: function`) but was not tested.
5. **CSP**: engine is built without `eval`, but WebAssembly compilation normally needs `'wasm-unsafe-eval'` under a strict CSP. Not tested.
6. **Bus factor** (5 stars, 29 commits) — unchanged from Phase 0; mitigated because we now build from a pinned revision with only MIT/Zlib deps and could fork the engine core.
7. **Licensing of the WASM artifact**: ships nlohmann_json (MIT) and nanosvg (zlib) code, Emscripten runtime (MIT/NCSA), libc (musl, MIT) and compiler-rt/libunwind (Apache-2.0 w/ LLVM exception) from the Emscripten sysroot; libc++ contributes headers only (corrected in P1.1 from the link map: no libc++ archive is linked). Notices must accompany the distributed page. Upstream's own notices do not cover the WASM bundle; we must write ours (tracked in `DEPENDENCY_DECISIONS.md`). This is a **simpler** obligation set than shipping Qt + LGPL FFmpeg.
8. **Native engine no longer needed in the product.** Qt/LGPL FFmpeg issues from Phase 0 disappear for the deployed app.
9. **Not tested**: Cloudflare account deployment, custom headers, caching, mobile browsers, large diagrams (resource limits — P1 §13 test later), `ad_player_*` memory growth on long scenarios.

## 6. Recommendation

**GO.** Proceed to P1.1 with: pinned upstream revision `3ce17fc3…` (v2.2.0) built to WASM in CI; canonical renderer-independent model + adapter to the engine's JSON; browser-side WebM export as in the PoC; TypeScript importers; static deployment on Cloudflare Workers Static Assets.

Gate for P1.1 entry (needs your confirmation): (a) accept Option A as the renderer strategy, (b) accept that the native Qt/FFmpeg app is dev/reference-only, (c) accept WebM (VP9) as the default export with MP4 best-effort.
