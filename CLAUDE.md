# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ArchFlow AI animates how requests and data travel through an existing architecture diagram (packets along the original connectors, request/response, parallel consumers, failures, retries) with exact playback controls and WebM/MP4 export. Everything runs in the browser; there is no server code.

Response style for chat is set in `AGENTS.md` (terse "caveman" style; same text mirrored into `.cursor/rules`, `.clinerules`, `.windsurf`, `.github/copilot-instructions.md`, `.opencode`). Code, comments, commits and docs are written in normal prose.

## Commands

Node ≥ 22 (`.nvmrc`), npm workspaces (`packages/*`, `apps/*`). Python 3 and Chrome (or `CHROME_EXE`) are needed for the engine build and browser tests.

```bash
npm ci
npm run engine:build   # clone pinned upstream + emsdk into .tools/, build WASM into build/engine (first run 3-5 min)
npm run build          # bundle packages/engine-host for the browser (needed before browser tests)
npm run ci             # typecheck + lint + all tests + licence check

npm run typecheck      # tsc --noEmit over all workspaces (one root tsconfig)
npm run lint           # eslint . && prettier --check .
npm run format         # prettier --write .
npm run test:unit      # Node-only vitest project
npm run test:browser   # *.browser.test.ts: headless Chrome, WASM engine, goldens; fails loudly without engine:build or Chrome

npx vitest run packages/canonical-model/test/validate.test.ts   # single file
npx vitest run --project unit -t "name of test"                 # single test by name

npm run web:build && npm run web:serve   # production site in apps/web/dist, served at http://127.0.0.1:8788/ with real _headers
npm run golden:update                    # rewrite goldens for this environment; review diff and PNGs before committing
npm run corpus:generate                  # regenerate fixtures/diagrams; CI checks with `node scripts/make-corpus.mjs --check`
npm run engine:verify                    # compare build/engine/manifest.json with engine/expected-hashes.json
```

Test split is by filename: `*.browser.test.ts` runs in the `browser` project (serial, 120 s timeouts); everything else under `packages/*/test` and `apps/*/test` is `unit`.

`npm run deploy` is a guarded Cloudflare deploy (Worker `app`, account pinned in `wrangler.jsonc`, refuses other accounts). CI deploys `main` after approval and then runs `npm run smoke:live`. Do not deploy without the owner's OK. See `docs/architecture/DEPLOYMENT.md`.

## Architecture

Packages export TypeScript source directly (`"exports": "./src/index.ts"`, `allowImportingTsExtensions`, imports use `.ts` extensions). There is no per-package compile step; only `engine-host` and `apps/web` have bundling builds (esbuild).

Data flow (see `docs/architecture/WEB_APP.md`, `RENDERER_STRATEGY.md`):

```
source text ─► apps/web/src/pipeline.ts (pure, no DOM, unit tested in Node)
   diagram-importers (draw.io, Mermaid flowchart/sequence, PlantUML) or scenario-synthesizer text parser
   ─► canonical-model document ─► scenario-synthesizer (if source has no scenario)
   ─► canonical-model validator ─► renderer-adapter ─► engine document JSON (AnimatedDiagrams v3)
player.ts ─► engine-host (pinned WASM engine) ─► display list ─► painter.ts (canvas)
export.ts ─► same engine + painter on OffscreenCanvas ─► WebCodecs ─► webm-muxer / mp4-muxer
```

- **canonical-model**: ArchFlow's own renderer-independent, versioned schema (Zod mini) and validator with stable machine-readable error codes (`codes.ts`), plus `migrate.ts` for schema versions. This is the contract between importers/synthesizer/AI and rendering. See `docs/architecture/CANONICAL_MODEL.md`.
- **renderer-adapter**: pure canonical → engine-document mapping. Rejects unsupported features explicitly instead of letting them through. Also owns themes, auto camera, dim-inactive and labels. Swapping the engine should only touch this package and engine-host.
- **engine-host**: typed wrapper around the WASM build of upstream AnimatedDiagrams; deterministic text metrics (`measure.ts`); `painter.ts` is ported from the upstream player and is tested pixel-identical to it.
- **engine/**: `upstream.lock.json` is the single source of truth for the pinned upstream revision and toolchain; `expected-hashes.json` records artifact hashes. Do not modify the upstream clone; any needed patch goes in as a patch file applied to the pinned revision.
- **scenario-synthesizer**: diagram → animation scenario (health/routing, failures, retries) and text description → diagram. See `SYNTHESIZER.md`.
- **qa**: golden-frame infrastructure driven by headless Chrome (puppeteer-core).
- **importer-eval**: importer fidelity corpus, scorer, comparison against native oracle and CogniFlow.
- `poc/`, `research/`, most of `docs/research` are preserved Phase 0/1.0 evidence, not product code (ignored by lint).

The app owns its clock, so play/pause/step/speed are exact and export renders frame by frame without real-time playback.

## Goldens

- Display-list goldens (`fixtures/golden/<fixture>/displaylist.json`) use deterministic text metrics, are platform-independent and mandatory.
- Pixel goldens (`…/pixels/<os-arch-chromeNNN>/`) are only valid for the recorded environment; elsewhere the test is skipped with a message and candidates go to `artifacts/golden-candidates/`.
- Final video hashes are never used as the determinism test.

## Rules enforced in code

- All imported or AI data is validated against the closed, strict canonical schema before reaching the engine. The engine silently normalises bad documents, so validation must stay in ArchFlow.
- No `eval` / `new Function` / implied eval (ESLint errors; `web:build` refuses a bundle containing them; engine built with `DYNAMIC_EXECUTION=0`).
- No GSAP anywhere.
- Strict CSP with no inline scripts or inline style attributes (`wasm-unsafe-eval` only). Labels are drawn on canvas, never inserted as HTML.
- Importers treat input as data: XML DOCTYPE/entities refused, bounded decompression, nothing referenced by a file is fetched. 4 MB file limit.
- No network requests, storage, cookies or analytics after page load.
- New npm dependencies must pass `npm run licenses:check` (SPDX allow-list, exceptions in `scripts/license-exceptions.json`); engine-compiled code needs notices in `licenses/` and `THIRD_PARTY_NOTICES.md`.
- Line endings are LF (`.gitattributes`). On Windows, `scripts/build-engine.mjs` strips `MSYSTEM` itself; paths with spaces are supported.
