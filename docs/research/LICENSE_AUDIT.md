# ArchFlow AI — Phase 0 License Audit

Audit date: 2026-11-25. Method: read the LICENSE/NOTICE files in each clone, ran `license-checker-rseidelsohn --production` against the installed `node_modules` of CogniFlow and the animated-diagrams-skill, inspected the published npm tarball of `hyperframes@0.6.91`, queried `npm view` / `gh api` for current license metadata, and inspected the DLLs in the AnimatedDiagrams v2.2.0 Windows release. This is an engineering audit, not legal advice. Anything marked E is rejected until verified.

Classes: **A** permissive open source · **B** open source with obligations · **C** free of charge but not open source · **D** commercial/paid · **E** unclear — reject until verified.

## 1. Repository licenses

| Repository | License (verified in repo) | Copyright holder | Class | Notes |
|---|---|---|---|---|
| codeRATny/AnimatedDiagrams | MIT (`LICENSE`) | "Animated Diagrams contributors" (2026) | A | Third-party notices file is **incomplete** (see §3). |
| PrashobhPaul/CogniFlow | MIT (`LICENSE`, `package.json`) | Prashobh Paul (2026) | A | Default ML models are Apache-2.0 per README (not independently verified — models are not in the repo, `public/models` holds only a README). |
| heygen-com/hyperframes (the real project) | Apache-2.0 (`LICENSE`; `npm view hyperframes license` = Apache-2.0 at v0.9.94) | HeyGen | A | **But** the pinned npm version used by the skill (0.6.91) has no `license` field and no LICENSE file in the tarball → class E for that exact artifact. Use ≥0.9.x or build from the repo. |
| **hyperframes/hyperframes (URL given in the brief)** | **None** (repo contains one README, 2 commits, created 2026-07-03) | — | **E → REJECT** | Not the software. README is marketing copy pointing to `heygen-com/hyperframes`. No code, no license. |
| omkamal/animated-diagrams-skill | Apache-2.0 (`LICENSE`) + `NOTICE` | Omar Kamal (2026) | A (own code) | Bundles GSAP (class C), fonts (OFL), FA icons (CC-BY). |
| xyflow/xyflow | MIT | webkid GmbH (2019–2025) | A | |
| mermaid-js/mermaid | MIT | Knut Sveidqvist (2014–2022) + contributors | A | |
| drawcms/drawcms | **AGPL-3.0-only** (`LICENSE`) + optional commercial license (`COMMERCIAL-LICENSE.md`), CLA required for contributions, trademark policy | DrawCMS owner | **B (strong copyleft, network clause)** | Also depends on GSAP 3.14.2 (class C). Incompatible with a permissive-only policy. |

## 2. Dependency classification

### 2.1 GSAP (core + plugins) — the headline problem

| Item | Finding |
|---|---|
| License | "GSAP Standard 'No Charge' License" (gsap.com/standard-license). npm shows `Custom: https://gsap.com/standard-license`. |
| Class | **C — free of charge, NOT open source.** |
| Plugins (DrawSVG, MotionPath, MorphSVG, SplitText…) | Now included in the same free license (previously paid "Club" plugins). Same terms. |
| Restriction that matters to ArchFlow | The license prohibits use in tools that let users build visual animations without code where that competes with Webflow's visual animation builder ("Prohibited Uses" / "Competitive Products": any tool that lets users create, edit or manage animations through a visual interface or builder similar to Webflow). Webflow may also revise the license by posting new terms. |
| Why it is a risk for ArchFlow | ArchFlow generates and lets users play/seek/edit animations. Whether that is a "Competitive Product" is a legal question I cannot settle. The requirement is genuinely FOSS, so the safe decision is **do not put GSAP in the product, bundle it, or require it**. |
| Who pulls it in | animated-diagrams-skill (hard dependency: `gsap@3.15.0`, vendored dist files + plugins); HyperFrames (`gsap ^3.15.0` in `@hyperframes/core`; GSAP is one *adapter*, not a requirement — core has an adapter interface and also supports CSS/WAAPI/Lottie/Anime.js/custom); drawcms (`gsap 3.14.2`). HyperFrames' own CREDITS.md states GSAP is "not an OSI open-source licence". |
| Not pulled in by | AnimatedDiagrams (C++ engine), CogniFlow (SMIL + own frame painter), xyflow, mermaid. |

Source for the clause text: gsap.com/community/standard-license (retrieved via web search 2026-11-25; I did not diff the live page against a saved copy).

### 2.2 HyperFrames and its toolchain

