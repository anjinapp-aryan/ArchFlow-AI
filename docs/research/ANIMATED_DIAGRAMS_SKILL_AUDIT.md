# Audit: omkamal/animated-diagrams-skill

Research only. No ArchFlow source, fixture, golden, package or deployment file was changed. Audit date: 2026-11-27.

Companion documents: [FEATURE_ADOPTION_MATRIX.md](FEATURE_ADOPTION_MATRIX.md), [LICENCE_COMPATIBILITY.md](LICENCE_COMPATIBILITY.md), [RECOMMENDED_ARCHFLOW_IMPROVEMENTS.md](RECOMMENDED_ARCHFLOW_IMPROVEMENTS.md), [RESEARCH_EXECUTIVE_SUMMARY.md](RESEARCH_EXECUTIVE_SUMMARY.md).

Notation: **[V]** verified in source during this audit; **[D]** stated only in upstream documentation; **[A]** assumption or inference; **[U]** unverified.

## 1. Repository overview

| Item | Value |
| --- | --- |
| URL | https://github.com/omkamal/animated-diagrams-skill |
| Audited commit | `3de812d90c94baa4f9761684f36c3c322f1fb38c` (HEAD of the default branch, 2026-06-12) [V] |
| Tags / releases | none [V] (`git tag` empty; GitHub releases API returns `[]`) |
| Commits | 7, all on 2026-06-12, one author (Omar Kamal) [V] |
| Issues | 0 open, 0 closed [V] (GitHub API) |
| Stars / forks | 61 / 15 at audit time [V] (GitHub API) |
| Licence | Apache-2.0 (`LICENSE`), `NOTICE` lists separately licensed bundled components [V] |
| Package | `package.json`: `animated-svg-skill` 0.1.0, `private: true`, dependencies `gsap` 3.15.0 and `hyperframes` 0.6.91 [V] |
| Lockfile | `package-lock.json`, 220 packages [V] |
| Tests / CI | none. There is no test directory, test script or CI workflow [V] |

### What the project is

The project is a **Claude Code skill**: a prompt (`SKILL.md`), a companion agent prompt (`agents/diagram-animator.md`), twelve reference guides (`references/*.md`), an HTML template, CSS themes and helper scripts. It is not a library or an engine.

For every animation, the language model **hand-writes** two things into one `index.html`:

- an SVG scene;
- an inline GSAP 3 timeline script.

HyperFrames then renders the page: headless Chrome is seeked frame by frame and FFmpeg encodes the frames (`references/hyperframes-rendering.md` [D]; `scripts/render.mjs` calls `hyperframes render` [V]).

So the core model is **"AI writes executable animation code"**. ArchFlow's principle 5 forbids this: AI produces structured JSON only. This single fact decides most classifications below. Ideas transfer; the implementation model does not.

### Directory map (verified)

| Path | Content |
| --- | --- |
| `SKILL.md` | workflow prompt: classify, author SVG, scaffold, choreograph, render, verify, deliver |
| `agents/diagram-animator.md` | batch/delegation agent prompt |
| `references/*.md` (12) | choreography, camera, styles, SVG authoring, sequence, voice-over, code walkthrough, Arabic/RTL, GSAP techniques, HyperFrames, output formats, cliparts |
| `assets/template/composition.html` | page skeleton with camera rig functions and an example five-act timeline in comments |
| `assets/template/theme.css` | `@font-face` rules and token-driven SVG class styles |
| `assets/themes/*.css` (12 + `lang-ar.css`) | CSS custom-property presets |
| `assets/gallery/styles-gallery.html` | 129 KB live gallery, includes the camera-pattern demos |
| `assets/icons/` | Font Awesome 6 subset (26 symbols) and four "original" glyph sheets |
| `assets/fonts/` | 14 WOFF2 files (OFL-1.1) |
| `assets/vendor/gsap/` | GSAP 3.15.0 core, DrawSVG, MotionPath, MorphSVG, **committed to git** |
| `scripts/` | `setup.sh`, `new_project.sh`, `render.mjs`, `export_svg.mjs`, `inline_html.mjs`, `svg_prep.py`, `fetch_clipart.mjs`, `srt_to_cues.py`, `code_to_svg.py` |
| `examples/` (7) | hand-written `index.html` + rendered MP4 and interactive HTML per example |

### Maturity assessment

