# ArchFlow AI — Phase 0 Project Comparison

Date: 2026-11-25. Scores marked "measured" come from the benchmark in `BASELINE_TEST_RESULTS.md`; "assessed" is my judgment from source/docs; "n/a" means the project does not attempt it; "not run" means I did not execute it. Visual-quality ratings are subjective, from contact sheets saved in `research/benchmark/`.

## 1. Facts at a glance

| | AnimatedDiagrams | CogniFlow | animated-diagrams-skill | HyperFrames (real: heygen-com) | drawcms | xyflow | mermaid | hyperframes/hyperframes (given URL) |
|---|---|---|---|---|---|---|---|---|
| License | MIT | MIT | Apache-2.0 (+GSAP C) | Apache-2.0 | **AGPL-3.0** (+GSAP C) | MIT | MIT | **none** |
| Created | 2026-07-17 | 2026-09-02 | 2026-06-12 | 2026-03-10 | 2026-09-05 | 2019 | 2014 | 2026-07-03 |
| Stars / open issues | 5 / 0 | 0 / 0 | 54 / 0 | 89.9k / 325 | 48 / 13 | 39.1k / 134 | 91.2k / 1,988 | 10 / 0 |
| Last `main` commit | 2026-10-12 | 2026-09-04 | 2026-06-12 | 2026-11-25 | 2026-09-24 | 2026-11-23 | 2026-11-23 | 2026-07-03 |
| Latest release | v2.2.0 (2026-10-12) | none | none | v0.9.94 (2026-11-25, daily) | v0.17.2 | svelte/vue 2.0.3 | examples 2.1.0 | none |
| Language/stack | C++23, Qt6, WASM player | TS, React 19, Vite | Node + GSAP + Python helpers | TS/Bun, Chrome, FFmpeg | TS, Next 16 | TS | TS | — |
| Own tests | GoogleTest (35 files) — **not run** (no toolchain) | 19 tests — **pass** | none | vitest (347 files) — **not green** (see baseline) | vitest 555 — **pass** | vitest/Playwright | vitest/Playwright | none |
| CI present | yes (latest branch run failed; `main` runs passed) | deploy+release; Dependabot failing | no | extensive | yes (latest failed) | yes | yes | no |
| Maturity | young, single maintainer | prototype | single-author skill | production-grade, pre-1.0 churn | young | mature | mature | n/a |

## 2. Capability matrix (the project requirements)

Legend: ✅ works (measured or verified in source) · 🟡 partial · ❌ no · ⚪ not run · n/a not in scope.

| Requirement | AnimatedDiagrams | CogniFlow | skill + HyperFrames + GSAP | drawcms |
|---|---|---|---|---|
| Animate an *existing* diagram (not draw a new one) | ✅ draw.io/Mermaid/JSON in → scenario on top | 🟡 compiles its own graph; draw.io/Mermaid importers; layout re-done by auto-layout | 🟡 LLM redraws as new SVG; "existing" only via LLM re-authoring | 🟡 editor; draw.io import |
| Packets along arrows | ✅ measured | ✅ SMIL motion (all edges loop together) | ✅ measured (MotionPath) | ✅ (not run) |
| Active-component highlight | ✅ states `active/down/success` measured | 🟡 badges derived from edges | ✅ authored | ⚪ |
| Request vs response direction | ✅ `variant` + packet direction | 🟡 semantic types (misclassified several edges in my run) | ✅ authored | ⚪ |
| Parallel flows | ✅ overlapping steps measured | 🟡 everything concurrent by loop, no ordering | ✅ authored | ⚪ |
| Kafka producer/consumer | ✅ event packets measured (generic node kind; Kafka plugin not exercised) | ✅ queue silhouette/belt icon (not run in studio) | ✅ authored | ⚪ |
| Retry / failure / timeout / fallback | ✅ first-class (`retry`, `error`, `timer`, `down`; shipped fallback sample) measured | 🟡 status badges only, no scripted timeline | ✅ authored by hand/LLM | ⚪ |
| Play / pause / seek / speed | ✅ HTML player: play/pause/seek verified; speed via URL option | ❌ exported SVG loops, no controls (studio UI not opened) | 🟡 play/pause + scrub (verified); no speed | ⚪ |
| Deterministic rendering | ✅ 3/3 byte-identical MP4 and GIF (same machine) | ⚪ (unrun: pure functions of scene, plausible) | ✅ 2/2 identical frame MD5 and file hash | ⚪ |
| Interactive HTML export | ✅ 367 KB | 🟡 animated SVG file (no controls) | ✅ 104 KB | ⚪ |
| MP4 export | ✅ | ⚪ (browser WebCodecs, not run) | ✅ | ⚪ |
| GIF export | ✅ | ⚪ (browser, not run) | ⚪ not run (documented as a plain ffmpeg palettegen recipe; `render.mjs` itself is broken on Windows) | ⚪ |
| WebM | ✅ | ⚪ | ⚪ not run (documented ffmpeg recipe) | ⚪ |
| PPTX | ⚪ (documented, incl. editable native animation) | ⚪ | ❌ | ❌ |
| Headless / scriptable | ✅ CLI `--export`; MCP server (not run) | 🟡 Node-safe `headless.ts` for graph/SVG; media export is browser-only | ✅ CLI | ❌ |
| Input: SVG | ❌ | ❌ | 🟡 LLM-mediated | ⚪ |
| Input: draw.io | ✅ (not run) | ✅ (browser-only parser, not run) | 🟡 LLM-mediated | ✅ (not run) |
| Input: Mermaid | ✅ (flowchart + sequence, via merman) | ✅ flowchart parser, run ✅ | 🟡 LLM-mediated | ⚪ |
| Input: PlantUML | ❌ | ❌ | 🟡 LLM-mediated | ❌ |
| Input: PNG/JPG | ❌ | 🟡 SmolVLM path (not run) | 🟡 LLM-mediated | ❌ |
| Input: text description | 🟡 via MCP/agent | ✅ rule compiler run; quality issues | ✅ LLM | ✅ agent |
| Preserves source layout | ✅ for draw.io (reads coordinates, not verified end-to-end) | ❌ auto-layout re-flows | ❌ redraws | ⚪ |
| AI output = structured data only | ✅ JSON v3 | ✅ `candidate.ts` validated graph | ❌ **LLM writes executable JS** | 🟡 agent tools |
| FOSS-clean dependency tree | ✅ (B: LGPL Qt/FFmpeg, notices missing) | ✅ (B: build-time MPL/LGPL) | ❌ GSAP (C), unlicensed pinned CLI (E) | ❌ AGPL + GSAP |

