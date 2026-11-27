# ArchFlow AI — Renderer Strategy (P1.0 outcome)

Status: **proposed, pending your confirmation of the P1.0 GO gate.** Evidence: `docs/research/DEPLOYMENT_FEASIBILITY.md`. This supersedes the Phase 0 plan to run the native AnimatedDiagrams binary as the product renderer; Phase 0 documents are otherwise unchanged except where `PROPOSED_ARCHITECTURE.md` and `DEPENDENCY_DECISIONS.md` are annotated.

## 1. Options evaluated

| Option | Description | Result | Verdict |
|---|---|---|---|
| **A** | Compile the engine core to WebAssembly and run it in the browser | Upstream already provides the Emscripten target; **built from the pinned v2.2.0 revision in 62 s**, ran in Chrome and local workerd, exported a valid VP9 WebM, repeat runs byte-identical | **Chosen** |
| B | Native engine for local/CI rendering, separate renderer for public site | Native CLI works (Phase 0) but would duplicate rendering semantics and keep Qt/FFmpeg obligations | Keep native only as a *dev/reference oracle*, not shipped |
| C | Extract the animation model and write our own small canvas/SVG renderer on the same JSON | Not built; viable because the model is simple, but duplicates a working, tested engine | **Fallback**, triggered only if the engine core becomes unmaintainable |
| D | Reject the engine | Not warranted: MIT, Qt-free core, WASM proven | Rejected |

Why not "just write C": principle 2 (don't reinvent the engine) and measured evidence that A works.

## 2. Target architecture (browser-first)

```
 user diagram / text ─► importers (TypeScript, in browser or Node)
                               │
                               ▼
                    Canonical ArchFlow model (renderer-independent, versioned, Zod/Ajv-validated)
                               │      ▲
          scenario synthesizer │      │ validator (unknown refs, ordering, retries …)
                               ▼      │
                    renderer adapter  (pure function; rejects unsupported features)
                               │
                               ▼
                AnimatedDiagrams document JSON v3  ──►  WASM engine (ad_engine, pinned rev, built in CI)
                                                           │ display list
                                                           ▼
                                           canvas player ─► play/pause/seek/step/speed
                                                           │
                                                           ▼
                                  WebCodecs VP9 + webm-muxer ─► .webm (MP4 best-effort if H.264 encoder exists)
 hosting: Cloudflare Workers Static Assets (no Worker code required for MVP)
```

Key points:
1. **Canonical model ≠ engine format.** ArchFlow's canonical JSON is ours (nodes, edges with direction/arrowheads/geometry, timed events, flow IDs, retries, timeouts, responses). The adapter maps it to AnimatedDiagrams document v3. If the engine must be swapped (Option C, HyperFrames, anything else), only the adapter and renderer change. (Satisfies P1 question 9.)
2. **Engine = pinned, built from source.** CI builds `player/` with Emscripten from commit `3ce17fc3be7cacdb6b65dce362c86674043a4baa` (v2.2.0), records the resulting hash, and fails on drift. Only nlohmann_json (MIT) and nanosvg (zlib) are compiled in, both fetched by upstream with SHA-256 pins.
3. **Importers are ours.** The native importers (draw.io via pugixml/zlib, Mermaid via Rust `merman`) are not in the WASM engine. We write TypeScript importers for Mermaid and draw.io (ADAPT CogniFlow's MIT parsers where they hold up; re-test on our corpus) and later SVG/raster/PlantUML per spikes P1.6–1.8.
4. **No server-side rendering**, no Qt, no FFmpeg in the product. WebM export happens on the user's device. Nothing is uploaded by default.
5. **No GSAP anywhere** (verified: zero references in the engine/player sources).
6. **AI** (optional, later) outputs canonical-model JSON only, validated before the adapter runs.

## 3. Open engineering items for P1.2 (not yet proven)

| Item | Why it matters | Plan |
|---|---|---|
| Player control surface: step and speed controls, programmatic seek without rAF waits | PoC export runs ≈ real time; step/speed requested | Call the engine's exported functions (`_ad_player_load/_build/_frame`) directly from our own thin TS wrapper instead of the bundled `player.js`, **or** patch via fork. Decide after reading `player.js` API surface; keep upstream diff minimal |
| Golden-frame tests | Encoder-independent determinism | Render canvas frames at fixed times in headless Chrome, hash PNG/pixel buffers; pin Chrome version; accept small tolerance only if exact equality fails across platforms |
| Engine JSON v3 schema | Adapter must reject unsupported features | Derive from `Io/JsonIo` + `docs/file-format.md` (partly Russian) and write our own English schema doc |
| Mermaid/draw.io in the browser | Missing from WASM | P1.3 corpus; decide parser reuse vs. own |
| WebCodecs availability | Safari/Firefox not verified | Detect and fall back to MediaRecorder; report format support in UI |
| CSP for WebAssembly | Hardened headers | Serve with a CSP that allows `wasm-unsafe-eval`; test |

## 4. Fork policy

Do not modify the upstream clone. If a patch is required (e.g., exposing stepping/speed), maintain it as a **patch file applied in CI to the pinned revision** (or a fork), keep it under MIT with attribution, and file the same change upstream.

## 5. Licenses introduced by this strategy (summary; full detail in `DEPENDENCY_DECISIONS.md`)

Shipped in the page: engine C++ (MIT) + nlohmann_json (MIT) + nanosvg (zlib) + Emscripten runtime (MIT/NCSA) + libc/libc++ from the Emscripten sysroot (MIT / Apache-2.0 w/ LLVM exception — **to be confirmed from the sysroot's license files in P1.1**) + webm-muxer (MIT). Build-time only: emsdk/LLVM, CMake, Ninja. Dev-only: wrangler (MIT OR Apache-2.0), workerd (Apache-2.0), puppeteer-core (Apache-2.0), headless Chrome (redistribution unverified; never shipped). **Qt, FFmpeg, GSAP: not in the product.**


---

## 6. P1.1 status (2026-11-25)

Implemented per this strategy: pinned reproducible WASM build (`scripts/build-engine.mjs`, `engine/upstream.lock.json`), `@archflow/engine-host` (typed wrapper over the engine's `ad_player_*` exports, deterministic text metrics, player-template filler), `@archflow/canonical-model`, `@archflow/renderer-adapter`, and golden-frame infrastructure (`@archflow/qa`). Deliberately not implemented yet: playback controls beyond seek, canvas drawing of the display list by ArchFlow code (the QA harness drives the upstream player via `postMessage`), WebM export in product code, importers.

Two corrections/clarifications to §5: (1) libc++ contributes headers only; no libc++/libc++abi archive is linked (see `licenses/ENGINE_LINK_INPUTS.txt`). (2) The engine normalises invalid documents silently (an unknown-node reference simply deletes the step), proven by a test; the adapter/validator is therefore the only line of defence and must stay strict.
