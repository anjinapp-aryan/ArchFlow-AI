# ArchFlow AI

Animate how requests and data travel through an **existing** software architecture diagram — packets along the original connectors, components lighting up, request/response directions, parallel consumers, failures and retries, with play/pause/seek/step/speed and WebM export. Browser-first; public deployment target is Cloudflare Workers Static Assets (not deployed yet).

Status: **v0.2.0 release candidate (Phase 1 complete)** — web app with draw.io / Mermaid / PlantUML / text-description input, generated or imported scenarios, full playback controls and WebM/MP4 export. Not deployed. See `docs/architecture/PHASE1_FINAL_REPORT.md`.

Quick start: `npm ci && npm run engine:build && npm run build && npm run web:build && npm run web:serve`, then open http://127.0.0.1:8788/.

## Layout

| Path                                  | Purpose                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/canonical-model`            | Renderer-independent canonical JSON schema (Zod mini) + validator with machine-readable errors                      |
| `packages/diagram-importers`          | draw.io and Mermaid (flowchart, sequence) → canonical model; Node and browser; see `docs/architecture/IMPORTERS.md` |
| `packages/importer-eval`              | Importer fidelity corpus, scorer and harness (ArchFlow, native oracle, CogniFlow)                                   |
| `apps/web`                            | The web app (static site for Cloudflare Workers Static Assets); see `docs/architecture/WEB_APP.md`                  |
| `packages/scenario-synthesizer`       | Diagram → animation scenario; text descriptions → diagram; see `docs/architecture/SYNTHESIZER.md`                   |
| `packages/renderer-adapter`           | Pure canonical → engine-document mapping; rejects unsupported features explicitly                                   |
| `packages/engine-host`                | Typed wrapper around the pinned WASM engine; deterministic text metrics; player-template filler                     |
| `packages/qa`                         | Golden-frame infrastructure (display-list hashes, pixel frames) driven by headless Chrome                           |
| `engine/`                             | `upstream.lock.json` (exact revision + toolchain pins) and `expected-hashes.json`                                   |
| `scripts/`                            | Engine build, licence collection/check, golden update                                                               |
| `fixtures/`                           | Canonical scenarios (valid + invalid), golden frames, importer corpus (`fixtures/diagrams`)                         |
| `licenses/`, `THIRD_PARTY_NOTICES.md` | Notices for everything compiled into the engine artifact                                                            |
| `docs/`                               | Research and architecture documents                                                                                 |
| `poc/p10`, `research/`                | Preserved P1.0 proof of concept and Phase 0 evidence (not product code)                                             |

## Prerequisites (Windows 11 / Linux / macOS)

- Node.js **≥ 22** (`.nvmrc`), npm ≥ 10
- Git
- Python 3 on PATH (`python`, `python3` or `py -3`) — used only to install the CMake/Ninja wheels and by emsdk. **Windows:** the Microsoft-Store `python3` stub does not work; install real Python or disable the alias (Settings → Apps → Advanced app settings → App execution aliases). The build script probes for a working interpreter.
- Google Chrome (or set `CHROME_EXE` to any Chromium) for the browser/golden tests
- ~3 GB free disk for the Emscripten SDK (downloaded once into `.tools/`, git-ignored)

No paid service, API key or account is needed.

## Quick start

```bash
npm ci
npm run engine:build      # clones the pinned upstream, installs emsdk 7.0.1 into .tools/, builds the WASM (first run ≈ 3–5 min)
npm run build             # bundles packages/engine-host for the browser
npm run ci                # typecheck + lint + all tests + licence check
```

Windows notes:

- Run from PowerShell, cmd or Git Bash; `scripts/build-engine.mjs` strips the `MSYSTEM` variable internally because emsdk otherwise emits POSIX syntax inside `cmd`.
- Paths containing spaces are supported.
- Line endings are normalised to LF (`.gitattributes`).

## Everyday commands

| Command                                        | What it does                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                            | `tsc --noEmit` over all packages                                                                                                                                                                                                |
| `npm run lint`                                 | ESLint (incl. rules banning `eval`/`new Function`) + Prettier check                                                                                                                                                             |
| `npm run test:unit`                            | Schema, validator and adapter tests (no browser)                                                                                                                                                                                |
| `npm run test:browser`                         | WASM engine integration + golden frames (needs Chrome and `engine:build`; **fails loudly** if either is missing)                                                                                                                |
| `npm run golden:update`                        | Rewrite goldens for _this_ environment — review the diff and PNGs before committing                                                                                                                                             |
| `npm run web:build` / `web:serve`              | Production build into `apps/web/dist` (CSP headers, licences) / serve it locally with those headers                                                                                                                             |
| `npm run demos`                                | Standalone demo pages in `artifacts/demos/`                                                                                                                                                                                     |
| `npm run deploy` / `smoke:live`                | Guarded Cloudflare deploy of the web app (Worker `app`, target https://app.archflow-ai.workers.dev; refuses without the dedicated account, see `docs/architecture/DEPLOYMENT.md`) / end-to-end test against `ARCHFLOW_BASE_URL` |
| `npm run corpus:generate` / `importers:report` | Regenerate `fixtures/diagrams` from the corpus spec / re-record importer fidelity results (see `docs/research/IMPORTER_FIDELITY.md`)                                                                                            |
| `npm run engine:verify`                        | Compare `build/engine/manifest.json` hashes with `engine/expected-hashes.json`                                                                                                                                                  |
| `npm run licenses:collect` / `licenses:check`  | Regenerate licence texts / scan npm tree against the SPDX allow-list                                                                                                                                                            |

## Golden frames

- **Display-list goldens** (`fixtures/golden/<fixture>/displaylist.json`): the engine's draw list at fixed instants, with _deterministic text metrics_, hashed with SHA-256. Platform-independent and mandatory everywhere.
- **Pixel goldens** (`…/pixels/<os-arch-chromeNNN>/`): canvas pixels from the real player with real browser fonts. Valid only for the recorded environment; on any other environment the test is **skipped with an explicit message** and candidate frames are written to `artifacts/golden-candidates/` for review.
- Final video hashes are never used as the determinism test.

## Safety rules enforced in code

- AI/imported data is validated against a closed, strict schema before it reaches the engine; unknown keys, oversized inputs and dangling references are errors.
- The engine silently normalises bad documents (verified by test), so validation is done by ArchFlow, never delegated to it.
- No `eval`/`new Function` in ArchFlow code (lint-enforced); the engine itself is built with `DYNAMIC_EXECUTION=0`.
- No GSAP anywhere.

## Project licence

MIT (see [`LICENSE`](LICENSE)). Copyright (c) 2026 Anjinappa N. Third-party notices: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
