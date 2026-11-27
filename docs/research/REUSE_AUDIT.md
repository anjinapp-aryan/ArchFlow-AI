# ArchFlow AI — Phase 0 Reuse Audit

Audit date: 2026-11-25 (all repository state is as of this date). Clones live in `research/upstream/` (shallow, depth 50, so "commit count" below is a lower bound except where stated). Upstream source trees were not edited; side-effects of installs/builds are listed in `BASELINE_TEST_RESULTS.md` §Upstream hygiene. Evidence for every claim of "ran" is in `BASELINE_TEST_RESULTS.md`; anything I did not execute is labeled **not run**.

Decision key: REUSE (take as a dependency/binary), ADAPT (copy/modify code with attribution), REFERENCE (read for ideas, no code), REJECT.

## 0. Summary

| # | Repo (as given) | Reality | Decision |
|---|---|---|---|
| 1 | omkamal/animated-diagrams-skill | Claude Code *skill*: an LLM writes SVG + **GSAP JavaScript**, rendered via HyperFrames. Excellent output, wrong trust model, GSAP license, Windows-fragile scripts. | **REFERENCE** (+ **REJECT** its GSAP runtime) |
| 2 | codeRATny/AnimatedDiagrams | C++23/Qt6 app + Qt-free engine + headless CLI + MCP server. Models *exactly* our domain (messages along edges, node states, timers, retry/timeout/fallback). Structured JSON scenarios. | **REUSE** (foundation, as pinned binary/CLI; fork-ready) |
| 3 | hyperframes/hyperframes | **README-only stub, no license, no code.** Real project is heygen-com/hyperframes (Apache-2.0, very active). | URL: **REJECT**. Real project: **REFERENCE** now, conditional **ADAPT** later as optional render backend |
| 4 | xyflow/xyflow | Mature node-graph UI library (MIT). No animation engine, no video export. | **REUSE only if/when we build a web editor** (Phase 2+); not needed for Phase 1 |
| 5 | mermaid-js/mermaid | Mermaid parser/renderer (MIT). Input format, not an animation tool. | **REFERENCE** (syntax spec; AnimatedDiagrams already embeds a Mermaid parser) |
| 6 | drawcms/drawcms | Animated-diagram editor, **AGPL-3.0** + GSAP. | **REJECT** (code) / do not copy |
| 7 | PrashobhPaul/CogniFlow | TS/React/xyflow browser studio (MIT); NL→graph compiler, draw.io/Mermaid import, SMIL/GIF/MP4/PPTX export. Very young; loop-only animation; weak auto-layout in my run. | **ADAPT** (selected modules: graph schema, validators, NL rule compiler, VLM-candidate validator) |

**Single best foundation: AnimatedDiagrams.** Reasons: only candidate that natively models timed request/response/retry/error/timeout steps and node states, seekable deterministic playback, and exports GIF/MP4/WebM/HTML/PPTX headlessly; scenarios are plain validated JSON (principle 6); MIT; no GSAP; byte-identical repeat renders in my test. Caveats are material and stated below (maturity, C++/Qt stack, missing input formats, notice gaps).

---

## 1. omkamal/animated-diagrams-skill

