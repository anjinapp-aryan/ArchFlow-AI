# Recommended ArchFlow improvements from the animated-diagrams-skill audit

Source of ideas: https://github.com/omkamal/animated-diagrams-skill at `3de812d90c94baa4f9761684f36c3c322f1fb38c` (Apache-2.0). **No upstream code or asset is copied** in any recommendation; each is re-implemented on ArchFlow's own model.

**Status: proposal. Nothing here is implemented. Each item needs explicit approval.**

## 1. Top recommendations

| Rank | Improvement | Priority | Effort | New production dependency |
| --- | --- | --- | --- | --- |
| 1 | Deterministic auto camera for playback and export (guided tour, then follow-cam) | P0 | 3–5 days | none |
| 2 | Theme presets through the engine's native design systems | P1 | 2–3 days | none |
| 3 | Golden contact sheet and event-boundary assertions | P1 | 1–1.5 days | none |
| 4 | Focus/dim of non-participants through engine `effect` steps | P1 | 2 days, after a parity check | none |
| 5 | Camera extensions: group zoom, vertical scroll for sequences | P1 | 1–2 days on top of 1 | none |
| 6 | Optional intro reveal in flow order | P2 | 1–2 days | none |
| 7 | Narration cues (SRT/VTT) mapped to scenario events, later audio | P2 | 3 days without audio; more with audio | none expected |
| 8 | Small locally bundled icon set | P2 | investigation first | asset only |

## 2. Expected benefits

1. **Auto camera.**
   - Large diagrams, such as the ALB example with ten or more components or a 30–50 node architecture, become readable in the exported video. Today the export always fits the whole diagram, so labels shrink.
   - The viewer's eye goes to where the event happens.
   - It replaces the need to zoom by hand, which works only in the app.
2. **Themes.**
   - A dark theme for presentations and a blueprint theme for documentation.
   - A high-contrast theme for accessibility.
   - The default look is unchanged.
3. **QA.**
   - One image per golden case makes approvals, such as the pending `aws-alb` frames, quick and reliable.
   - Boundary assertions catch timing regressions that a fixed set of golden instants can miss.
4. **Focus/dim.** In busy diagrams, the active path stands out without moving any component.
5. **Camera extensions.** Incidents and group behaviour (target groups, VPCs) can be shown up close; long sequences stay readable.

## 3. Architecture integration

### 3.1 Auto camera (P0)

Why it fits:

- The engine view is static (`Io/JsonCodec.cpp:465`).
- ArchFlow's painter already receives `Framing.bounds`, the world rectangle to fit, on every paint (`packages/engine-host/src/painter.ts:89-101`).
- So a camera is a pure function, `cameraAt(t) -> [x, y, w, h]`.
- The engine, the WASM build and the canonical schema stay unchanged.

Design:

- **New pure module** (proposed `packages/engine-host/src/camera.ts`, or a new small package):
  - `planCamera(input, options) -> CameraTrack`.
  - Input: node rectangles, group frames, scenario events (from, to, edge, start, duration), viewport aspect and size.
  - `cameraAt(track, tMs) -> bounds`.
  - Integer milliseconds, coordinates rounded to quarter pixels, no randomness, no DOM measurement.
- **Planning rules** (adapted from upstream rules):
  - **Off** when the diagram has 6 or fewer nodes, or when the fitted overview already shows the smallest label at 12 px or more on the target.
  - **Focus box** = union of the rectangles of the event's source and target (and the packet path for follow-cam), padded by 25 %.
  - **Zoom** relative to the overview fit is clamped to the range [1, 2.2].
  - **Merging:** consecutive focus boxes that fit together in one view are merged, so the camera does not hop for every packet.
  - **Moves** take 1000–1400 ms with cubic ease-in-out. Each stop dwells at least 1000 ms, with at least 300 ms of rest between moves.
  - Only one camera move at a time.
  - **Parallel events** (for example `par` branches or health-check rounds): the focus box covers all concurrent participants; when they cannot fit at a zoom of at least 1, stay on the overview.
  - **Ending:** the camera returns to the overview and holds at least 1200 ms.
- **Follow-cam mode:** for a single chosen flow, the centre follows the packet position computed with ArchFlow's existing `enginePath`/`pointAlong` (`packages/canonical-model/src/connector-geometry.ts`), which already match engine geometry exactly.
- **Playback (`apps/web/src/player.ts`):**
  - an "Auto camera" toggle;
  - manual wheel or drag zoom suspends the auto camera until Fit is pressed;
  - seeking is exact, because the camera is a function of time.
- **Export (`apps/web/src/export.ts`):** `bounds = cameraAt(t)` per frame when the camera is on. The VP9 and MP4 paths are unchanged.
- **Canonical model:**
  - **Phase A: no schema change.** The camera is derived.
  - **Phase B (optional, schema minor 3):** a scenario `camera` object, `{ mode: "auto" | "off" | "keyframes", keyframes?: [{ t, target: <node id | group id | "overview">, zoom? }] }`.
    - It is validated by Zod, and the ids are checked.
    - It is still data: AI may suggest it, and it is never executed.

