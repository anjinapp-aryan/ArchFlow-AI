# Browser validation report

These are real, headed browser windows, not headless runs. `scripts/browser-validation.mjs` drives the installed browsers through 77 scripted checks each, using real mouse, keyboard and file-chooser input against a local copy of the production build.

- The results are in `artifacts/release/browser/` (`summary.txt`, `results.json` and screenshots).
- The log is in `artifacts/release/browser-final-run.log`.

## Browsers

| Browser | Version | Driver |
| --- | --- | --- |
| Google Chrome | 158.0.8127.88 | puppeteer-core, CDP, headed |
| Microsoft Edge | 158.0.4370.45 | puppeteer-core, CDP, headed |
| Mozilla Firefox | 161.0 (160.0.1 in the first run; it updated itself in between) | puppeteer-core, WebDriver BiDi, headed |

**Test conditions**

- Windows 11 Pro, 1500×1000 browser windows, with a 1366×768 page viewport unless a check sets another size.
- Chrome and Edge ran with `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` and `--disable-background-timer-throttling`. Without these flags, a covered test window stops painting.
- Each browser used a fresh profile.

## Result

| Run | Build | Chrome | Edge | Firefox |
| --- | --- | --- | --- | --- |
| First run (before fixes) | frozen snapshot `artifacts/release/dist-snapshot/` | 75 / 77 | 75 / 77 | 72 / 77 |
| **Final run (after fixes)** | `apps/web/dist` with all fixes | **77 / 77** | **77 / 77** | **74 / 77** |

The first run's results are kept in `artifacts/release/browser-snapshot-run/`.

The 3 remaining Firefox failures are limits of browser automation, not product defects. See "Could not verify automatically" below.

### Final run by area (pass / total)

| Area | What is checked | Chrome | Edge | Firefox |
| --- | --- | --- | --- | --- |
| Welcome | first visit, Describe, Import (draw.io, Mermaid, PlantUML through the file chooser), examples, second visit | 7/7 | 7/7 | 7/7 |
| Examples | all 11 gallery examples load and animate with 0 errors | 11/11 | 11/11 | 11/11 |
| Workspace | tabs by click and keys, sidebar collapse, resizer by mouse and keys with persistence, theme cycle, zoom buttons and wheel, drag pan, camera chip, view menu | 12/12 | 12/12 | 12/12 |
| Playback | play and pause, next and previous event, frame step, start and end, timeline click and drag, speed (2× measured at a ratio of 2.00), loop on and off | 9/9 | 9/9 | 9/9 |
| Shortcuts | Space, Home, End, arrows, Shift+arrows, `.` and `,`, `+`, `-` and `0`, `c`, `l`, `[`, `f`, `?`, Ctrl+Enter | 19/19 | 19/19 | 18/19 |
| Presentation | real fullscreen, idle hide after about 2.5 s, mouse shows controls, Esc leaves presentation and fullscreen, exit button, `P`, reduced motion | 7/7 | 7/7 | 5/7 |
| Diagnostics | Mermaid error with stale chip, Technical details, fixing clears the stale state, aws-alb warnings and notes | 4/4 | 4/4 | 4/4 |
| Responsive | 1920×1080, 1366×768, 1280×720, 1024×768, 768×1024, 390×844, 1280×720 with a 640 px sidebar, 1024×768 with a 443 px sidebar | 8/8 | 8/8 | 8/8 |

No CSP violations and no page errors were seen in any browser. The only console output was 3 Chrome and Edge warnings about `getImageData` readback. The validation script's own pixel sampling causes them; the app never calls `getImageData`.

## Defects found and fixed

| Severity | Defect (first run) | Fix | Final run |
| --- | --- | --- | --- |
| Medium | At 390×844 the header was 417 px wide. The Export button was off-screen and covered by Present, and the sidebar toggle was 20 px wide. | Narrow-screen header: the product name is hidden, "Local" is kept for screen readers only, and spacing is tighter. The sidebar toggle no longer shrinks. | Pass in all three |
| Medium | At 1024×768 with a saved 443 px sidebar, the speed and loop controls were pushed off-screen. | The sidebar width is clamped, so the stage keeps at least 640 px. The saved preference is kept for larger windows. | Pass in all three |
| Low | On phones, the page scrolled 42 px behind the welcome overlay. | The welcome overlay is fixed to the window on narrow screens. | Pass (scroll position 0) |
| Low | In presentation, the checked loop toggle was white on near-white. | Blue tint, white icon | Pass (new browser test) |

The same fixes are covered by the browser tests in `apps/web/test/workspace.browser.test.ts`, which run in `npm test`.

## Could not verify automatically

| Item | Why | What was verified instead |
| --- | --- | --- |
| Real fullscreen in Firefox (`f` and Present) | Firefox refuses `requestFullscreen` from an automated session. `fullscreenElement` stays null although the request comes from a real key press. | Presentation mode itself works in Firefox: controls float, idle hides them, and Esc and the exit button leave it. Real fullscreen passes in Chrome and Edge. |
| Esc while in real fullscreen, in Firefox | Same reason | Passes in Chrome and Edge |
| Reduced motion in Firefox through the script | Puppeteer's media emulation needs CDP, which Firefox does not offer. | Checked by hand with Firefox's `ui.prefersReducedMotion = 1` setting: playback does not start by itself. It passes by emulation in Chrome and Edge. |
| Fullscreen when the browser window is not in front | Chrome and Edge refuse fullscreen for a background window. This is browser behaviour, seen while other windows covered the test window. | Passes when the window is in front |

## Export in each browser

Export results are in `EXPORT_VALIDATION_REPORT.md`:

- WebM and MP4 in Chrome and Edge, including the 4K and vertical presets;
- WebM and MP4 in Firefox 161.0. MP4 failed in Firefox before this pass and is fixed.

The browser run above used the build from before the Firefox MP4 fix. That fix changes only `apps/web/src/export.ts`, which these checks do not exercise. The Firefox export check was run on the final build.