| Item | Finding |
|---|---|
| License | Apache-2.0, `NOTICE` present. Bundled GSAP is separate (class C). |
| Maturity | Created 2026-06-12; 7 commits (full history in the clone); 54 stars; 0 open issues; no GitHub releases; no CI workflows. Last commit 2026-06-12. Single author. |
| What it is | A Claude Code skill (`SKILL.md`, `references/*.md`, `scripts/*`). The *LLM* authors a semantic SVG scene and an inline GSAP timeline; scripts render with HyperFrames → MP4/GIF/SVG, and inline a single-file HTML player (play/pause/scrub). |
| Animation implementation | GSAP timeline `paused:true` registered on `window.__timelines`; HyperFrames seeks it frame by frame. DrawSVG for edge draw-on, MotionPath for packets, 6-pattern camera rig, 12 style presets, RTL/Arabic, SRT voice-over sync. |
| Inputs | Natural-language description; it *tells the LLM* to accept PNG/SVG/Mermaid/PlantUML — conversion is done by the LLM in context, not by code. `svg_prep.py` exists for SVG. No parser. |
| Outputs | MP4 (h264), GIF (ffmpeg palettegen), static SVG, interactive HTML (104 KB for my benchmark), WebM, PNG sequence. |
| Interactive playback | Play/pause + scrub bar only (no speed control found in `inline_html.mjs`; I did not read the full file). |
| Tests/CI | None in repo. |
| Install reproducibility | `npm ci` works (171 packages, 15 s, lockfile present). `scripts/setup.sh` **fails on Windows** three ways (see baseline): `python3` resolves to the Microsoft Store stub; Python `read_text()` without encoding crashes on cp1252; `render.mjs` `spawnSync` of the extensionless `.bin/hyperframes` returns exit null. All workable with workarounds, none upstream-fixed. |
| Known limitations (from its own docs/behavior) | Animated SVG file is deliberately *static* (GSAP can't run standalone in SVG). Pinned `hyperframes@0.6.91` (stale vs 0.9.94, no license metadata). `inline_html.mjs` fails if `renders/` doesn't exist. |
| Fit | The output quality of its shipped example is the best I saw (see contact sheet). But **an LLM emitting unrestricted JS violates principle 6**, GSAP violates the FOSS requirement, and nothing is deterministic *about the authoring* (only the render). |
| What is worth taking | Determinism rules (no `Date.now`/`Math.random`/CSS-transition animation; all motion on a seekable timeline), "contact-sheet" visual QA loop, `render.mjs --probe` (duration sanity), camera-rig patterns for big diagrams, style-preset concept, GIF palette recipe, mandatory verification checklist. These are *ideas/recipes* → REFERENCE. |

## 2. codeRATny/AnimatedDiagrams

| Item | Finding |
|---|---|
| License | MIT. Copyright "Animated Diagrams contributors". |
| Maturity | Created 2026-07-17; 29 commits on `main` (full count, shallow clone saw all 29); 5 stars; 0 open issues; releases v2.1.0 (2026-10-09) and v2.2.0 (2026-10-12, "Latest"). `main` last commit 2026-10-12. A feature branch `feature/multi-agent-workspace` was pushed 2026-11-15; its latest CI run **failed**, the previous one passed. Single-maintainer-looking; docs partly Russian (`docs/file-format.md`, `README.ru.md`, a `.ru.json` sample). **Young: treat as a fork-and-own candidate, not a stable ecosystem dependency.** |
| Architecture | `ad_core` (Qt-free C++23: model, JSON v3, geometry, engine, timeline; compiles to WebAssembly) + importers (draw.io; Mermaid via `merman` Rust) + exporters (libav GIF/WebM/MP4, PPTX via libzip+pugixml, HTML player, Mermaid, PNG sequence) + MCP server + Qt Widgets GUI. `src/` logic is unit-tested (GoogleTest; 35 `*Test.cpp` files in `tests/`) with export smoke tests. |
| Animation model | **Every frame is a pure function of (document, time)** (README). Steps: `message` (variants request/response/retry/error/success/event; packet shapes; packetCount streams; trail), `state` (down/active/success…), `timer`, `note`, `effect`, edge animations, keyframes; templates for retries, timeout+fallback, pub/sub, cache-aside; markers/chapters. |
| Inputs | Its JSON v3, draw.io (`DrawioImporterTest.cpp`), Mermaid `flowchart` and `sequenceDiagram` (README says sequenceDiagram → animation), plugins. **No PNG/JPG import, no PlantUML, no raw SVG import** (nanosvg is used for shape outlines/paths) — verified by README/format list; I did not test a draw.io import. |
| Outputs | GIF (single palette), WebM (VP9/AV1), MP4 (H.264), PPTX (video, GIF, **native editable shapes with PowerPoint animations**, Morph keyframes), interactive HTML player (engine compiled to WASM), Mermaid/Markdown, PNG sequence. All exercised by me except PPTX and PNG sequence (**not run**). |
| Interactive playback | HTML player: prev / play-pause / next / position slider with marker ticks / loop; keyboard; `postMessage` API (`play`, `pause`, `toggle`, `seek`, `next`, `prev`, `restart`) ; query options autoplay/loop/controls/t/speed (speed clamped 0.1–8). Verified with headless Chrome: slider seek and message seek change rendered state; no page errors. |
| Tests/CI | `ci.yml` (Windows installer test script present, Linux packages). Upstream test suite **not run** (no cmake/Qt/vcpkg/Rust here → blocker, recorded). |
| Install reproducibility | Source build needs cmake 3.27+, Qt 6.8, vcpkg, FFmpeg SDK, Rust 1.95+, Emscripten (for HTML player). Heavy on Windows. Release binaries exist (zip 93 MB, exe, deb, rpm) with `SHA256SUMS.txt`; I verified the zip's SHA-256 against that file (integrity only; no signature/attestation was checked). |
| Headless | `animated-diagrams --export out.{gif,mp4,webm,html,pptx,md} in.{json,mmd,drawio?}` works **without a display** on Windows (ran it). `--mcp` stdio/HTTP server exists (**not run**). |
| Windows/browsers | Windows 11 OK (ran release). HTML player runs in headless Chrome 131; Safari/Firefox **not tested**. |
| Limitations/risks | (1) Young, single maintainer, bus factor. (2) CLI is the *Qt app binary* (≈93 MB zip with Qt DLLs), not a slim CLI — a custom `ad_core`-only CLI would need a source build. (3) No image/PlantUML input. (4) Output resolution is document-bound (my benchmark rendered 1148×418; `--scale` exists). (5) Third-party notices incomplete (Qt/FFmpeg missing). (6) Determinism proven only same machine, same binary; the H.264 encoder is chosen by a runtime fallback chain, so cross-machine byte equality is **not** guaranteed. (7) Node `kind`s: I used generic `service`/`db`; the bundled "Data platform" plugin (Kafka/PostgreSQL icons) was **not** exercised. |
| Integration complexity | **Low** as an external process (JSON in → media out). **Medium–high** if we need to extend C++ or build from source on Windows. |

## 3. HyperFrames

### 3a. `hyperframes/hyperframes` (the URL in the brief)

Created 2026-07-03, 2 commits, 10 stars, 0 issues, one `README.md` (SEO-style marketing prose referencing GitHub/docs URLs), **no LICENSE file, no source, GitHub license field null**. It is not a usable project. **REJECT.** Do not link, vendor, or cite it as upstream.

### 3b. `heygen-com/hyperframes` (the actual project, audited instead)

| Item | Finding |
|---|---|
| License | Apache-2.0 (repo + all `packages/*` I checked); `CREDITS.md` lists MPL-2.0 `mediabunny` (studio only), GSAP "not an OSI open-source licence" (catalog blocks). |
| Maturity/activity | Created 2026-03-10; 89,894 stars; 325 open issues; releases essentially **daily** (v0.9.92–0.9.94 all on 2026-11-25; commit 2026-11-25). Pre-1.0 and churning — API stability is not promised. Large monorepo: 17 packages (core, engine, producer, player, cli, studio, lint, parsers, aws-lambda, gcp-cloud-run, …). Extensive CI workflows (render, Windows render verification, Safari player, CodeQL, perf). |
| Architecture | HTML composition + data attributes → headless Chrome (Puppeteer) frame-by-frame seek → FFmpeg. **Frame adapters** (`packages/core/src/adapters/`: GSAP adapter implemented; docs say CSS, WAAPI, Lottie, Three.js, Anime.js, custom) — GSAP is *optional*. |
| Existing animation | None for architecture diagrams. It is a *renderer/runtime*; you bring the animation. |
| Inputs/outputs | HTML/CSS/JS compositions → MP4, WebM/MOV with alpha, GIF, PNG sequence. Player web component (`@hyperframes/player`). |
| Diagram import | None. |
| Interactive playback | Yes (studio + player package). Not evaluated beyond the skill's single-file player. |
| Install | `bun install --frozen-lockfile`: 724 packages, 137 s OK. Published CLI `hyperframes` runs under Node 24 on Windows via `hyperframes.cmd`; `doctor` passes except Docker (not needed). Downloads Chrome headless shell on first use. |
| Tests | `core` unit suite via vitest: after building only `@hyperframes/parsers`, **6933 passed, 7 failed, 52 skipped; 23 of 347 files failed** (failures: unresolved sibling packages `@hyperframes/lint`, `@hyperframes/studio-server`, generated `runtime-inline`, plus 2×5 s timeouts). First attempt with nothing built: 2652 pass / 19 fail / 190 files failed. I did not complete a full monorepo build, so the suite is **not shown green**. |
| Rendering evidence | Skill example (1080p, 14 s) rendered in 12.9 s; my 16 s benchmark in 14.9 s; two renders of the same composition gave identical per-frame MD5s and identical file SHA-256. |
| Limitations | Chrome + FFmpeg + Node/Bun runtime (heavy for an end-user tool); churn; GSAP drift in examples; 325 open issues. |
| Fit | Good as an **optional second backend** if we ever want pixel-rich HTML/SVG scenes (e.g., custom themes) rendered to MP4. Overkill as the primary path when a native engine already encodes video. |

## 4. xyflow/xyflow (React Flow / Svelte Flow / Vue Flow)

| Item | Finding |
|---|---|
| License / maturity | MIT; created 2019-07-15; 39,147 stars; 134 open issues; releases on 2026-11-23 (`@xyflow/svelte@2.0.3`, `@xyflow/vue@2.0.3`); commit 2026-11-23; CI includes Playwright/Cypress e2e, CodeQL. |
| What it gives | Interactive node/edge canvas (pan/zoom/drag, custom nodes/edges, minimap), `@xyflow/system` core. |
| Animation | None built in. Community pattern = custom edge with SVG `<animateMotion>` (I did not find such an example in this repo's `examples/` — grep for `animateMotion` returned nothing). CogniFlow shows the pattern built on top. |
| Import/export | None for draw.io/Mermaid/PNG; `toObject`/JSON only. |
| Tests | `@xyflow/system` unit tests: 13 passed (2 files). React/Svelte/Vue Playwright/Cypress e2e **not run**. Install: `pnpm@12.21.0 install --frozen-lockfile` OK (~2 min). |
| Fit | A UI substrate, not an animation engine. Adopt only if we build a browser editor/viewer (Phase 2+). |

## 5. mermaid-js/mermaid

| Item | Finding |
|---|---|
| License / maturity | MIT; created 2014; 91,247 stars; 1,988 open issues; very active (commit 2026-11-23; releases 2026-11-03/13). |
| Role | Parser/renderer for flowchart/sequence/etc. Input format for us, not an animator. No animation/export of video. |
| Tests | Subset run: flowchart + sequence diagram vitest → **1299 passed, 3 skipped, 31 files**. Full suite, lint, e2e/Playwright **not run**. Install: `pnpm@10.30.3 install --frozen-lockfile` OK (~2 min; pulls `canvas`, `cypress`, `puppeteer` for test infra). |
| Fit | Use as a **syntax authority** and optional validator/layout. For Mermaid → animation, AnimatedDiagrams already embeds `merman` (Rust). Mermaid's layout in the browser requires a DOM, so Node-side use needs jsdom/headless Chrome. |

## 6. drawcms/drawcms

| Item | Finding |
|---|---|
| License | **AGPL-3.0-only** + commercial option, CLA, TRADEMARKS. |
| Maturity | Created 2026-09-05; 52 commits (shallow); 48 stars; 13 open issues; release v0.17.2 (2026-09-19), editor 0.20.0 (2026-09-24). Latest CI run (2026-10-23) **failed**. |
| What it is | Next.js 16 / React editor with animated connectors, WebMCP for agents, GIF export (`gif.js`), `mp4-muxer`, draw.io importer (`src/editor/io/drawio`). Uses GSAP 3.14.2. |
| Tests | `npm ci` (772 packages, 69 s) + `vitest run`: **555 passed / 56 files, 14 s**. Build/lint/e2e **not run**. |
| Fit | Product space matches, but AGPL + GSAP + CLA make it unusable as a base for a permissive-licensed product. **REJECT code.** Its UX (narrated step order, agent tool surface) can inform our own design only through public docs, not code reading. |

## 7. PrashobhPaul/CogniFlow

| Item | Finding |
|---|---|
| License | MIT. |
| Maturity | Created 2026-09-02; 24 commits; 0 stars; 0 issues; no releases; last commit 2026-09-04 (README/branding); **Dependabot runs failing** on every recent date (2026-10-27 … 2026-11-03). Single developer (a merged PR comes from a `claude/...` branch). Treat as a prototype. |
| Architecture | Vite + React 19 + TanStack Router + `@xyflow/react` + zustand + Radix/Tailwind. Domain code in `src/lib/studio/`: `air.ts` (graph schema + validators + hash), `compiler.ts` (rule-based NL→graph), `mermaid.ts`, `drawio.ts`, `layout.ts`, `scene.ts`/`story.ts`, `render/{svg,gif,video,pptx,frames,motion,icons3d}.ts`, `ai/` (Transformers.js worker, prompts, candidate validation), `mcp/` (MCP server). Headless Node-safe API in `headless.ts`. |
| Animation | SMIL (`animateMotion`/`animateTransform`) loop in exported animated SVG (6 s loop); offline frame painter feeding `gifenc`; WebCodecs + `mp4-muxer` / `webm-muxer` for MP4/WebM; PPTX storyboard. **No timeline/scenario model with seek or step timing in the exported SVG.** Failure/retry is represented via edge semantic type/node status badges, not a scripted sequence. |
| Inputs | NL text (rule compiler), draw.io (DOMParser → browser-only), Mermaid flowchart, AIR JSON, image + instructions via SmolVLM (browser ONNX; not run). |
| Outputs | Animated SVG, GIF, MP4/WebM (browser APIs), PPTX, PNG/JPEG/SVG, AIR JSON, draw.io, Mermaid. I exercised only the headless API: AIR, Mermaid, draw.io, static SVG, animated SVG. **GIF/MP4/WebM/PPTX export were not run** (browser-only). |
| Tests/CI | 19 tests in one file (`tests/headless.test.ts`), **all pass** under Bun 1.4.5; `tsc --noEmit` clean; `vite build` OK (935 ms). CI: Pages deploy + release workflows run `bun test`. |
| Install reproducibility | Lockfile is `bun.lock`; I used `npm install` (no lock) → resolved versions may differ (e.g., `@xyflow/react` resolved to 12.12.1 vs `^12.11.5`). npm install created an untracked `package-lock.json` and the build re-generated `routeTree.gen.ts`. |
| Quality finding | On my 7-node/10-edge benchmark: layout was one cramped horizontal row with overlapping edge labels; semantic edge classification was wrong for several edges ("validate token"→stream, "authorized"→control, "consume"/"ack"/"201 Created"→request). Unit tests cover its own samples but not these phrasings. I did not open the studio UI; the editor may lay out better than the headless path. |
| Fit | Useful **parts**: AIR schema + validator, candidate→graph validation for model output ("model only proposes; nothing is executed"), draw.io/Mermaid serializers, brand-neutral icon set. As a whole it is not a stable foundation. |

---

## 8. Reuse-vs-build map for the project requirements

| Requirement | Best existing piece | Original code needed |
|---|---|---|
| Packets along existing arrows, request/response direction, retries, failures, timeouts, fallback | AnimatedDiagrams engine (`message`/`state`/`timer`/`effect` steps) | Scenario *authoring* from text/diagram semantics (LLM → JSON) |
| Highlight active components | AnimatedDiagrams `state`/`effect` | none |
| Parallel flows | AnimatedDiagrams (steps overlap in time; verified) | none |
| Play/pause/seek/speed | AnimatedDiagrams HTML player (speed via option 0.1–8; seek verified) | In-player speed *control UI* if desired |
| Interactive HTML | AnimatedDiagrams `--export x.html` | none |
| MP4 / GIF / WebM | AnimatedDiagrams `--export` | Codec policy (WebM default) |
| draw.io import | AnimatedDiagrams importer (`DrawioImporter.cpp` reads `mxGeometry` and ancestor offsets; containers are skipped as nodes — **not run by me**, fidelity to be tested in Phase 1) | Edge-case/fidelity testing |
| Mermaid import | AnimatedDiagrams (`merman`) ; mermaid-js as reference | Mapping Mermaid shapes → node kinds |
| SVG import | none turnkey | **Small SVG→document importer** (shapes/paths/text → nodes/edges) |
| PNG/JPG import (preserve layout) | none turnkey | **Vision pipeline** (VLM/OCR → node boxes + edge polylines) + "overlay-on-original-raster" mode (**needs a Phase 1 feasibility spike**; not shown to exist) |
| PlantUML import | none | Parser choice undecided (see LICENSE_AUDIT §4) |
| Text description → diagram | CogniFlow's rule compiler (ADAPT) + LLM | Prompt + JSON-schema validation |
| AI safety (structured data only) | AnimatedDiagrams JSON v3 + CogniFlow's `candidate.ts` pattern | Schema + validator + sanitizer |