- **Very young.** The whole history is one day. There are no releases, no tests and no issue history, so there is no evidence of real-world hardening.
- **Mostly documentation.** Of the advertised features, only the camera helpers, the CSS tokens and the scripts are code. Five-act choreography, the six camera patterns, motion languages and the sequence choreography are instructions for a language model, plus hand-written examples.
- **Quality of the writing is high.** The references hold carefully stated craft rules, such as timing tables, "one move at a time", "always return to overview", "pre-start frame must not show the cue's content". These are the most valuable part for ArchFlow.

## 2. ArchFlow baseline (verified before auditing)

The relevant ArchFlow facts, checked in source rather than taken from documentation:

| Area | State | Evidence |
| --- | --- | --- |
| Engine | AnimatedDiagrams v2.2.0, commit `3ce17fc3be7cacdb6b65dce362c86674043a4baa`, compiled to WASM | `docs/architecture/DEPENDENCY_DECISIONS.md:96`, `engine/upstream.lock.json` |
| Engine step types | `Message`, `Timer`, `State`, `Action`, `Link`, `Note`, `Effect` | `.cache/upstream/AnimatedDiagrams/src/Model/Catalog.hpp:21-30` |
| Engine effects | built-in `pulse`, `glow`, `shake`, `blink`, `bounce`, `fade-in`, `fade-out`, `pop`, `spin`, `wobble`, `highlight`; keyframe tracks on opacity, scale, rotate, offsetX, offsetY, glow, tint | `Model/Library.cpp`, `Model/Library.hpp:76-85` |
| Engine design systems | library `designSystems` with background, edge and text colours, a `colors` token map, per-state fill/ring, per-variant colours, `fontFamily`; `$token` colours resolved when drawing; built-ins include `light` and `dark` | `Io/JsonCodec.cpp:367-405`, `Engine/Design.cpp:13-33`, `Engine/Scene.cpp:72,121-130` |
| Engine view | static `view {zoom, panX, panY}` only, not animatable | `Io/JsonCodec.cpp:465` |
| ArchFlow adapter usage | emits `message`, `state`, `timer`, `note`, `link` steps and `scene.background`; does **not** emit `effect` steps or design systems | `packages/renderer-adapter/src/engine-document.ts:87-113`, `adapt.ts` |
| Painter framing | `Framing.bounds` is the world rectangle fitted to the target **per paint call** | `packages/engine-host/src/painter.ts:89-101` |
| Interactive navigation | wheel zoom, buttons, drag pan, fit, up to 8x; playback only, not export | `apps/web/src/player.ts:139-210` |
| Export | WebCodecs VP9 WebM by default, MP4 best-effort, MediaRecorder fallback; frames painted one by one | `apps/web/src/export.ts:8,82,155` |
| Sequence import | Mermaid and PlantUML sequence diagrams to diagram + scenario: replies via `respondsTo`, `-x` errors, async as events, `par` branches in parallel, activations as `active` states | `packages/diagram-importers/src/mermaid-sequence.ts:15-21,145-167` |
| Health checks and routing | monitoring connectors, probes, unhealthy routing | `packages/scenario-synthesizer/src/synthesize.ts`, commit `00b0b44` |
| QA | golden display lists and pixels for `linear-3`, `order-flow`, `aws-alb`; painter parity with upstream player; determinism tests | `packages/qa/src/golden.ts`, `fixtures/golden/` |
| Working tree | clean at audit start; HEAD `00b0b44` | `git status`, `git log` |

Two of these facts matter most for this audit, and neither is described in ArchFlow's documentation yet:

1. **The pinned engine already has data-driven themes and keyframe effects.** ArchFlow does not use them yet.
2. **The painter takes a fitted world rectangle per frame.** A deterministic camera is therefore a pure function from time to rectangle, with no engine change.

## 3. Feature-by-feature findings

### A. Five-act choreography

- **Implementation:** none as code. The acts are defined in `references/animation-choreography.md` [D] and shown as a commented example in `assets/template/composition.html:102-133` [V]. Every example timeline is hand-written GSAP with literal times, for example `examples/sequence-diagram/index.html`: `[2.2, 3.3, 4.4, 5.6, 6.7, 7.8].forEach(...)` [V].
- **Nature:** a prompt convention and quality rubric, not a reusable model.
- **Useful parts:**
  - the timing table (node entrance 0.5–0.6 s, edge draw 0.4–0.8 s, camera 1.0–1.4 s, end hold of at least 1 s);
  - "entrance order = request-flow order";
  - "at most two concurrent threads of motion";
  - "resolve and hold".