### 3.2 Themes (P1)

- **Engine capability:** the pinned engine reads `library.designSystems` and a document-level `designSystem` id (`Io/JsonCodec.cpp:447-455,503-504`). The definition carries:
  - background, edge and text colours;
  - a `colors` token map;
  - per-state fill/ring;
  - per-variant colours;
  - `fontFamily`.

  When drawing, it resolves `$token` colours (`Engine/Scene.cpp:72,121-130`).
- **Adapter (`packages/renderer-adapter`):** emits one of ArchFlow's design systems when a theme is selected. With no theme, the output is byte-identical to today, so existing goldens are unchanged.
- **Presets:** `light` (today's look), `dark`, `blueprint`, `high-contrast`. ArchFlow chooses the values.
- **Connector colours:** the connector-semantics colours in `packages/renderer-adapter/src/connector-style.ts` get one set per theme.
- **Where the setting lives:** an app and export option first, because a theme is presentation, not diagram meaning. A canonical `presentation.theme` field can follow later if users want it saved with the diagram.

### 3.3 QA additions (P1)

- **Contact sheet:**
  - a dev-only script (proposed `scripts/golden-contact-sheet.mjs`) that tiles each case's golden PNGs with time labels into one image;
  - it uses the Chrome that the QA package already drives;
  - output goes to an ignored folder, never into `fixtures/golden/`.
- **Boundary assertions:**
  - for each packet event, the display list one frame before its start contains no packet for that event, and the frame at its midpoint does;
  - for the camera: the active node lies fully inside the bounds during each dwell, and the zoom never exceeds the clamp.
  - Whether the display list identifies packets per event still needs checking [U].
- **Export probe:** confirm CI asserts frame count and duration of the exported WebM. Add it if missing.

### 3.4 Focus/dim (P1)

- **Mechanism:** the adapter emits engine `effect` steps with an opacity keyframe track. The engine supports opacity, scale, rotate, offsets, glow and tint (`Model/Library.hpp:76-85`). Non-participants go to 0.35 while a flow runs and are restored afterwards.
- **Prerequisite:** a painter parity test for effect frames, because ArchFlow has never emitted effect steps.
- **Default:** off.

### 3.5 Postponed items (P2)

- **Intro reveal:** optional and off by default; engine `fade-in`/`pop` effects in flow order.
- **Narration:**
  - ArchFlow's own TypeScript SRT/VTT parser;
  - scenario `cues: [{ start, end, text, eventIds[] }]`;
  - later, audio via WebCodecs `AudioEncoder` (Opus) in the existing `webm-muxer` 5.1.4 path. Audio-track support in that muxer was not checked [U].
- **Icons:** first trace how the engine resolves `icon` names (nanosvg is compiled in). Then choose a small MIT/ISC set such as Lucide or Tabler, bundled locally and sanitised at build time, with licence files.

## 4. Implementation sequence

1. **Approval** of this proposal (and of the pending `aws-alb` goldens).
2. **Contact sheet** first (0.5 day). It speeds up every later golden review.
3. **Camera phase A:**
   - pure planner and unit tests;
   - player toggle;
   - export path;
   - new camera goldens for `aws-alb` and one large generated diagram.
4. **Camera follow-cam and group zoom**, then **vertical scroll** for sequence diagrams.
5. **Boundary assertions** for events and the camera.
6. **Themes:** adapter design systems, four presets, contrast tests, one golden per theme.
7. **Effect parity check**, then **focus/dim**.
8. **Re-evaluate the P2 items** with real user diagrams.

## 5. Acceptance criteria

### Camera

- Same input gives byte-identical bounds sequences and byte-identical exported frames on Windows and Linux.
- With the camera off, or for 6 nodes or fewer: output is identical to today. The `linear-3`, `order-flow` and `aws-alb` goldens are unchanged, and the golden harness runs with the camera off.
- With the camera on, for each event's dwell:
  - its source and target are fully in view;
  - the smallest label renders at 12 px or more at 1280x720.
- Zoom never exceeds 2.2x of the overview fit.
- No two camera moves overlap. Every stop dwells at least 1000 ms.
- The animation ends on the overview with a hold of at least 1200 ms.
- Export time overhead is at most 10 %.

### Themes

- Default output is byte-identical to today.
- Every preset passes:
  - text-on-node and text-on-background contrast of at least 4.5:1;
  - connector-on-background contrast of at least 3:1;
  - distinguishable state colours (ok, active, warn, down, success).
- Painter parity holds per preset.

### QA

- The contact sheet is generated for all golden cases without modifying `fixtures/`.
- The boundary assertions pass for all fixtures.

### Focus/dim

- Painter parity with effects holds.
- Default is off, and existing goldens are unchanged.

## 6. Estimated effort

About 10–14 working days for P0 and P1 together.

| Item | Effort |
| --- | --- |
| Contact sheet | 0.5 day |
| Camera phase A | 3–5 days |
| Camera extensions | 1–2 days |
| Boundary assertions | 1 day |
| Themes | 2–3 days |
| Effect parity check + focus/dim | 2 days |

P2 items are not estimated until they are investigated.
