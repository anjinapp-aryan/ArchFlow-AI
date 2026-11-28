# UI/UX implementation report — professional workspace

Scope: the web app shell in `apps/web` (layout, controls, dialogs, diagnostics, first-time experience). The animation engine, the painter, the scenario pipeline, the camera planner and the export renderer are unchanged. Baseline: [BASELINE_REPORT.md](BASELINE_REPORT.md). Screens: [BEFORE_AFTER_COMPARISON.md](BEFORE_AFTER_COMPARISON.md). Tests: [FINAL_QA_REPORT.md](FINAL_QA_REPORT.md).

## Phases completed

| Phase                     | Result                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Baseline                | Clean tree at `d041a0e`; 642/642 tests; bundle sizes recorded; before-screenshots at 4 sizes.                                                                                                                                                                                                                                                                                                              |
| 1 Workspace               | Full-height app layout with no page scroll. The compact header (52 px) shows the diagram title and facts, a privacy indicator, Examples, Shortcuts, Workspace theme, Present and Export. The left sidebar has Diagram, Scenario and Diagnostics tabs and is collapsible and resizable. The canvas fills the rest.                                                                                                     |
| 2 Playback                | A dedicated transport bar has: go to beginning, previous event, back one frame, play/pause, forward one frame, next event, go to end, a seekable timeline with event marks (failures in red), time and duration, speed, and a loop toggle. Canvas controls are separate, overlaid on the canvas: zoom out / fit (shows %) / zoom in, the auto-camera switch, Diagram style, and full screen.                                       |
| 3 Presentation            | `Present` (P) hides the header, sidebar and footer and requests browser full screen. The canvas then fills the window, and a floating transport bar auto-hides after 2.5 s of inactivity. Esc or `Exit` leaves. The automatic camera keeps working.                                                                                                                                                         |
| 4 Export                  | A modal export dialog offers WebM (VP9) by default and MP4 (H.264) as best effort; unsupported formats are disabled with a reason. It has resolution and frame-rate controls. An information panel shows duration and frame count, the camera (automatic as in playback, or whole diagram — a manual zoom is never exported), style, encoder and file name. It also shows progress, success (size, resolution, fps, time, "Download again") and failure states, plus Download JSON. Export progress also appears in the header button. |
| 5 Diagnostics, first time | Messages show a plain-language title and explanation, a severity word and icon (never colour alone), and collapsed technical details (code · location — original message). The status line, tab badge and a line under the editor show validity. On a first visit, a welcome card offers Describe, Import and Explore examples (a gallery of all 11 bundled examples); it is remembered per browser. |
| 6 Design system           | Light and dark workspace tokens (system / light / dark toggle, independent of the five animation themes). A 20×20 inline SVG icon sprite, plus consistent buttons, segmented control, tabs, fields, switch, toggle, popover, dialogs, chips and empty, loading and error states.                                                                                                                                                     |
| 7 Accessibility           | Skip link, visible focus, accessible names on every button, labels on every control, WAI-ARIA tabs with arrow keys, toggle buttons with `aria-pressed`, a switch for the auto camera, an `aria-valuetext` timeline, keyboard sidebar resizing, live status regions, and a shortcuts dialog (`?`). Under `prefers-reduced-motion` the UI uses no transitions and animations do not start by themselves.                                                |
| 8 QA and polish           | 56 screenshots (14 screens × 4 sizes) reviewed by eye and by the visual-review agent; all 10 findings fixed. Performance and security review: 8 findings, 7 fixed, 1 accepted.                                                                                                                                                                                                                                    |

## Agents used

| Agent                                       | How                                                                                                                                                                                                                                   | Evidence produced                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Product/UX, 2 Frontend architect, 3 UI engineer, 4 Animation/canvas, 5 QA | Done by the lead directly. The UI is small and lives in a few shared files (`index.html`, `main.ts`, `styles.css`), so parallel editors would have conflicted on the same files. | Baseline report, implementation, `diagnostics.ts`, 35 new tests, screenshot script.                                                 |
| 6 Visual design reviewer                    | Subagent, read-only, reviewed every screenshot at 1366×768 and 1280×720 plus key screens at 1920×1080 and 1600×900.                                                                                                                   | 2 high, 4 medium, 4 low findings (seam next to the resize handle, stale error state, gallery cut off, editor line wrap, duplicate "Auto camera", plural bug, lock-only pill, format spacing, empty diagnostics pane, status placement). All fixed. |
| 7 Performance and security reviewer         | Subagent, read-only; rebuilt the bundle and audited the diff.                                                                                                                                                                         | No blockers. Fixed: a forced layout per frame, `backdrop-filter` over the animated canvas, the exported-video blob kept in memory, per-pointer-move sidebar style writes, tab roles without panels, the welcome card's name in gallery mode, unhidden decorative SVGs, drop-highlight flicker. Confirmed: no dependencies, no network, no `innerHTML`, CSP-compatible, static files only. |