- **ArchFlow equivalent:** the scenario already has a flow structure. Nodes are visible from t = 0; there is no intro reveal.
- **Fit:** an optional *intro* (fade-in or pop of nodes in flow order, then connectors) can be expressed with the engine's existing `effect` steps (`fade-in`, `pop`) as data. Layout stays untouched, because the effects animate opacity and scale only. It must stay optional. ArchFlow's audience is engineers reading their own diagram, and a 3–5 s build-up before every animation would be noise.
- **Classification: C — REFERENCE** (rules and timing), with an optional ADAPT of the intro as engine effects (P2).

### B. Camera rig and large-diagram navigation

Implementation, verified in `assets/template/composition.html:66-97` and identical in each example:

| Function | Calculation |
| --- | --- |
| `camFit(tl, sel, {zoom, pad=1.25})` | `getBBox()` of the target; `z = zoom ?? min(W/(bw*pad), H/(bh*pad), 2.2)`; tween `#camera` to scale z and translate so the box centre lands at the canvas centre |
| `camFitAll(tl)` | `camFit` on `#camera` itself with `pad = 1.08` |
| `camPanTo(tl, cx, cy, z)` | same transform for a scene point |
| `camHome(tl)` | back to identity |
| `camFollow(tl, path, {zoom=1.3})` | tween a progress value 0..1; each update centres the camera on `path.getPointAtLength(p*len)` |

The six patterns are **compositions of these five calls written by the language model** (`references/camera-large-flows.md` [D]). Their only implementations are the gallery demos (`assets/gallery/styles-gallery.html:403-520+` [V]), which use a separate copy of the helpers in card space.

| Pattern | Evidence | Assessment for ArchFlow |
| --- | --- | --- |
| Guided tour | gallery demo `tour` [V] | **High value.** Hop to the component where the current event happens, dwell, and end on overview. Derivable from scenario events. |
| Follow-cam | gallery demo `follow` [V] | **High value** for one long request. ArchFlow can compute the packet's position exactly, because `pointAlong`/`enginePath` replicate engine geometry. |
| Vertical scroll | gallery demo `scroll` [V] | **Useful for sequence diagrams.** Pan along the message axis at constant zoom. |
| Conveyor | gallery demo `conveyor` [V] | Low. A special case of follow along one axis; cinematic, not explanatory. |
| Pulse-zoom | `[D]`; gallery demo present [V] | **Medium.** Zoom into a group (VPC, target group) and back; maps to canonical groups. |
| Reveal-pan | `[D]` | Low. Cinematic first reveal; conflicts with "show the user's diagram as drawn". |

- **Determinism:** deterministic only because the timeline is seeked and bounding boxes are stable. It still depends on browser `getBBox` and text metrics [A].
- **ArchFlow can do better:** node rectangles are in the canonical model, so camera targets come from data, not DOM measurement.
- **Readability rules worth keeping** [D]:
  - no camera for at most 6 nodes;
  - maximum zoom (1.6x in choreography, 2.2x clamp in the rig);
  - one move at a time;
  - 0.3–0.5 s rest between moves;
  - always end on the overview with a hold of at least 1.2 s;
  - camera easing `power3.inOut` (a cubic ease-in-out is trivial to write without GSAP).
- **Compatibility:** the engine view is static. ArchFlow's painter already accepts `Framing.bounds` per frame, so a camera is `camera(t) -> [x, y, w, h]` in TypeScript, applied identically in playback and export. No engine change and no dependency are needed.
- **Classification: B — ADAPT** (re-implement from the idea; copy no code). **Highest priority (P0).**

### C. Visual themes and style presets

- **Implementation:** each preset is about 25 CSS custom properties (`assets/themes/*.css`, 807–1279 bytes each [V]) consumed by class rules in `assets/template/theme.css:37-101` [V].
  - Tokens: `--bg`, `--text`, `--text-muted`, `--region-fill/stroke`, `--node-fill/stroke`, `--edge`, `--accent`, three font tokens, radius, stroke widths, dash patterns and seven category colours `--c-*`.
  - The "motion language" per preset is prose for the language model (`references/style-presets.md` [D]).
