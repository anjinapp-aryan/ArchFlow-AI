# Phase 1 final report — ArchFlow AI v0.2.0

Date: 2026-11-26. Scope: all of Phase 1 (P1.0–P1.8 of the master prompt; numbering in the repo drifted, mapping below). **Not deployed, not pushed** (both need the owner's authorization). Earlier gate reports: `P1_1_REPORT.md` … `P1_4_REPORT.md`.

## Result

**GO: release candidate.** The web app runs end to end on the user's device:

1. A **draw.io, Mermaid or PlantUML diagram, or a plain-text description** is turned into an animation of requests, parallel flows, failures, retries and responses.
2. The animation plays with full transport controls.
3. It exports to **WebM or MP4**.

Everything is deterministic, validated, permissively licensed and tested. `npm run ci` passes with **469 tests** (438 unit, 31 browser), and the licence gate is green.

What stands between this and a public launch is listed under "Before going public".

## Master-prompt Phase-1 acceptance criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Deployable on Cloudflare (or documented alternative) | **Met (locally verified)** | `wrangler.jsonc`, `_headers`; served by real `workerd` with all headers, export working (`DEPLOYMENT.md`). Not deployed |
| 2 | Canonical JSON model | **Met** | `CANONICAL_MODEL.md` (schema `archflow/canonical@1`, minor 1) |
| 3 | Schema validator | **Met** | 56 error codes, 6 warning codes, every code has a negative test; fuzzed |
| 4 | Deterministic renderer adapter | **Met** | byte-identical outputs; goldens; `assertEngineSafe` |
| 5 | Text-to-diagram benchmark | **Met** | `fixtures/benchmark/order-flow.txt` and plain-English variant; nine beats checked (`SYNTHESIZER.md`) |
| 6 | Mermaid-to-animation benchmark | **Met** | `fixtures/benchmark/order-flow.mmd`; same nine beats; rendered by the engine and checked at key instants |
| 7 | Golden-frame tests | **Met** | display-list goldens (platform independent), pixel goldens (Win/Chrome 158), painter pixel parity with upstream (0 differing bytes) |
| 8 | Packets, parallel flows, retries, responses work | **Met** | benchmark browser test; demo pages; exported video decoded with FFmpeg |
| 9 | SVG, raster, PlantUML decisions documented | **Met** | `SVG_IMPORT_SPIKE.md` (draw.io SVG shipped; generic NO-GO for now), `RASTER_IMPORT_SPIKE.md` (NO-GO, measured), `PLANTUML_IMPORT_SPIKE.md` (GO, shipped) |
| 10 | Licences and distribution obligations resolved | **Met, one owner action** | `THIRD_PARTY_NOTICES.md`; 18 licence texts shipped in `dist/licenses/`; copyright holder in `LICENSE` is still a placeholder |
| 11 | CI passes | **Partly** | `npm run ci` passes locally (Windows). The GitHub workflow has never run because nothing was pushed |
| 12 | Docs reflect implementation and evidence | **Met** | this report and the documents it links |

## What was built in this final stretch

| Area | Deliverable |
| --- | --- |
| P1.5 synthesizer | `@archflow/scenario-synthesizer`: diagram → scenario (sync/async rules, parallel consumers, failure injection with retries and recovery); text descriptions (arrows and sentences); benchmark from text, sentences and Mermaid |
| Player | `painter.ts`: TypeScript port of the upstream canvas painter, pixel-identical. ArchFlow owns the clock (play, pause, step, speed, seek, event jumps) |
| Web app | `apps/web`: 5 source formats, 10 examples, scenario options, messages panel, transport, WebM/MP4 export (frame-exact, about 1 s for a 10 s clip), JSON download, light/dark, responsive, keyboard |
| PlantUML | `importPlantUml`: component/deployment and sequence diagrams; 13/13 corpus files |
| SVG | draw.io SVG with an embedded diagram is imported exactly; generic SVG prototype measured |
| Raster | Measured OCR/detection spike (isolated research code) |
| Production | `npm run web:build` (hashed assets, CSP, licences), `npm run web:serve`, `wrangler.jsonc`, CI uploads the deployable site |

## Measured quality

| Measure | Value |
| --- | --- |
| Importer fidelity corpus (38 files: 12 draw.io, 13 Mermaid, 13 PlantUML) | **ArchFlow 38/38**; native AnimatedDiagrams 20/25 (no PlantUML); CogniFlow 5/25 |
| Benchmark beats | 9/9 from each of text, sentences and Mermaid |
| Painter vs upstream player | 0 differing bytes over 10 frames |
| Node vs Chrome importer output | byte-identical on every corpus file |
| Fuzzing | validator 600, importers 1,200 seeded mutations; never throws, never returns invalid output |
| Export | 10.2 s at 1280×720/30: 307 frames, VP9 0.5 MB, H.264 0.4 MB; FFmpeg decodes every frame |
| Bundle | app 82 KB gzip + engine 162 KB gzip |

## Before going public (owner decisions/actions)

1. ~~**Copyright holder** in `LICENSE`~~: resolved 2026-11-27 (Anjinappa N).
2. **Authorize the GitHub push** so CI runs on Linux and Windows runners. Linux engine hashes and pixel goldens are still unrecorded.
3. **Authorize `wrangler deploy`** (`DEPLOYMENT.md`).
4. **Real-world files.** All fidelity evidence uses corpora written by the same agent that wrote the importers. Before claiming format support publicly, add consented real exports: at least 5 draw.io, 5 Mermaid and 5 PlantUML files, ideally from different people.
5. **Browser coverage.** Only Chrome 158 on Windows has been exercised. Test Firefox and Safari (playback and WebCodecs export) before advertising them.

## Known limitations (documented, reported in the UI)

- **Groups** are kept in the model but not drawn: the engine has no containers, so components render and a notice is shown.
- **Generic SVG** (without an embedded draw.io diagram) and **raster images** are not supported. Users get clear messages.
- **Mermaid:** only flowcharts and sequence diagrams.
- **PlantUML:** only component/deployment and sequence diagrams.
- **Generated scenarios** follow fixed rules and timing. There is no branching logic, and failures are chosen by the user, not inferred.
- **Layout of Mermaid/PlantUML** comes from dagre and will not match those tools' own renderings.
- **Engine bus factor** (single upstream maintainer). Mitigated: pinned revision, reproducible build, our own painter.

## Mapping of numbering

| Master prompt | Delivered in |
| --- | --- |
| P1.0 feasibility | P1.0 |
| P1.1 foundation | P1.1 |
| P1.2 canonical model and wrapper | P1.1 (wrapper) + P1.2 (model) |
| P1.3 importer corpus | P1.3 |
| P1.4 scenario schema and validator | P1.2 |
| (importers) | P1.4 |
| P1.5 synthesizer and benchmark | this report |
| P1.6 SVG spike | this report |
| P1.7 raster spike | this report |
| P1.8 PlantUML spike | this report |
| §13 quality/security | throughout (CSP, limits, fuzzing, no code execution, no uploads) |
