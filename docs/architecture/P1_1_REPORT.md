# P1.1 Report — Repository foundation, WASM build, wrapper, canonical model, golden frames

Date: 2026-11-25. Scope: P1.1 only. Nothing deployed, nothing pushed, no Phase 2 work.

## Result

**GO for P1.1** (all P1.1 deliverables implemented and verified locally). CI workflow is written and its YAML parses, but it has **not been executed** (no push). Linux/macOS builds are **untested**.

## What was built

| Area | Where | Notes |
|---|---|---|
| Repo foundation | `package.json` (npm workspaces), `tsconfig*.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `.nvmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `README.md` | Node ≥ 22, TypeScript 6.0.3, ESLint bans `eval`/`new Function`/implied eval |
| Pinned reproducible WASM build | `engine/upstream.lock.json`, `engine/expected-hashes.json`, `scripts/build-engine.mjs` | Pins upstream revision `3ce17fc3…`, emsdk revision, emscripten 7.0.1, cmake/ninja wheels; verifies tree is clean and hashes match |
| Renderer wrapper | `packages/engine-host` | `EngineHost` (load/frame over the `ad_player_*` exports), deterministic text metrics, player-template filler, esbuild browser bundle (2.8 KB) |
| Canonical model | `packages/canonical-model` | Strict Zod-mini schema (`archflow/canonical@1`), limits, validator with machine-readable `{code, path, message}` errors |
| Renderer adapter | `packages/renderer-adapter` | Pure canonical → engine-document-v3 mapping; rejects groups/no-scenario explicitly; deterministic bytes |
| Golden-frame infra | `packages/qa`, `fixtures/golden`, `scripts/golden-update.mjs` | Tier 1: display-list hashes with deterministic metrics (platform independent, mandatory). Tier 2: pixel frames per `os-arch-chromeNN` (explicit skip + candidates elsewhere) |
| Fixtures | `fixtures/scenarios` | `order-flow` (8 nodes, 8 edges, 17 events: parallel consumers, failure, retry, response), `linear-3`, 12 invalid documents |
| Licences | `THIRD_PARTY_NOTICES.md`, `licenses/` (+`MANIFEST.json`, `ENGINE_LINK_INPUTS.txt`), `scripts/collect-licenses.mjs`, `scripts/check-licenses.mjs`, `scripts/license-exceptions.json` | Texts copied from the pinned sources; npm tree scanned against an SPDX allow-list |
| CI | `.github/workflows/ci.yml` | Ubuntu + Windows: typecheck, lint, unit, licence gate; engine build + hash verify + licence-drift check + golden tests |
| Docs | `docs/architecture/DEPENDENCY_DECISIONS.md` §7, `RENDERER_STRATEGY.md` §6, `PROPOSED_ARCHITECTURE.md` banner | Inventory closed; Zod vs Ajv decision with measurements |

Preserved untouched: `docs/research/*`, `research/` (Phase 0/P1.0 evidence), `poc/p10`. Added `poc/p11-schema-compare` (throwaway measurements).

## Commands run and outcomes

| Command | Result |
|---|---|
| `node scripts/build-engine.mjs --update-expected` (first run from empty `.tools/`, `.cache/`) | PASS, 77 s for the build step (toolchain download not timed separately); artifacts: `ad_player_engine.js` 375,849 B sha256 `c6a4845b…44e5`, `player-template.html` 405,716 B sha256 `72775c93…86ea` |
| Hash vs. the P1.0 build (different checkout path, different emsdk directory) | **Bit-identical** |
| Clean-copy test: tracked files only copied to a fresh directory, `npm ci`, engine build (fresh upstream clone), `npm run build`, `npm run ci` | PASS: same hashes, 41/41 tests, 51 s with an existing emsdk |
| `npm run typecheck` | PASS |
| `npm run lint` (ESLint + Prettier) | PASS |
| `npm run test:unit` | PASS: 29 tests (canonical-model 22, renderer-adapter 7) |
| `npm run test:browser` (headless Chrome 158 on Windows) | PASS: 12 tests, 0 skipped on this machine |
| `npm run licenses:check` | PASS: 279 packages, 5 reviewed exceptions |
| Mutation check: shifted one packet by 50 ms in `linear-3` | both golden tiers FAILED at the expected instants; restoring the fixture made them pass |

## Dependencies and licences

See `DEPENDENCY_DECISIONS.md` §7 and `THIRD_PARTY_NOTICES.md`. In short: shipped = engine WASM (MIT engine + MIT nlohmann_json + zlib nanosvg + MIT/NCSA Emscripten + MIT musl members + Apache-2.0-with-LLVM-exception compiler-rt/libunwind/libc++ headers) and, in the browser bundle later, zod (MIT, no dependencies). No GPL/LGPL/AGPL, Qt, FFmpeg or GSAP anywhere. Dev-only: MPL-2.0 `lightningcss` and CC-BY-3.0 SPDX data packages recorded as reviewed exceptions.

## Golden-test results

Display-list goldens: 2 fixtures × (7 + 14) instants, all match; reproducible across independent pages. Pixel goldens: recorded for `win32-x64-chrome158` (21 PNGs, 1.4 MB); reproducible within the environment; match. Semantic assertions (labels present at the right instants: parallel `consume` ×2, `Down`, `timeout`, `retry`, `ack`, `Success`) pass.

## Findings worth knowing

1. **The engine silently normalises invalid documents** (unknown node reference → step deleted, document still loads). Proven by a test. All validation must be ArchFlow's.
2. `emsdk_env.bat` emits POSIX syntax when `MSYSTEM` is set (Git Bash) and exports nothing if its output is redirected; the build script handles both.
3. TypeScript 7 is incompatible with typescript-eslint's peer range; TypeScript 6.0.3 pinned.
4. Ajv needs `new Function`; Zod mini does not and is ~6.7× smaller gzipped.
5. libc++ contributes headers only; no libc++ archive is linked (P1.0 text corrected).

## Remaining risks

- CI never executed; Linux/macOS engine hashes, link maps and pixel goldens unknown (CI records candidates; `expected-hashes.json` only has `win32-x64`).
- Pixel goldens depend on the exact Chrome major (158 here); other Chrome versions skip explicitly until re-recorded.
- Cross-OS equality of the WASM artifact is unproven (same-OS, different-path equality is proven).
- The canonical model's semantic validation is basic (references, durations, bounds). Event ordering, retry-sequence and contradictory-state rules are P1.4.
- No playback controls beyond seek, no WebM export in product code, no importers yet (planned P1.2+).
- Project licence undecided (`UNLICENSED`).
- The upstream engine's bus factor (unchanged).
- Third-party GitHub Actions used are GitHub-owned (`checkout`, `setup-node`, `setup-python`, `cache`, `upload-artifact`) referenced by major tag, not by commit SHA.