- **Fit:** the token *structure* maps almost one to one onto the engine's design systems (background, edge colour, text colour, a colour token map, state colours, variant colours, font family). ArchFlow can ship presets as engine `designSystems` data. No CSS and no SVG are involved, and export and playback stay identical.
- **Recommended subset:**
  - `light` (current look), `dark`, `blueprint`;
  - a high-contrast mono variant derived from `mono`/`wireframe`;
  - all colour values chosen and contrast-checked by ArchFlow. The upstream hex values are Apache-2.0 and could be used with attribution, but they were chosen for SVG cards, not engine nodes.
- **Reject:** `sketch`, `pastel`, `glass`, `brutalist`, `vivid`, `editorial`. They rely on decorative fonts (Caveat, Fraunces, Nunito), shadows, translucency or bounce motion that lowers technical clarity.
- **Classification: B — ADAPT** (P1).

### D. Semantic SVG structure

- **Implementation:**
  - the naming contract (`node-<name>`, `edge-<src>-<dst>`, `head-*`, `region-*`, `msg-NN`) and the layer order regions → edges → nodes → labels → particles under `#camera`, with `#hud` outside it (`references/diagram-svg-authoring.md` [D]; template `composition.html:39-53` [V]);
  - `scripts/svg_prep.py` [V], which recovers ids from Graphviz (`<title>`), Mermaid flowcharts (`flowchart-<name>-N`, `L-<src>-<dst>`) and Mermaid sequence output (`messageLine0/1` → `msg-NN` with direction from `x1`/`x2`). It strips width and height and wraps content in `#camera`.
- **ArchFlow equivalent:**
  - the canonical model already has stable unique ids, typed nodes and edges, groups and explicit geometry;
  - ArchFlow does not render through SVG, so the layering contract has no target;
  - ArchFlow imports Mermaid and PlantUML from **source text**, which is more reliable than parsing their rendered SVG.
- **Conflict:** the skill's PNG rule is "rebuild, never trace … match the original's information, not its geometry" (`diagram-svg-authoring.md` [D]). ArchFlow principle 7 is the opposite: preserve the existing layout.
- **Possible reference:** `svg_prep.py`'s id-recovery heuristics, if ArchFlow later accepts rendered Mermaid or Graphviz SVG (see `docs/research/SVG_IMPORT_SPIKE.md`). Its Mermaid regexes are version-sensitive; the code itself says "Mermaid versions vary".
- **Classification: C — REFERENCE** for id heuristics; **D — REJECT** for "rebuild from image".

### E. Sequence-diagram animation

- **Implementation:**
  - `references/sequence-interactions.md` [D]: a `playMessage` example that dims other messages to 0.3, slides the message in from the sender side and moves a pulse along the line;
  - `svg_prep.py --from mermaid-seq` [V];
  - `examples/sequence-diagram/index.html` [V]: 4 participants, 6 messages at hard-coded times, a reply style and activation bars growing by `scaleY`.
- **Not present:** parallel operations, retries, timeouts, error messages and asynchronous semantics beyond "dashed reply". A search of the sequence references for `par`, `parallel`, `retry`, `async` and `error` finds nothing [V].
- **ArchFlow is ahead:** `mermaid-sequence.ts` already handles replies, failures, async events, `par` branches with correct timing, and activations.
- **Ideas worth taking:**
  - **exclusive focus:** dim everything not involved in the current message, expressible as engine `effect` opacity tracks;
  - **vertical-scroll camera** for long sequences (part of B);
  - "requests travel left to right, replies right to left" is already true in ArchFlow by construction.
- **Classification: C — REFERENCE** (focus/dim rule, P1 together with B).

### F. Visual QA and deterministic rendering

- **Implementation:** `scripts/render.mjs` [V]:
  - `hyperframes snapshot --at t1,t2,…` produces PNGs and `contact-sheet.jpg`;
  - snapshot times are computed evenly inside the duration, because `--frames N` samples past the end and gives black frames (lines 99-106);
  - `--probe` runs `ffprobe` and fails on files under 10 000 bytes or duration of 0.5 s or less, and warns when duration differs from `data-duration` by more than 0.25 s (lines 113-128).
  - The "verification" step is the language model **looking at** the contact sheet. There are no assertions on content [V].