| Component | License | Class | Note |
|---|---|---|---|
| `heygen-com/hyperframes` packages (core, producer, engine, player, cli…) at 0.9.94 | Apache-2.0 (all `packages/*/package.json` I grepped say Apache-2.0) | A | |
| `hyperframes@0.6.91` (npm, pinned by the skill) | `license` field missing; no LICENSE in tarball (`license-checker` → UNKNOWN) | **E** | Resolved by upgrading. |
| `mediabunny` (used in studio) | MPL-2.0 | B | File-level copyleft; studio only. |
| Parakeet TDT 0.6B v3 speech model (optional download) | CC-BY-4.0 | B | Attribution; not needed. |
| `sherpa-onnx` | Apache-2.0 | A | Optional. |
| `puppeteer` / `puppeteer-core` | Apache-2.0 | A | |
| Chrome / `chrome-headless-shell` (downloaded to `~/.cache/hyperframes/chrome`) | Chromium is BSD-style; the Google-distributed binary's bundled-codec/redistribution terms were **not verified** | **E (redistribution)** | Fine to *use* locally; do not redistribute the binary until verified. |
| FFmpeg (system binary on the test machine: Gyan "full_build") | **GPL-3.0** build (includes x264/x265 etc.) | B (strong) | Using it as an external process is generally fine; *bundling/distributing* it makes the product GPL-obligated. Use an LGPL build or user-supplied FFmpeg. |
| Three.js, three-mesh-bvh, opentype.js, d3-delaunay, Clipper, fonts (Geist, Archivo, Cormorant), Poly Haven HDR | MIT / MIT / MIT / ISC / BSL-1.0 / OFL / CC0 | A (OFL = B-light) | Catalog blocks only; not needed. |
| Docker | Not part of the product. Not running during test (`doctor` reports "Docker running ✗"); not needed for local rendering. | — | |

### 2.3 AnimatedDiagrams v2.2.0 (Windows release zip, SHA-256 verified against the release's SHA256SUMS)

