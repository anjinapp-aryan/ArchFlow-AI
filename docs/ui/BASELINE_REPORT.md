# UI baseline report (before the workspace redesign)

Recorded on 2026-11-28 at commit `d041a0e` ("fixing bugs"), clean working tree, `main` in sync with `origin/main`. Nothing was uncommitted, so no work had to be preserved.

## Repository and frontend architecture

| Area                    | State at baseline                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app                 | `apps/web`: vanilla TypeScript, no UI framework, bundled by esbuild (`apps/web/build.mjs`) into content-hashed static files for Cloudflare Workers Static Assets.                                                                                                             |
| Source files            | `index.html` (225 lines), `src/main.ts` (544, UI wiring), `src/player.ts` (318, playback clock, manual zoom/pan, automatic camera), `src/export.ts` (194, WebCodecs WebM/MP4 export), `src/pipeline.ts` (219, import → scenario → engine JSON), `src/styles.css` (348). |
| Engine                  | AnimatedDiagrams v2.2.0 WASM (pinned `3ce17fc3be7cacdb6b65dce362c86674043a4baa`), painted by ArchFlow's own canvas painter (`packages/engine-host`).                                                                                                                         |
| Production dependencies | None in the web app beyond the workspace packages. Dev: esbuild, eslint, prettier, puppeteer-core, typescript, vitest.                                                                                                                                                       |
| Security                | Strict CSP from `build.mjs` (`script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self'`), `nosniff`, `X-Frame-Options: DENY`; the build refuses bundles that contain `eval`/`new Function`.                                                                                 |

## Layout at baseline

Screenshots: `artifacts/ui/screens/before/<size>/01-initial.png` and `02-error.png` (copies in `docs/ui/screenshots/before/`).

- **One scrolling page.** The header held a 2-line brand block. Below it, a left card held "1 · Your diagram", "2 · Scenario" and "Messages" stacked vertically, and a right card held the canvas, the controls and "3 · Export".
- **Canvas.** A fixed 16:9 box inside a card. At 1366×768 it used about 860×485 px, about 40 % of the window.
- **Controls below the fold.** At 1366×768 and 1280×720, the scenario controls (`Failure kind`, `Retries`, `Apply`) and the export row sat below the fold. The screenshot script reported them as off-screen.
- **One mixed control row.** A single wrapping row mixed transport, zoom, automatic camera, speed, loop, animation theme and dimming.
- **Raw diagnostics.** Messages showed the technical message plus the raw code (`text.monitoring_inferred · …`).
- **No first-run guidance.** No presentation mode, full screen, collapsible sidebar, workspace theme choice, or first-time guidance. The benchmark loaded silently.

## Usability problems found (ranked by user impact)

1. **Small canvas.** The canvas was a minority of the screen, and the page had to scroll to reach the scenario and export controls.
2. **Controls mixed together.** Playback, viewport, camera and styling controls were in one undifferentiated row, so manual zoom and the automatic camera were hard to tell apart. Only a checkbox flipped silently.
3. **Diagnostics hard to read.** Messages were technical (`treated as health checks (monitoring, not request routing): …`) and carried raw machine codes. Severity was conveyed mainly by a coloured border.
4. **Export buried.** Export sat at the bottom of the page, gave no information about what would be rendered, and had no clear success state beyond a line of text.
5. **No guidance for first-time users**, and no presentation mode for teaching or recording.

## Test and build baseline

Commands, all run from the repository root (log: `artifacts/ui/baseline-tests.log`):

| Command             | Result                                                       |
| ------------------- | ------------------------------------------------------------ |
| `npm run typecheck` | clean                                                        |
| `npm run lint`      | clean (eslint + prettier)                                    |
| `npm run test`      | **37 files, 642 tests passed**, 0 skipped, 44.2 s            |
| `npm run web:build` | app JS 316,227 B (103,482 B gzip); CSS 4,425 B (1,608 B gzip); engine 375,849 B (161,713 B gzip) |

Golden references at baseline: `fixtures/golden/{aws-alb,linear-3,order-flow}`. They were left unchanged by the redesign.