- **Boundary verification** (`references/voiceover-sync.md` [D]): snapshot at `cue.start − 0.1` and mid-cue. The frame before a cue must not show that cue's content. This is a sound test idea.
- **ArchFlow equivalent, stronger:**
  - display-list goldens and pixel goldens at fixed instants;
  - painter parity against the upstream player;
  - byte-identical determinism checks;
  - export decode checks (`PHASE1_FINAL_REPORT.md:55`).
- **Gaps it fills:**
  1. a **contact sheet** of golden frames for human approval. Today a reviewer opens each PNG separately, for example for the pending `aws-alb` approval;
  2. an automated **boundary assertion**: no packet on an edge before its event's start time, and the camera at rest during each dwell;
  3. an export **sanity probe** in CI (frame count and duration match), if not already asserted [U].
- **Classification: B — ADAPT** (contact sheet and boundary checks as dev tooling, P1). **D — REJECT** HyperFrames snapshot itself.

### G. Narration synchronization

- **Implementation:** `scripts/srt_to_cues.py` [V], a 70-line stdlib parser for SRT and VTT that outputs `{i, start, end, dur, text}`.
  - Limitations: the VTT header strip needs a blank line after `WEBVTT`; cue identifiers in VTT are only skipped when numeric; there are no styling tags.
  - Cue-to-beat mapping is done **by the language model by hand** (`references/voiceover-sync.md` [D]).
  - Audio is muxed by HyperFrames into an H.264+AAC MP4 [D].
- **Fit:**
  - cues could map to canonical scenario events (`cue.eventIds[]`), or the scenario could be retimed so each flow starts at its cue;
  - WebM audio would need WebCodecs `AudioEncoder` (Opus) plus an audio track in the existing WebM muxer [A: muxer support not checked].
- **Classification: E — INVESTIGATE FURTHER / P2.** Do not add audio now. If built, write ArchFlow's own TypeScript parser; it is about 50 lines, so copying is not worth the attribution.

### H. Icons, cliparts and fonts

| Asset | Location | Licence (per upstream) | Remote? | Assessment |
| --- | --- | --- | --- | --- |
| Font Awesome 6 Free subset, 26 symbols | `assets/icons/fa6-common.svg` (bundled) | CC-BY 4.0, © Fonticons [V header] | no | usable with visible attribution; not ArchFlow's first choice |
| "Original" glyphs: generic, AWS, GCP, Azure roles | `assets/icons/*.svg` (bundled) | Apache-2.0 as project work [D] | no | authorship not independently verifiable [U]; vendor names are trademarks |
| Iconify sets (noto, lucide, tabler, carbon, logos, …) | fetched by `scripts/fetch_clipart.mjs` from `api.iconify.design` | per set; table in `references/concept-illustrations.md:28-57` [D] | **yes**, at authoring time | see the risks below |
| Noto emoji clips | `examples/arabic-concept/cliparts/` | Apache-2.0 [D] | fetched once | example content only |
| 14 fonts | `assets/fonts/*.woff2` | OFL-1.1 [V `licenses/OFL.txt`] | no | redistributable with notice; Reserved Font Name rules need a per-family check [U] |
| Narration audio | `examples/concept-demo/audio/narration.wav` | **not stated** | — | unknown; ignore |

`fetch_clipart.mjs` risks [V]:

- it inserts the downloaded SVG text **unsanitised** into `index.html` (lines 288-296), so a compromised or malicious response could inject script or external references;
- it makes network calls to a third-party API, which raises availability and privacy questions;
- the `logos` set is "mixed/trademarks";
- `openmoji` is CC-BY-SA.

The engine supports per-element `icon` and `style.showIcon` (`Io/JsonCodec.cpp:122-132,286`), and nanosvg is compiled in, so icons are an engine capability. How the engine resolves icon names to images was **not** verified in this audit.

- **Classification:**
  - **D — REJECT** Iconify fetching and the "official vendor logos by default" rule;
  - **E — INVESTIGATE** a small, locally bundled, explicitly licensed (MIT/ISC) icon subset rendered through the engine's own icon support (P2).

### Other upstream features

