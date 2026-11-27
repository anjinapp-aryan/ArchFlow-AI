# Feature adoption matrix: animated-diagrams-skill

Upstream: https://github.com/omkamal/animated-diagrams-skill at `3de812d90c94baa4f9761684f36c3c322f1fb38c`. Evidence is in [ANIMATED_DIAGRAMS_SKILL_AUDIT.md](ANIMATED_DIAGRAMS_SKILL_AUDIT.md) and licences are in [LICENCE_COMPATIBILITY.md](LICENCE_COMPATIBILITY.md).

Classification: **A** adopt · **B** adapt · **C** reference · **D** reject · **E** investigate further.

"Code reuse" means copying upstream source. Under every B below, ArchFlow re-implements the idea in its own TypeScript and copies no upstream code.

| # | Feature | Upstream implementation | ArchFlow gap | Class | Complexity | Licence status | Priority | GO / NO-GO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Camera: guided tour (hop to the active component, end on overview) | `assets/template/composition.html:71-87` (`camFit`, `camFitAll`, `camPanTo`, `camHome`); gallery demo `tour` | Large diagrams are unreadable in exported video; zoom exists only interactively | **B** | Medium | Idea only; no code copied | **P0** | **GO** |
| 2 | Camera: follow-cam (track a packet) | `composition.html:89-97` (`camFollow`, `getPointAtLength`) | Same; long single requests | **B** | Medium | Idea only | **P0** (after 1) | **GO** |
| 3 | Camera: group zoom ("pulse-zoom") | `references/camera-large-flows.md` [D]; gallery demo | Focusing a target group or VPC during an incident | **B** | Low once 1 exists | Idea only | P1 | **GO** |
| 4 | Camera: vertical scroll for sequences | gallery demo `scroll` | Long sequence diagrams shrink to fit | **B** | Low once 1 exists | Idea only | P1 | **GO** |
| 5 | Camera: conveyor | gallery demo `conveyor` | Covered by 2 | **C** | — | — | — | NO-GO as a separate mode |
| 6 | Camera: reveal-pan | `camera-large-flows.md` [D] | Cinematic only; hides the user's diagram at the start | **D** | — | — | — | NO-GO |
| 7 | Camera readability rules (no camera for 6 nodes or fewer, max zoom, one move at a time, rest between moves, end on overview with a hold) | `camera-large-flows.md`, `animation-choreography.md` [D] | No rules exist yet | **A** (as rules, not code) | Low | Facts and ideas | P0 (with 1) | **GO** |
| 8 | Themes as design tokens | `assets/themes/*.css`, `assets/template/theme.css:37-101` | Diagram has one look; the engine's native `designSystems` are unused | **B** onto engine design systems | Low–Medium | Own colour values; upstream values optional with attribution | **P1** | **GO** for light, dark, blueprint, high-contrast |
| 9 | Decorative presets (sketch, pastel, glass, brutalist, vivid, editorial) | same | Lower technical clarity; decorative fonts | **D** | — | OFL fonts would add weight | — | NO-GO |
| 10 | Per-preset "motion languages" | `references/style-presets.md` [D] | Not applicable; motion is defined by event semantics | **D** | — | — | — | NO-GO |
| 11 | Five-act choreography rules (order, timing table, at most two motion threads, resolve and hold) | `references/animation-choreography.md` [D] | No written timing rubric | **C** | Low | Ideas | P1 (as synthesizer guidelines) | **GO** as reference |
| 12 | Optional intro (nodes fade or pop in flow order, then connectors) | template comment `composition.html:102-133` | Diagram is static at t = 0 | **B** via engine `effect` steps | Medium | Idea only | P2 | **GO** only if off by default |
| 13 | Exclusive focus: dim non-participants | `references/sequence-interactions.md` [D]; `examples/sequence-diagram/index.html` | Busy diagrams compete for attention | **B** via engine `effect` opacity tracks | Medium | Idea only | P1 | **GO** after an effect parity check |
| 14 | Contact sheet of key frames | `scripts/render.mjs:95-110` (HyperFrames snapshot) | Golden approval means opening PNGs one by one | **B** (dev-only script over existing goldens) | Low | Idea only | **P1** | **GO** |
| 15 | Boundary verification (frame before a beat shows nothing of it) | `references/voiceover-sync.md` [D] | No assertion that packets do not appear before their event | **B** (unit assertions on display lists) | Low | Idea only | P1 | **GO** |
| 16 | Output sanity probe (size, duration) | `render.mjs:113-128` | Partly present (decode check in Phase 1 report); CI coverage not verified | **C** | Low | Idea only | P2 | **GO** if missing |
| 17 | Semantic SVG id contract and layers | `references/diagram-svg-authoring.md`, `composition.html:39-53` | Canonical model already has stable ids; no SVG renderer | **C** | — | — | — | Reference only |
| 18 | SVG id recovery (Graphviz, Mermaid) | `scripts/svg_prep.py` | Only if rendered-SVG import is ever needed | **C** | Medium | Apache-2.0 (no copy planned) | P2 | Reference only |
| 19 | "Rebuild from PNG, never trace geometry" | `diagram-svg-authoring.md` [D] | Conflicts with principle 7 | **D** | — | — | — | NO-GO |
| 20 | Sequence direction-aware messages, activation growth | `sequence-interactions.md`, example | Already implemented in ArchFlow importers and synthesizer | **C** | — | — | — | Nothing to do |
| 21 | SRT/VTT cues mapped to scenario events | `scripts/srt_to_cues.py` | No narration support | **E** | Medium (High with audio) | Write own parser | P2 | Postpone |
| 22 | Audio muxing into exports | HyperFrames + FFmpeg [D] | No audio | **E** | High | Opus via WebCodecs; no new dependency [A] | P2 | Postpone |
| 23 | Transparent-background export | `style-presets.md` [D] | No alpha export | **E** | Medium | — | P2 | Postpone |
| 24 | Static SVG export | `scripts/export_svg.mjs` (not run) | No vector still export | **E** | Medium | — | P2 | Investigate |
| 25 | Offline single-file interactive HTML | `scripts/inline_html.mjs` | App is the player; no offline file | **C** | Medium | — | P2 | Investigate |
| 26 | Arabic/RTL typography | `references/arabic-rtl.md`, `assets/themes/lang-ar.css` | No internationalisation yet | **C** | Medium | Fonts OFL-1.1 | P2 | Postpone |
| 27 | Bundled icon pack (small, MIT/ISC, local) | `assets/icons/` (FA6 CC-BY + own glyphs) | Nodes have no icons | **E** | Medium | Per-icon licence work; engine icon support unverified | P2 | Investigate |
| 28 | Iconify fetching (`fetch_clipart.mjs`) | `scripts/fetch_clipart.mjs` | — | **D** | — | Per-set, mixed; unsanitised SVG insertion; remote API | — | NO-GO |
| 29 | Official vendor logos by default | `diagram-svg-authoring.md` [D] | — | **D** | — | Trademarks | — | NO-GO |
| 30 | GSAP core + DrawSVG + MotionPath + MorphSVG | `assets/vendor/gsap/` | — | **D** | — | GSAP Standard "No Charge" licence, not open source | — | NO-GO |
| 31 | HyperFrames + headless Chrome + FFmpeg rendering | `package.json`, `scripts/render.mjs` | — | **D** | — | Apache-2.0 (repository), large LGPL/native dependency tree | — | NO-GO |
| 32 | Code walkthrough mode | `scripts/code_to_svg.py` | Out of scope | **D** | — | — | — | NO-GO |
| 33 | Companion agent writing animation code | `agents/diagram-animator.md` | Conflicts with principle 5 | **D** | — | — | — | NO-GO |

No feature is classified **A** for code. The only **A** item is a set of written readability rules (row 7).
