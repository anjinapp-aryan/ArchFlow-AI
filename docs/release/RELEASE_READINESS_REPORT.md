# Release readiness report

**Recommendation: GO for review.** No Blocker or High issue is open.

- The working tree is ready for review and a commit.
- Nothing has been committed, pushed or deployed.
- Deploying needs explicit approval.

## Release checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Baseline recorded | Done | FINAL_BASELINE.md |
| Real-browser validation (headed Chrome, Edge, Firefox) | Done: 77/77, 77/77 and 74/77. The 3 Firefox failures are automation limits. | BROWSER_VALIDATION_REPORT.md |
| WebM VP9 at 720p and 1080p, 30 fps | Pass in Chrome, Edge and Firefox, with exact frame counts | EXPORT_VALIDATION_REPORT.md |
| MP4 (best effort) | Pass in Chrome, Edge and Firefox. The Firefox failure was fixed. | EXPORT_VALIDATION_REPORT.md |
| JSON export and re-import | Pass (Chrome, Edge) | EXPORT_VALIDATION_REPORT.md |
| Download again | Pass: byte-identical, no re-render | EXPORT_VALIDATION_REPORT.md |
| P0: diagnostic to diagram navigation | Done | FINAL_VISUAL_REVIEW.md, `15-diagnostic-highlight` |
| P1: editor line numbers and error line | Done | `16-editor-error-line` |
| P1: onboarding check | Pass. The Welcome checks pass 7/7 in every browser. | BROWSER_VALIDATION_REPORT.md |
| P1: example gallery check | Pass. 11/11 examples load with 0 errors in every browser. | BROWSER_VALIDATION_REPORT.md |
| P2: tablet and mobile | Fixed and verified at 390, 360, 768 and 1024 px | FINAL_VISUAL_REVIEW.md |
| P2: 4K and 1080×1920 presets | Added after measurement (3–4.4 s, at most 4.5 MB) | EXPORT_VALIDATION_REPORT.md |
| Visual review at 1920×1080, 1600×900, 1366×768 and 1280×720 | Done: 16 screens, 64 images, with before and after images | FINAL_VISUAL_REVIEW.md |
| Accessibility, security and performance | No Critical or High findings. All 5 Medium findings fixed. | ACCESSIBILITY_SECURITY_REPORT.md |
| Full regression | EXIT 0 | `artifacts/release/final-regression.log` |
| Goldens (AWS ALB, linear-3, order-flow) | Unchanged: `git status fixtures` is empty | — |
| Dependencies | Unchanged: the `package.json` and lockfile diffs are empty | — |
| Licence | MIT, unchanged. `licenses:check` OK with 287 packages and the 5 documented exceptions. | — |
| Engine pin | AnimatedDiagrams v2.2.0 @ `3ce17fc3be7cacdb6b65dce362c86674043a4baa`, unchanged | — |

## Final regression (after the last code change)

`npm run typecheck && npm run lint && npm run licenses:check && npm run build && npm run web:build && npm test`

- Typecheck: pass.
- Lint: pass (ESLint and Prettier).
- Licence check: OK (5 exceptions).
- Build: the engine host and the web build pass.
- Tests: **41 files and 697 tests pass**, unit and browser projects together. That is 6 tests more than the previous run: `h264Timing` and `repairAvcC`.
- Bundle: app JS 344,318 B (112,835 gzip), CSS 23,631 B (5,817 gzip), engine 375,849 B (161,713 gzip), unchanged.

## Open issues

