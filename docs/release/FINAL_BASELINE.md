# Final baseline (start of the release-readiness pass)

Recorded on 2026-11-28, before any change in this pass.

## Repository state

- Branch `main`, HEAD `d041a0e` ("fixing bugs"), in sync with `origin/main`.
- The uncommitted workspace redesign was preserved as-is (no reset, stash or clean):
  - modified: `apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/samples.ts`, `apps/web/src/styles.css`, `apps/web/test/app.browser.test.ts`;
  - new: `apps/web/src/diagnostics.ts`, `apps/web/test/diagnostics.test.ts`, `apps/web/test/workspace.browser.test.ts`, `docs/ui/`, `scripts/ui-screenshots.mjs`.
- Golden references: `fixtures/golden/{aws-alb,linear-3,order-flow}` are unmodified (`git status fixtures` is empty).

## Reported vs verified

| Reported fact | Verified how | Result |
| --- | --- | --- |
| 677 tests passing, 0 skipped | `artifacts/ui/final-tests.log`, written by `npm run typecheck && npm run lint && npm run test && npm run licenses:check` on this exact working tree | **Confirmed**: 39 files, 677 passed, 0 skipped, `EXIT 0` |
| Typecheck, lint, licences pass | same log | Confirmed. Licences: 287 packages, OK (exceptions: 5) |
| No new dependencies | `git diff package.json package-lock.json apps/web/package.json` | Confirmed (empty) |
| Goldens unchanged | `git status fixtures` | Confirmed |
| Local app at http://127.0.0.1:8788/ | background `npm run web:serve` serving `apps/web/dist` | Running |

## Tooling available for this pass

| Tool | Version / path |
| --- | --- |
| Node | 24.14.1 |
| Google Chrome (installed, headed) | 158.0.8127.88 |
| Microsoft Edge (installed, headed) | 158.0.4370.45 |
| Mozilla Firefox (installed) | 160.0.1 at the start of the pass; it updated itself to 161.0 before the final browser run |
| ffprobe / ffmpeg | 9.0.1 (Gyan full build, WinGet) |
| puppeteer-core | existing devDependency |

## Package scripts used

`typecheck`, `lint`, `test` (unit + browser projects), `test:browser`, `build` (engine host bundle), `web:build`, `web:serve`, `golden:update` (not run in this pass), `licenses:check`, `ci`.

## Build baseline (before this pass)

| Asset | Bytes | Gzip |
| --- | --- | --- |
| app JS | 336,127 | 109,914 |
| app CSS | 21,400 | 5,322 |
| engine JS | 375,849 | 161,713 |

A frozen copy of this build is in `artifacts/release/dist-snapshot/`, used by the long-running browser and export validations so that rebuilds could not disturb them.