| Component | Evidence | Class | Note |
|---|---|---|---|
| Own code | MIT | A | |
| FFmpeg libs (`avcodec-63.dll`, avformat, avfilter, swscale, swresample, avutil) | `avcodec-63.dll` self-reports "libavcodec license: LGPL version 3 or later" | **B** | Dynamic linking, good. Obligations: ship LGPL text + notice, offer source / relink ability. |
| H.264 encoder at runtime | `VideoEncoder.cpp` tries `libx264 → libopenh264 → h264_mf → mpeg4`. Output on this machine: H.264 *Constrained Baseline* (inferred: not libx264, which would make the build GPL and which normally emits High profile; the opened encoder was not logged). | B/E | H.264 patent licensing is a separate question (openh264 binary from Cisco is royalty-covered only when Cisco's binary is used; Media Foundation relies on OS licensing). **Default to VP9/AV1/WebM** for unencumbered output; treat H.264 as best-effort. Which exact encoder opened on this machine was not logged. |
| Qt 6 (Core, Gui, Widgets, Network, Svg DLLs) | Shipped in zip | **B** (LGPL-3.0 / GPL-3.0 / commercial tri-license; free edition is LGPL-3 for these modules) | Dynamic DLLs → compliant pattern, but see compliance gap below. |
| pugixml (MIT), zlib (Zlib), libzip (BSD-3), nanosvg (Zlib) | `vcpkg.json` | A | |
| merman (Mermaid parser in Rust, MIT OR Apache-2.0) + Rust deps (MPL-2.0, BSL-1.0, Unicode-3.0, BSD, Zlib) | `THIRD_PARTY_NOTICES.md`, `merman/CRATES.md` | B (MPL-2.0 unmodified) | |
| python-pptx default template | MIT | A | |
| **Compliance gap** | `THIRD_PARTY_NOTICES.md` (37 lines) lists only python-pptx and merman. It does **not** mention Qt, FFmpeg, pugixml, zlib, libzip or nanosvg, though the release zip ships Qt and FFmpeg DLLs. | — | If ArchFlow redistributes this binary we must add the missing notices/LGPL texts ourselves. Reported as an upstream issue candidate. |
| Bundled plugins/skills | `cloud-kit.json`, `data-platform.json`, `security-kit.json` (own, MIT); brand/trademark names used nominatively | A | |

### 2.4 CogniFlow (production dependency tree, 318 packages)

`license-checker --production --summary`: MIT 251, ISC 27, BSD-3-Clause 16, Apache-2.0 9, MPL-2.0 2, 0BSD 2, plus single entries listed below. No GPL/AGPL runtime dependency.

| Package | License | Class | Note |
|---|---|---|---|
| `@xyflow/react`, `@xyflow/system` | MIT | A | |
| `gifenc` | MIT | A | |
| `mp4-muxer`, `webm-muxer` | MIT | A | |
| `pptxgenjs` | MIT | A | |
| `simple-icons` (brand logos) | CC0-1.0 (icons) | A | Brand logos remain trademarks of owners. |
| `@huggingface/transformers` | Apache-2.0 | A | Optional AI path. |
| `jszip` | MIT **OR** GPL-3.0-or-later | A (choose MIT) | Dual license; MIT elected. |
| `lightningcss` | MPL-2.0 | B | Build-time CSS tool; file-level copyleft, not shipped in output. |
| `@img/sharp-win32-x64` | Apache-2.0 AND LGPL-3.0-or-later (libvips) | B | Dev/build-time (`sharp` is a devDependency); not in browser bundle. |
| `caniuse-lite` | CC-BY-4.0 | B (attribution) | Build-time data. |
| Radix UI, react, zustand, zod, tailwind, lucide, etc. | MIT/ISC | A | |
| ML models SmolLM2-360M / SmolVLM-500M-Instruct (downloaded at build, ~630 MB) | README says Apache-2.0 | **E until the model cards are checked** | Not downloaded in this audit. |
| 3D icon set, `icons3d.ts` | Original to repo (MIT) | A | |

### 2.5 animated-diagrams-skill bundled assets

| Asset | License | Class |
|---|---|---|
| GSAP + DrawSVG/MotionPath/MorphSVG (`assets/vendor/gsap`) | GSAP No Charge | **C** |
| Fonts (Inter, Cairo, Amiri, Tajawal, Reem Kufi, Caveat, Fraunces, Archivo, Nunito, Space Grotesk, IBM Plex Mono, JetBrains Mono) | SIL OFL 1.1 | B-light (ship license text, don't sell the fonts alone) |
| Font Awesome 6 Free icon subset (`fa6-common.svg`) | CC-BY 4.0 | B (attribution) |
| Iconify clipart fetched at authoring time | Per-set (Apache/MIT/CC-BY/CC-BY-SA/ISC…) | **E** — per-asset, includes CC-BY-SA (share-alike) sets; unacceptable to ship unreviewed |
| Own icons/themes/templates | Apache-2.0 | A |

### 2.6 drawcms

AGPL-3.0-only app (B, strong) + gsap (C) + `gif.js`, `mp4-muxer` and a Next.js/Cloudflare stack. Even if every dependency were clean, AGPL §13 requires offering source to network users of a modified version, and contributions require a CLA that enables the owner's dual-licensing. Not compatible with the stated permissive-only policy. **Reading its code for ideas then re-implementing is a clean-room risk; do not copy.**

### 2.7 mermaid-js/mermaid and xyflow/xyflow

Both MIT at repo level. I did not run `license-checker` across their full dev/transitive trees (mermaid's install includes `canvas`, `cypress`, `puppeteer` for tests/e2e). For runtime use only the published packages (`mermaid`, `@xyflow/react`) matter; `@xyflow/react`'s own tree is covered by the CogniFlow audit above (xyflow packages are MIT with a small dependency set). A full SBOM scan of `mermaid` is a Phase 1 gate if we adopt it.

## 3. Findings that change decisions

1. **The supplied HyperFrames URL is a decoy stub**; the real, Apache-2.0 project lives at `heygen-com/hyperframes`.
2. **GSAP is class C** with a Webflow-competition clause → excluded from the product. This eliminates animated-diagrams-skill's and drawcms's runtimes as foundations.
3. **drawcms is AGPL** → reference-only.
4. **The skill's pinned `hyperframes@0.6.91` has no license metadata** → class E; use ≥0.9.x if HyperFrames is adopted at all.
5. **AnimatedDiagrams' release omits Qt/FFmpeg LGPL notices** → fixable, must be fixed before we redistribute.
6. **Local FFmpeg is a GPL build** → never bundle it; prefer LGPL or user-supplied.
7. **MP4/H.264 has encumbrances** that WebM (VP9/AV1) does not → make WebM the default, MP4 best-effort.

## 4. Verification still outstanding

- Model cards for SmolLM2/SmolVLM (CogniFlow) — not fetched.
- Google's redistribution terms for the downloaded `chrome-headless-shell` — not verified.
- Full transitive license scan of mermaid and xyflow monorepos — not run.
- PlantUML (requested input format) — no candidate repo supplied; PlantUML itself is multi-licensed and was **not** audited. Class E until a parser option is chosen.
