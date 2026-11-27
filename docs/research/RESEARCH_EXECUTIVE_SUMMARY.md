# Executive summary: animated-diagrams-skill audit

Repository: https://github.com/omkamal/animated-diagrams-skill, audited at `3de812d90c94baa4f9761684f36c3c322f1fb38c` (2026-06-12, no tags or releases). Research only; nothing in ArchFlow was changed except these five documents.

Details: [audit](ANIMATED_DIAGRAMS_SKILL_AUDIT.md) · [adoption matrix](FEATURE_ADOPTION_MATRIX.md) · [licences](LICENCE_COMPATIBILITY.md) · [recommended improvements](RECOMMENDED_ARCHFLOW_IMPROVEMENTS.md).

## Overall recommendation

**Adopt ideas, not code.**

- **What the repository is:** a one-day-old Claude Code skill.
  - It has 7 commits by one author and no tests.
  - Its core model is a language model hand-writing an SVG scene and a GSAP timeline, rendered by HyperFrames with headless Chrome and FFmpeg.
  - That model breaks four ArchFlow principles: no GSAP, AI emits JSON only, no native server rendering, preserve the user's layout.
- **What is valuable:** its craft rules for large-diagram camera work, theme tokens and visual QA.
- **Most important finding: ArchFlow already has the machinery.** This was found while checking ArchFlow against the audit, and is not yet in ArchFlow's documentation.
  - The pinned AnimatedDiagrams engine already has **data-driven design systems** and **keyframe effect steps**, both unused by ArchFlow today.
  - ArchFlow's painter already accepts a **per-frame world rectangle**.
  - So the best ideas can be built with **no new dependency and no engine change**.

## Best features worth adopting

1. **Deterministic auto camera:** guided tour, then follow-cam. Built as a pure TypeScript function from time to view rectangle, used by both playback and WebM export. **P0, GO.**
2. **Theme presets** (light, dark, blueprint, high contrast) through the engine's own design systems. **P1, GO.**
3. **Golden contact sheet and event-boundary assertions** for faster and safer visual QA. **P1, GO.**

Also recommended: focus/dim of non-participants through engine effects (P1, GO after an effect parity check), and group zoom and vertical scroll for sequences (P1, GO).

## Features to reject

- GSAP and all its plugins.
- HyperFrames, headless-Chrome and FFmpeg rendering.
- Iconify fetching: remote, mixed licences, unsanitised SVG insertion.
- Vendor logos by default.
- Rebuilding a diagram from an image instead of preserving its geometry.
- Decorative presets: sketch, pastel, glass, brutalist, vivid, editorial.
- Per-style "motion languages".
- Reveal-pan.
- Code-walkthrough mode.
- The code-writing companion agent.

## Risks

- **Camera:**
  - it can cut off context or move too often;
  - mitigation: strict rules (off for 6 nodes or fewer, maximum zoom 2.2x, dwell of at least 1 s, one move at a time, end on the overview) and the acceptance tests in the improvements document.
- **Effects and design systems:** ArchFlow has never used them, so painter parity with the upstream player is unproven. Each needs a parity test first.
- **Goldens:** new features must default to off for existing fixtures, so the `linear-3`, `order-flow` and `aws-alb` goldens stay unchanged. New goldens need approval.
- **Licensing:** no risk if no upstream code or assets are copied, which is the recommendation. Unresolved upstream items (GSAP terms, HyperFrames npm licence field, icon authorship, font provenance, audio licence) concern only rejected items.

## Answers to the required questions

1. **Is this repository genuinely useful to ArchFlow AI?**
   - Moderately, as a source of design rules and ideas.
   - Not as a code or dependency source.
2. **Which three features give the greatest practical value?**
   - Auto camera for large diagrams.
   - Theme presets.
   - Contact-sheet and boundary QA.
3. **Which can be adopted without any new production dependency?**
   - All recommended ones: camera, themes, focus/dim, intro, contact sheet, boundary assertions, cue parsing.
   - Only audio narration and icons might need new assets or encoders later.
4. **Which can be implemented with the existing WASM engine?** All of them.
   - The camera uses the existing per-frame framing in ArchFlow's painter.
   - Themes use engine design systems.
   - Focus/dim and the intro use engine effect steps.
   - Engine source and the pinned revision `3ce17fc3…` stay unchanged.
5. **Which would materially improve today's architecture-diagram visualisation?**
   - The auto camera, most of all for diagrams with more than 6 components and for exported video.
   - Focus/dim for busy diagrams.
   - Themes for presentation settings.
6. **Can any useful source code be reused legally?**
   - Yes. The author's own non-GSAP code is Apache-2.0 and can be included in the MIT project with its licence, notice and change marks.
   - It is not worth it: the useful pieces are a few lines of arithmetic tied to GSAP calls. Re-implement and cite the source instead.
   - GSAP files must never be reused.
7. **Is any feature worth adapting into the canonical model?**
   - Later, an optional scenario `camera` object (schema minor 3) holding explicit keyframes on node or group ids, as validated data.
   - Phase A needs no schema change.
   - A saved theme choice and narration `cues` are possible later additions.
8. **Which features should be postponed?**
   - Narration and audio.
   - Transparent-background export.
   - Static SVG export.
   - Offline single-file player.
   - Bundled icons.
   - Arabic/RTL typography.
   - The intro reveal.
9. **Does anything justify changing the approved architecture?** No. The audit strengthens the current choice: everything valuable fits the pinned WASM engine, browser rendering, WebM VP9 export and Cloudflare static hosting.
10. **What should be the next implementation phase?**
    - Contact sheet first.
    - Then camera phase A: guided tour in playback and export.
    - Then follow-cam and group zoom, boundary assertions, themes, and focus/dim after the effect parity check.

## Prioritised recommendation

| Priority | Items |
| --- | --- |
| **P0** | Deterministic auto camera (guided tour, follow-cam) with the readability rules |
| **P1** | Theme presets via engine design systems; golden contact sheet; event and camera boundary assertions; focus/dim via engine effects; group zoom; vertical scroll for sequences |
| **P2** | Optional intro reveal; narration cues and audio; bundled MIT/ISC icon subset; transparent export; static SVG export; offline player; RTL typography |
| **Reject** | GSAP and plugins; HyperFrames, Chrome and FFmpeg rendering; Iconify fetching; vendor logos by default; rebuild-from-image; decorative presets and motion languages; reveal-pan; conveyor as a separate mode; code walkthrough; companion agent |

## GO / NO-GO per proposed adoption

| Proposal | Decision |
| --- | --- |
| Auto camera (tour, follow, group, sequence scroll) | **GO** |
| Camera readability rules | **GO** |
| Themes: light, dark, blueprint, high contrast | **GO** |
| Contact sheet (dev only) | **GO** |
| Boundary assertions | **GO** |
| Focus/dim | **GO** after the effect parity test |
| Intro reveal | **GO** only as an off-by-default option, P2 |
| Narration cues | NO-GO now; revisit |
| Icons | NO-GO now; investigate the engine's icon path first |
| Every rejected item above | **NO-GO** |

**Stop point:** implementation waits for explicit approval.