| Severity | Issue | Notes |
| --- | --- | --- |
| Blocker | — | None |
| High | — | None open. The Firefox MP4 export failure was High; it is fixed. |
| Medium | — | None open |
| Low | In `bench-text` at about 6.5 s, the "1s" timeout ring overlaps the "Consumer 1" title. | Drawn by the pinned engine and painter; the same in playback and export. Future engine work. |
| Low | MP4 from Chrome and Edge is tagged full range, while WebM is limited range. | The browser encoder's default. No visible difference was found. |
| Low | Firefox writes H.264 level 3.1 at 1080p. | Firefox's encoder choice; decodes fine |
| Low | Firefox MP4 starts at 1/30 s, because of B-frame delay. | Every frame is present. |
| Low | The vertical 1080×1920 export letterboxes wide diagrams. | The option label says so. |
| Low | Editing on a phone is cramped. | The product targets desktop and tablet. Phone layout now fits without sideways scroll. |
| Info | Fullscreen needs the browser window in front. | Browser behaviour |
| Info | Firefox fullscreen and reduced-motion emulation cannot be automated. | Reduced motion was checked by hand. Presentation mode works. |
| Future | A 4K export was not measured on slower or memory-constrained devices. | Measured on one Windows 11 desktop |

## Who did the work

The work used independent agents alongside the main session:

| Agent | Work |
| --- | --- |
| Browser validation | Wrote `scripts/browser-validation.mjs` and ran the first headed run in three browsers. It found the 390 px and 1024 px layout defects. |
| Export validation | Wrote `scripts/export-validation.mjs` and ran 18 real exports with ffprobe checks: JSON, Download again, cancel and `isConfigSupported`. It found the missing 4K MP4 codec. |
| Accessibility and security review | Keyboard walks, contrast calculation, injection payloads, network and storage checks, and performance traces. It found 11 issues. |
| Main session | P0 and P1 features, every fix, the presets and their measurement (`scripts/export-presets-check.mjs`), the final browser run, Firefox export validation and the two Firefox MP4 fixes, the screenshots, the regression and these reports. |

## Files changed (uncommitted)

The working tree also holds the uncommitted UI polish pass that came before this one (`docs/ui/`, and part of the diff in the files below). Both passes are reviewed together.

**Modified**

- `apps/web/index.html`: diagnostics panel markup, line gutter, `#view-announce`, `#time` role, 4K and vertical size options.
- `apps/web/src/main.ts`: diagnostic navigation, gutter and error line, focus return, popover focusout, mode-only announcements and failure tick labels.
- `apps/web/src/export.ts`:
  - `avc1.640033` for 4K MP4;
  - `h264Timing` for B-frames;
  - `repairAvcC`;
  - output-callback errors now reported.
- `apps/web/src/player.ts`: highlight outline with a dark under-stroke.
- `apps/web/src/samples.ts`: a one-line description for each example in the gallery.
- `apps/web/src/styles.css`: contrast tokens, target sizes, non-colour marks, sidebar clamp, narrow-screen header and presentation toggle.
- `apps/web/test/app.browser.test.ts`: tests for the new behaviour.
- `scripts/serve-web.mjs`: 400 for a malformed URL, not a crash.

**New**

- `apps/web/src/diagnostics.ts` and `apps/web/src/locate.ts`: diagnostics rendering, and finding the diagram components and source line for an issue.
- `apps/web/test/diagnostics.test.ts`, `apps/web/test/locate.test.ts`, `apps/web/test/export-timing.test.ts` and `apps/web/test/workspace.browser.test.ts`.
- `scripts/browser-validation.mjs`, `scripts/export-validation.mjs`, `scripts/export-presets-check.mjs` and `scripts/ui-screenshots.mjs`: the validation tools used for this report.
- `docs/release/`: these six reports and `screenshots/` (17 images, 1.1 MB).
- `docs/ui/`: reports from the earlier UI polish pass.

Generated evidence is in `artifacts/`, which git ignores.

## Recommended next action

1. Review the diff and the screenshots in `docs/release/screenshots/`.
2. Commit, in one commit or in two: the UI polish pass, then the release pass.
3. With explicit approval, redeploy the Worker and repeat a short smoke check on the deployed URL in Chrome and Firefox: load an example, play it, and export WebM and MP4.