## 3. Benchmark outcome (User → API Gateway → Auth → Order → Kafka → Consumer → PostgreSQL)

The same 7-component scenario (+ a 2nd consumer for parallelism, an auth side-call, a DB write failure on one consumer with retry, and the response path) was built per engine, using identical node coordinates for AnimatedDiagrams and the HyperFrames composition. Full numbers in `BASELINE_TEST_RESULTS.md`.

| Criterion | AnimatedDiagrams | HyperFrames + GSAP (my hand-generated composition) | CogniFlow headless |
|---|---|---|---|
| Output size/length | 1148×418, 16.07 s, 241 frames, 414 KB MP4 (423,758 B) | 1920×1080, 16 s, 30 fps, 499 KB MP4 | animated SVG 63 KB, 6 s loop |
| Render time (MP4) | **1.8 s** (241 frames) | 14.9 s (incl. browser startup) | n/a (no video path run) |
| Repeatability | MP4 & GIF SHA-256 identical ×3 | MP4 SHA-256 and per-frame MD5 identical ×2 | n/a |
| Failures during run | none | none (3 lint warnings about overlapping tweens on my own timeline) | none, but edge-type misclassification |
| Visual quality (assessed) | Clean, readable states/labels; compact default size; no custom iconography in my doc | Cleanest at 1080p only because I scaled coordinates ×1.6; my minimal styling (no arrowheads) — the skill's own shipped example is the best-looking output seen | Cramped single row, overlapping labels, many simultaneous packets |
| Interactive HTML | play/pause/seek verified, 0 console errors | scrub verified, 0 page errors | no controls |
| Scenario author effort | Hand-written JSON (17 steps (13 messages + 4 states)) — structured, validatable | Generator script emitting JS — would be LLM-written JS in the skill's real flow | Text → graph via rule compiler |

Caveat on fairness: I authored the AnimatedDiagrams scenario by hand against its documented JSON schema (first try; it exported without error), and generated the HyperFrames composition with a throwaway script. Neither measures how well an *LLM* would author each; that is a Phase 1 evaluation task.

## 4. Decision matrix

| Candidate | REUSE | ADAPT | REFERENCE | REJECT | Rationale |
|---|---|---|---|---|---|
| **AnimatedDiagrams** (engine + CLI) | ✅ foundation | (fork if we must extend C++) | — | — | Only candidate meeting animation + export + player + structured-data + MIT. Risks: age, bus factor, notices, no image/SVG/PlantUML input. |
| **CogniFlow** | — | ✅ modules: AIR schema & validator, candidate validation, NL rule compiler, draw.io/Mermaid serializers | ✅ rest | — | MIT, small, readable. Not a foundation: loop-only animation, layout/classification issues, 0 community, failing Dependabot. |
| **animated-diagrams-skill** | — | — | ✅ determinism rules, QA loop, camera/style ideas | ✅ GSAP runtime, LLM-authored JS flow, pinned unlicensed hyperframes@0.6.91 | Principle 6 and FOSS requirement. |
| **heygen-com/hyperframes** | — | ✅ *conditional*: optional second renderer behind our own seekable frame adapter (no GSAP) | ✅ determinism docs | — | Strong, Apache-2.0, but heavyweight (Chrome+FFmpeg) and churning; not needed while AnimatedDiagrams renders natively. |
| **hyperframes/hyperframes (URL given)** | — | — | — | ✅ | README-only, no license, no code. |
| **xyflow** | ✅ *only* if browser editor is built | — | ✅ | — | UI substrate. Deferred. |
| **mermaid-js/mermaid** | — | — | ✅ syntax authority; optional validator | — | AnimatedDiagrams embeds its own parser (`merman`). |
| **drawcms** | — | — | ✅ product ideas via public docs only | ✅ code | AGPL + GSAP + CLA; clean-room risk. |

## 5. Ranking for "single best reusable foundation"

1. **AnimatedDiagrams** — satisfies the largest share of requirements in my measured benchmark; confirmed headless on Windows; deterministic; MIT.
2. **HyperFrames (real)** as renderer + **our own** structured scene→frame adapter — flexible and well-maintained but requires us to *write* the whole diagram animation layer that AnimatedDiagrams already has.
3. **CogniFlow** — best fit for a TS/browser stack and for the AI-ingestion pieces, worst fit as an animation core.
4. animated-diagrams-skill — best-looking output, ineligible on licensing and trust model.
5. drawcms — ineligible (AGPL).