## Files changed

| File                                      | Change                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/index.html`                     | New workspace markup: icon sprite, header, tabbed sidebar, resize handle, stage with canvas toolbar, view chip, welcome and gallery, transport bar, export and shortcuts dialogs. |
| `apps/web/src/styles.css`                 | Rewritten: tokens (light/dark/system), components, presentation mode, responsive rules, reduced motion.                                                       |
| `apps/web/src/main.ts`                    | Rewritten UI wiring on the same pipeline and Player APIs. New: sidebar tabs/collapse/resize, workspace theme, welcome/gallery, diagnostics rendering, view chip, stale state, presentation/full screen, export dialog and info, keyboard shortcuts, persisted preferences. |
| `apps/web/src/diagnostics.ts` (new)       | Pure `describeIssue` / `summarizeIssues`: plain-language titles and explanations per issue code, with fallbacks by code family.                                    |
| `apps/web/src/samples.ts`                 | A one-line `blurb` per example for the gallery.                                                                                                              |
| `apps/web/test/diagnostics.test.ts` (new) | 20 unit tests: specific explanations, every example's and every error input's messages are human-readable, summary counts.                                    |
| `apps/web/test/workspace.browser.test.ts` (new) | 15 browser tests: first visit, describe, diagnostics, stale state, sidebar, playback toolbar, manual vs auto camera, presentation, export dialog, workspace theme, 4 responsive sizes, accessibility, console. |
| `apps/web/test/app.browser.test.ts`       | Opens the export dialog and the Diagram style popover before using their controls. Every assertion is unchanged.                                              |
| `scripts/ui-screenshots.mjs` (new)        | Reproducible screenshots of all screens at 4 sizes, with a layout-problem report.                                                                              |
| `docs/ui/*`                               | This report, baseline, before/after comparison, final QA, screenshots.                                                                                        |

Not changed: `player.ts`, `export.ts`, `framing.ts`, `pipeline.ts`, all packages, the engine, `fixtures/golden/**` (ALB, linear-3, order-flow), `build.mjs` (CSP and headers), `wrangler.jsonc`.

## Components (in `index.html` + `styles.css`)

Header bar, document title and facts, privacy pill, icon button, ghost and primary buttons, segmented toggle (source format), sidebar tabs with count badge, field (label + control), fieldset group, validity line, diagnostics card (icon, severity, title, body, technical details), resize handle, canvas toolbar, switch, popover, view chip, spinner placeholder, busy toast, welcome card with start cards, example gallery, transport bar with timeline marks, loop toggle, dialog (head, body, foot), export information list, keyboard-shortcut list.

## Dependencies

None added or removed. `package.json` and `package-lock.json` are unchanged. The icons are inline SVG, with no icon font or library.

## Performance impact

| Asset   | Before                     | After                      | Change                   |
| ------- | -------------------------- | -------------------------- | ------------------------ |
| app JS  | 316,227 B (103,482 gzip)   | 336,127 B (109,914 gzip)   | +19.9 KB (+6.4 KB gzip) |
| CSS     | 4,425 B (1,608 gzip)       | 21,400 B (5,322 gzip)      | +17.0 KB (+3.7 KB gzip) |
| engine  | 375,849 B (161,713 gzip)   | unchanged                  | 0                        |

Per animation frame, the UI now writes only the seek position plus text that actually changed (the time display changes every 0.1 s). It reads no layout; the canvas size comes from a ResizeObserver. Sidebar dragging writes one style change per animation frame. Overlays use an opaque background instead of `backdrop-filter`, so no blur is recomputed while the canvas animates.

## Known limitations

- Tested in headless Chrome (Puppeteer) only. Firefox and Safari were not tested. The CSS uses `:has()` and `color-mix()`, which need Firefox 121+ and Safari 15.4+/16.2+.
- In presentation mode, real browser full screen was not verified (headless runs); the full-window layout is tested. Esc in real full screen is handled through `fullscreenchange`.
- The source editor is a plain textarea (no syntax highlighting or line numbers). Lines scroll horizontally instead of wrapping.
- Below 860 px wide the layout stacks (sidebar above the canvas). It works but was not designed in depth: the target is laptop and desktop sizes.
- The welcome card's "watch the order-flow example" link assumes the first bundled example is loaded at start, which it always is.

## Remaining work (prioritized)

1. Cross-browser pass in Firefox and Safari, including real full screen and the MP4 encoder.
2. Editor upgrade: line numbers and error line highlighting from diagnostics `source` locations (no dependency needed for line numbers).
3. Clicking a diagnostic highlights the component or connector it refers to on the canvas.
4. A mobile and tablet layout (bottom sheet sidebar, larger touch targets for the transport).
5. Export presets for 4K and vertical 1080×1920, once the encoder limits are measured.
6. Gallery thumbnails rendered at build time from the golden pipeline.
