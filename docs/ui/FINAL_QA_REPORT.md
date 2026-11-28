# Final QA report — workspace redesign

Date: 2026-11-28. Environment: Windows 11, Node 24.14.1, headless Chrome via puppeteer-core. Nothing was committed, pushed or deployed.

## Full pipeline

Run from the repository root (log: `artifacts/ui/final-tests.log`):

| Command                  | Baseline (`d041a0e`)       | After                                                    |
| ------------------------ | -------------------------- | -------------------------------------------------------- |
| `npm run typecheck`      | clean                      | clean                                                    |
| `npm run lint`           | clean                      | clean (eslint + prettier)                                |
| `npm run test`           | 37 files, 642 passed       | **39 files, 677 passed, 0 failed, 0 skipped** (52.3 s)   |
| `npm run licenses:check` | OK (exceptions: 5)         | OK (exceptions: 5), 287 packages                         |
| `npm run web:build`      | OK                         | OK (sizes in the implementation report)                  |

The 35 new tests are 20 unit tests in `apps/web/test/diagnostics.test.ts` and 15 browser tests in `apps/web/test/workspace.browser.test.ts`.

**Golden and regression coverage:**
- `fixtures/golden/**` is unmodified (`git status fixtures` is empty).
- The AWS ALB, linear-3 and order-flow pixel, display-list and camera goldens all pass.
- So do the routing, camera, readability, temporal and contact-sheet suites.

**Existing test changed:** `apps/web/test/app.browser.test.ts` now opens the Export dialog before using the export controls, and the Diagram style popover before clicking "Dim". No assertion was removed or loosened.

## Screens inspected

`node scripts/ui-screenshots.mjs --tag after` captures 14 screens at 4 sizes, 56 in total:
- the first visit, the workspace and the example gallery;
- the scenario and diagnostics tabs;
- playback with the auto camera, manual zoom and the view options;
- presentation mode, the export dialog and a finished export;
- the error state, the collapsed sidebar and the light workspace.

For each screen it records console errors, horizontal overflow and controls outside the window. **Result: 56 of 56 screens report no problems** (`artifacts/ui/screens/after/report.json`). The before UI had controls off-screen at 1366×768 and 1280×720.

Every screen at 1366×768 and 1280×720, and the key screens at 1920×1080 and 1600×900, were reviewed by eye twice: by the lead, and by the visual-review agent. That review found 10 issues; all were fixed and checked again on fresh screenshots.

## Functional checks (automated, production build with the real CSP)

| Area                       | Verified by                                                                     | Result |
| -------------------------- | ------------------------------------------------------------------------------- | ------ |
| Initial load, no console errors or CSP violations | app + workspace browser tests                                  | pass   |
| All 11 examples load and draw | app test "every example loads without errors"                                | pass   |
| Describe → Ctrl+Enter animates | workspace "describe"                                                       | pass   |
| Import controls (file input, format buttons, paste detection) | app "shows clear errors", workspace "describe"; file input unchanged | pass   |
| Scenario configuration reachable without scrolling | workspace responsive ×4                                     | pass   |
| Diagnostics: plain language, severity words, codes in details, status, badge | workspace "diagnostics" + 20 unit tests | pass   |
| Error state marks the stale canvas and clears on success | workspace "diagnostics"                               | pass   |
| Playback: start, end, previous/next event, play/pause label, loop key, timeline marks, `aria-valuetext` | workspace "playback toolbar", app "transport" | pass |
| Manual zoom vs automatic camera (chip, switch, C key) | workspace "manual view and automatic camera"            | pass   |
| Auto camera frames differ from the overview; manual zoom switches it off | app "auto camera"                     | pass   |
| Zoom, pan, fit                                         | app "zooms and pans"                                     | pass   |
| Presentation: canvas fills the window, chrome hidden, playback works, Esc and P leave | workspace "presentation mode" | pass |
| Export dialog: defaults, information, Esc               | workspace "export dialog"                               | pass   |
| WebM export (EBML header, > 20 KB)                      | app "exports a WebM video"                              | pass   |
| MP4 export                                              | app "exports MP4 …": runs only if this Chrome has H.264 | pass (the test skips itself when the browser lacks an H.264 encoder) |
| Download JSON validates as canonical                    | app "downloads the validated canonical JSON"            | pass   |
| Animation themes and dimming keep the position          | app "themes and dimming"                                | pass   |
| Workspace theme does not change canvas pixels           | workspace "workspace theme is independent"              | pass   |
| Sidebar tabs (arrow keys), keyboard resize, collapse, persistence | workspace "sidebar"                         | pass   |
| First visit welcome, gallery = all examples, remembered | workspace "first visit"                                 | pass   |

## Responsive validation

Each size was checked by the workspace test and the screenshot script:
- no horizontal or vertical page overflow;
- every header, transport, toolbar, tab and action control fully on screen;
- the canvas takes more than 55 % of the window;
- the camera chip and toolbar never overlap;
- the transport is one row;
- "Apply scenario" is visible without scrolling.

| Size      | Result |
| --------- | ------ |
| 1920×1080 | pass   |
| 1600×900  | pass   |
| 1366×768  | pass   |
| 1280×720  | pass. Header labels and the privacy pill shorten to "Local", and the document facts hide. |

## Accessibility findings

**Automated** (workspace "accessibility basics"):
- Every visible button has an accessible name.
- Every form control has a label.
- Every icon-only button has a tooltip.
- Text contrast on the sidebar surface is above 7:1 for ink and above 4.5:1 for muted text and for the accent button text.
- The first Tab reaches the skip link, and the canvas shows a focus outline.

**Manual and code review:**
- **Tabs and toggles:** sidebar tabs follow the WAI-ARIA tabs pattern with arrow keys and Home/End. The source format is a group of `aria-pressed` toggle buttons. The auto camera is a `role="switch"` checkbox.
- **Keyboard:** the resize handle is a focusable `separator` that works with ←/→/Home/End. Dialogs are native `<dialog>` elements with Esc. The welcome card is non-modal; closing it hands focus to the canvas.
- **Status messages:** live regions announce the diagram title, validity, diagnostics status, view chip and export messages.
- **No colour-only status:** diagnostics carry an icon and a severity word, the validity line has an icon and words, and timeline failure marks are an extra cue, not the only one.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, CSS transitions and animations are off, and the animation waits for Play instead of starting itself.
- **Not tested:** screen readers (NVDA, VoiceOver).

## Performance and security

See the implementation report for bundle sizes (+6.4 KB gzip JS, +3.7 KB gzip CSS) and the per-frame work.

**Security review:**
- no dependencies added;
- no `innerHTML` or other HTML injection: diagram text reaches the DOM through `textContent` and `Option` only;
- no network calls, so diagrams stay local;
- `localStorage` holds only four workspace preferences, wrapped in try/catch;
- the 4 MB import limit is unchanged;
- CSP-compatible: styles are set only through CSSOM, and the HTML has no inline styles or scripts;
- the output is still static files for Cloudflare Workers Static Assets, and `_headers` is unchanged.

## Not verified

- Firefox, Safari and Edge (only Chromium was tested). Cross-browser support is not claimed.
- Real full screen in a desktop browser. Headless runs cannot show it; the full-window presentation layout is verified.
- Screen-reader output.
- Layouts narrower than 1280 px beyond "no overflow".