| Feature | Evidence | Classification |
| --- | --- | --- |
| HyperFrames rendering (headless Chrome + FFmpeg) | `scripts/render.mjs`, `package.json` | **D — REJECT**: native server-side rendering, conflicts with principle 8 and the Cloudflare target |
| GSAP core, DrawSVG, MotionPath, MorphSVG | `assets/vendor/gsap/` | **D — REJECT**: project rule, and not an open-source licence |
| GIF derivation via ffmpeg | `render.mjs:78-82` | **D** for the server path; a browser-side GIF is a separate decision |
| Static SVG export (`export_svg.mjs`) | file present, not run | **E**: the engine has exporters for PPTX and Mermaid (`src/Export/`); an SVG export from the display list could be ArchFlow's own |
| Transparent background (WebM/MOV alpha) | `references/style-presets.md` [D] | **E**: WebCodecs VP9 alpha needs a browser check; P2 |
| Single-file interactive HTML (`inline_html.mjs`) | file present | **C**: ArchFlow's app already plays interactively; an offline single-file player is a possible later deliverable |
| Arabic/RTL | `references/arabic-rtl.md`, `lang-ar.css`, fonts | **C**: future internationalisation; mirroring layout is the author's job upstream, ArchFlow's layout already supports right-to-left direction |
| Code walkthrough (`code_to_svg.py`) | script present | **D**: outside ArchFlow's scope |
| Companion agent | `agents/diagram-animator.md` | **D**: an agent that writes animation code |

## 4. Technical compatibility summary

| Feature | Canonical JSON | Scenario JSON | TS packages | WASM engine | Browser | WebM VP9 | Cloudflare | Goldens | Windows | Needs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auto camera (tour, follow, scroll, group) | none at first | optional `camera` later | new module in `engine-host` or `apps/web` | unchanged (uses `Framing.bounds`) | yes | yes, same painter | yes | new goldens; existing unchanged when the camera is off | yes | data + TS only |
| Themes via design systems | optional `theme` id | none | adapter | **native** | yes | yes | yes | new goldens per theme; default unchanged | yes | data only |
| Focus/dim and intro effects | none | optional | adapter emits `effect` steps | **native** | yes | yes | yes | new goldens | yes | data only; parity of effect drawing to verify |
| Contact sheet | — | — | dev script in `packages/qa` | — | Chrome (existing puppeteer) | — | — | reads goldens | yes | no new dependency [A] |
| Boundary assertions | — | — | test helpers | — | — | — | — | adds tests | yes | none |
| Narration cues | — | `cues` | parser + retiming | unchanged | yes | needs audio track | yes | new | yes | AudioEncoder; P2 |
| Bundled icons | node `icon` | — | adapter + asset pipeline | native icon support [U] | yes | yes | yes | new | yes | asset licence work |

## 5. Benchmarks

**No benchmark was executed in this phase.**

- The upstream pipeline needs HyperFrames, a Chrome download, FFmpeg, bash and GSAP. Installing GSAP is against the project rules.
- ArchFlow-side experiments would need new code. The stop conditions allow code only in an isolated scratch directory, and the value of each experiment depends on approval of the direction.

Proposed experiments, all runnable in a scratch copy without touching fixtures or goldens:

| # | Diagram | Experiment | Measure |
| --- | --- | --- | --- |
| 1 | linear-3 | auto camera on a 3-node diagram | camera must stay off (6-node rule); output byte-identical to today |
| 2 | AWS ALB + health checks | guided tour on request hops, group zoom on the target group during the unhealthy note | label legibility at 1280x720 (rendered text height of at least 12 px), no clipped focus node, determinism of two exports |
| 3 | API Gateway → Services → Kafka → Consumers → PostgreSQL | follow-cam on one request end to end | camera path continuity (no jump over 1/10 of the view per frame), export time overhead under 10 % |
| 4 | 30–50 node generated diagram (from `corpus:generate`) | tour versus static fit | smallest label on screen in px, frames where the active node is off screen (target 0) |
| 5 | Mermaid sequence with `par`, `-x`, retries | vertical scroll + focus/dim | active message always in view, dimmed elements at 0.3 opacity, parallel branches both visible |

Effects and design systems also need a parity check: ArchFlow's painter must draw engine effect frames exactly as the upstream player does. This was not tested [U].

## 6. Limitations of this audit

- The upstream scripts were read, not run.
- GSAP's licence text was not re-reviewed, because GSAP is rejected by project rule regardless.
- HyperFrames' licence was taken from its GitHub repository metadata (Apache-2.0). Its npm package has no `license` field.
- How the engine resolves icons was not traced.
- Font Reserved Font Names were not checked per family.
- The gallery's camera demos were read, not rendered.
