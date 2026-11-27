# ArchFlow web app (`apps/web`)

Static single-page app. Everything happens on the user's device: import, scenario, animation and video export. There is no server code, no account and no upload.

## Features

| Area | What the user gets |
| --- | --- |
| Input | Tabs for **Describe** (text/sentences), **Mermaid**, **draw.io** (also `.svg` with an embedded diagram), **PlantUML**, **JSON** (canonical). Paste, open a file or drag and drop. Content is auto-detected. 10 examples |
| Scenario | Generated automatically from the diagram, or taken from the source (sequence diagrams, JSON). Options: start component; failure on any caller → callee pair (timeout or error); number of retries; "generate from diagram" for sources that already have a scenario |
| Playback | Play/pause, frame step (`,` `.`), ±1 s (←/→), previous/next event (Shift+←/→, ⏮ ⏭), seek bar, Home/End, speed 0.25×–4×, loop. Click the animation to toggle |
| Auto camera | On by default. In diagrams with more than 6 components the view follows what is happening (zoom up to 2.2×, each stop held at least 1 s, one move at a time, starts and ends on the whole diagram) and video export uses the same camera. A manual zoom or pan switches it off; tick **Auto camera** to resume. See [CAMERA_THEMES_QA.md](CAMERA_THEMES_QA.md) |
| Zoom | Mouse wheel (zooms at the cursor), − / Fit / + buttons, keys `+` `-` `0`, double-click to fit, drag to pan, up to 8×. Large diagrams stay readable. Export renders the whole diagram, or follows the auto camera when it is on |
| Theme | Default (today's look), Light, Dark, Blueprint, High contrast: the engine's own design systems; used by playback and export. **Dim inactive** (off by default) fades components not involved in what is happening |
| Messages | Every importer, validator, synthesizer and adapter warning or error with its stable code and source location |
| Export | WebM (VP9 by default) or MP4 (H.264, offered only if the browser can encode it). 1280×720, 1920×1080 or 1080×1080, at 30 or 60 fps. Rendered frame by frame (no screen capture, no waiting): about 0.5–1 s for a 10 s clip on a desktop. Fallback: real-time MediaRecorder (WebM) when WebCodecs is missing |
| Download | The validated canonical JSON (diagram + scenario) |
| Look (page) | Light and dark page themes (system), responsive down to phone width, keyboard focus styles, labelled controls |

## Architecture

```
source text ─► pipeline.ts (pure; unit tested in Node)
                 importers / text parser ─► canonical model ─► synthesizer (if needed)
                 ─► validator ─► renderer adapter (groups: "flatten") ─► engine JSON
player.ts ─► EngineHost (pinned WASM engine) ─► display list ─► painter.ts (canvas)
export.ts ─► same engine + painter on an OffscreenCanvas ─► WebCodecs ─► webm-muxer / mp4-muxer
```

- `painter.ts` is ported from the upstream player (MIT). A browser test proves it is **pixel-identical** to the upstream player: 0 differing bytes over 10 frames.
- The app owns its clock, which is why play, pause, step and speed are exact and export renders without real-time playback.

## Build and size

Run `npm run web:build`. Output goes to `apps/web/dist`. The build is deterministic and asset names are content-hashed.

| File | Bytes | gzip |
| --- | --- | --- |
| `assets/app-*.js` (UI, importers, synthesizer, validator, muxers) | ≈ 260 KB | ≈ 82 KB |
| `assets/engine-*.js` (pinned WASM engine, base64-embedded) | 375,849 B | ≈ 162 KB |
| `assets/app-*.css` | ≈ 4.4 KB | ≈ 1.6 KB |

The build:
- refuses to emit a bundle that contains `eval` or `new Function`;
- copies `LICENSE`, `THIRD_PARTY_NOTICES` and every licence text into `dist/licenses/` (linked from the footer);
- writes the `_headers` file.

## Security

- **CSP:** `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' data:; …; frame-ancestors 'none'; object-src 'none'`.
  - No inline script and no inline style attributes.
  - WebAssembly needs `'wasm-unsafe-eval'`, not `'unsafe-eval'`.
- **Other headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, and a restrictive `Permissions-Policy`.
- **Untrusted input:**
  - Files are limited to 4 MB.
  - Every importer treats input as data. XML `DOCTYPE`/entities are refused, decompression is bounded, and nothing referenced by a file (URLs, includes, images, Mermaid `click`) is fetched or followed.
  - Labels are drawn on canvas as text, never inserted as HTML.
- **Privacy:** no analytics, no cookies, no storage, no network requests after the page loads.

## Tests

- `apps/web/test/pipeline.test.ts` (15 tests, Node): every example, regeneration, user options, error cases, detection.
- `apps/web/test/app.browser.test.ts` (8 tests): this suite builds the production site and serves it with its real `_headers`, then drives Chrome:
  - CSP and caching headers;
  - no console errors or CSP violations;
  - every example draws;
  - the transport controls;
  - error display;
  - the JSON download validates;
  - **WebM export** produces a valid EBML file;
  - **MP4 export** produces a valid `ftyp` file when H.264 is available.

Manual check during development: FFmpeg decoded both exported files completely (307 frames, 10.2 s, 1280×720 at 30 fps) and the frames show the expected animation.

## Browser support (verified vs expected)

| Browser | Status |
| --- | --- |
| Chrome 158 (Windows) | **verified**: all features, WebM and MP4 |
| Other Chromium (Edge, Brave, Opera) | expected to work (same engine); not tested |
| Firefox 130+ | expected: playback; WebCodecs VP9 export, with MP4 depending on platform encoders. **Not tested** |
| Safari 17+ | expected: playback; WebCodecs export. **Not tested** |
| No WebCodecs | real-time MediaRecorder WebM fallback (untested) |
