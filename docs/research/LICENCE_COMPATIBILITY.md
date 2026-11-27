# Licence compatibility: animated-diagrams-skill

Upstream: https://github.com/omkamal/animated-diagrams-skill at `3de812d90c94baa4f9761684f36c3c322f1fb38c`. ArchFlow AI is MIT licensed ("Copyright (c) 2026 Anjinappa N").

This is an engineering assessment, not legal advice. **[V]** means verified in files or registry metadata during this audit; **[D]** means stated only by upstream; **[U]** means unresolved.

## 1. Upstream project licence

- **Licence:** `LICENSE` is the Apache License 2.0 [V]. GitHub reports `Apache-2.0` [V].
- **NOTICE:** `NOTICE` reads "Copyright 2026 Omar Kamal" [V]. It says the bundled third-party components keep their own licences [V].
- **Scope:** Apache-2.0 covers the author's own scripts, templates, themes, references and the four "original" icon sheets [D: authorship of the icons is claimed, not provable from the repository].
- **Compatibility with MIT:** yes. Apache-2.0 code may be included in an MIT project if ArchFlow:
  1. keeps a copy of the Apache-2.0 licence with the copied code;
  2. keeps the upstream copyright notice and the relevant parts of `NOTICE`;
  3. marks modified files as changed;
  4. accepts the Apache-2.0 patent-termination clause for that code.

  The combined work can stay MIT for ArchFlow's own code. Copied files remain Apache-2.0.

### Can the non-GSAP code be reused independently?

Yes, legally.

- The camera helpers, `svg_prep.py`, `srt_to_cues.py`, `render.mjs`, the CSS themes and the references are the author's Apache-2.0 work.
- None of them includes or derives from GSAP source code.
- The camera helpers and examples **call** GSAP APIs (`tl.to`, `gsap.set`), so as code they are useless without GSAP.

**Recommendation:** copy no upstream code. Each useful algorithm is a few lines of arithmetic:

- the camera fit is `min(W/(w*pad), H/(h*pad), maxZoom)` plus centring;
- the SRT parsing is two regular expressions.

ArchFlow should re-implement both in TypeScript against its own data model. Ideas, rules and numbers such as timing tables are not copyrightable expression. As a courtesy, the design documents should still cite the upstream repository as the source of the ideas.

**If any upstream file is later copied verbatim,** put it in its own file with an SPDX header (`Apache-2.0`) and the upstream copyright. Add an entry to ArchFlow's third-party notices and to `licenses:check`.

## 2. Third-party components

| Component | Version / files | Licence | Category | Bundled upstream? | ArchFlow decision |
| --- | --- | --- | --- | --- | --- |
| GSAP core | 3.15.0, `assets/vendor/gsap/gsap.min.js` | GSAP Standard "No Charge" licence; file header: "Copyright 2026, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license." [V]; npm `license` field the same [V] | **Free but not open source**; terms set by the vendor. The current terms were not re-read in this audit [U] | **Yes, committed to git** [V `git ls-files`]. `licenses/THIRD_PARTY.md` says the files are "installed … by scripts/setup.sh", but they are also committed | **REJECT** (project rule; not OSI licensed) |
| DrawSVGPlugin | 3.15.0 | same GSAP licence [V header] | same | yes | **REJECT** |
| MotionPathPlugin | 3.15.0 | same | same | yes | **REJECT** |
| MorphSVGPlugin | 3.15.0 | same | same | yes | **REJECT** |
| HyperFrames | npm `hyperframes` 0.6.91 | npm metadata has **no licence field** [V]. The source repository `heygen-com/hyperframes` reports Apache-2.0 on GitHub [V] | open source at repository level; package-level licence unresolved [U] | no (npm dependency) | **REJECT**: native, server-side rendering |
| HyperFrames dependency tree | 220 lockfile packages | 139 MIT, 33 Apache-2.0, 16 BSD-3-Clause, 9 ISC, 5 BSD-2-Clause, **14 with LGPL-3.0-or-later** (sharp/libvips binaries), plus 0BSD, MIT-or-CC0 and 2 without a licence field (GSAP and HyperFrames) [V lockfile] | mixed; the LGPL native binaries carry relinking and notice duties | no | **REJECT** together with HyperFrames |
| `onnxruntime-node`, `@google/genai` (optional), `puppeteer-core`, Chrome download | dependencies of HyperFrames [V] | MIT / Apache-2.0; Chrome has its own terms | `snapshot --describe` uses Gemini vision unless `--describe false` [D] (`render.mjs` passes `false` [V]) | no | **REJECT**: external AI API and browser download |
| FFmpeg | system binary, called by `render.mjs` [V] | LGPL-2.1+ or GPL depending on build [general knowledge] | not bundled | no | **REJECT**: ArchFlow encodes in the browser with WebCodecs |
| Fonts (14 files) | `assets/fonts/*.woff2`: Inter, Archivo, Nunito, Space Grotesk, Caveat, Fraunces, IBM Plex Mono, JetBrains Mono, Cairo (two files), Amiri, Tajawal (two files), Reem Kufi | SIL OFL 1.1 [V `licenses/OFL.txt`, per-family copyright list in `licenses/THIRD_PARTY.md`] | open, attribution (licence + copyright must accompany the files); fonts may not be sold alone | yes | Not needed now. If ever bundled, take the fonts **from their upstream releases**, not these files, because these may be subsets with unknown provenance. Check Reserved Font Names per family before subsetting [U] |
| Font Awesome 6 Free subset (26 icons) | `assets/icons/fa6-common.svg` | CC-BY 4.0, © Fonticons, Inc. [V file header] | attribution required in published work; "Font Awesome" is a trademark | yes | Not adopted. Visible attribution in every exported video is a poor fit |
| "Original" glyph sheets | `assets/icons/generic.svg`, `cloud-aws.svg`, `cloud-gcp.svg`, `cloud-azure.svg` | Apache-2.0 as project work [D] | open; authorship unverifiable [U]; vendor names are trademarks | yes | Not adopted |
| Noto emoji clips | `examples/arabic-concept/cliparts/*.svg` | Apache-2.0 [D] | open | yes (examples) | Not adopted |
| Narration audio | `examples/concept-demo/audio/narration.wav` | **not stated** [V: no licence mention] | unknown | yes | Do not use |
| Rendered example videos and HTML | `examples/*/renders/*` | not stated; the interactive HTML files embed GSAP [A from size, about 800 KB] | mixed | yes | Do not use |
| Iconify sets | fetched from `https://api.iconify.design` by `scripts/fetch_clipart.mjs` [V] | per set, from upstream's table (`references/concept-illustrations.md:28-57` [D]): Apache-2.0 (noto, material-symbols, mdi, carbon, ri), MIT (fluent, bi, heroicons, tabler, ph, flat-color-icons, fluent-emoji, devicon, healthicons), ISC (lucide), CC-BY 4.0 (fa6, solar, twemoji), CC-BY 3.0 (game-icons), **CC-BY-SA 4.0** (openmoji), **"mixed/trademarks"** (logos) | varies per set, and sometimes per icon | no (fetched into the user's project) | **REJECT** the workflow. Iconify's general statement does not license any collection; each set must be checked at its own source |

## 3. Code reuse permissions

| Upstream item | May ArchFlow copy it? | Conditions | Recommended |
| --- | --- | --- | --- |
| Camera helper functions | yes (Apache-2.0) | licence, notice, change marks | **No.** Re-implement; they depend on GSAP anyway |
| CSS theme values | yes (Apache-2.0) | the same, if values are copied in bulk | Choose ArchFlow's own values and check contrast; cite the idea |
| `svg_prep.py` | yes (Apache-2.0) | the same | Reference only |
| `srt_to_cues.py` | yes (Apache-2.0) | the same | Re-implement in TypeScript if narration is approved |
| `render.mjs` probe logic | yes (Apache-2.0) | the same | Reference only |
| Reference documents | yes (Apache-2.0) | the same for verbatim text | Quote small facts only, with citation |
| GSAP files | **no** | not open source; project rule | **Never** |
| Fonts, icons, audio | see section 2 | — | none adopted |

## 4. Asset reuse restrictions

- **CC-BY assets** (Font Awesome, twemoji, solar, game-icons): attribution in every published artifact.
- **CC-BY-SA** (openmoji): derived artworks must be shared alike. Unsuitable for client work.
- **Trademarked logos** (Iconify `logos`, vendor product names): nominative use only. No official AWS, GCP or Azure icons were found in the repository; the cloud sheets are claimed to be original look-alikes [D].
- **Fonts:** OFL-1.1 forbids selling the fonts on their own and restricts Reserved Font Names in modified versions. Videos and images made with the fonts are not restricted.

## 5. Attribution obligations if the recommendations are followed

The recommended path copies no upstream code or assets, so **no new licence obligation arises**.

As good practice, ArchFlow should cite the upstream repository and commit in the design documents that adopt its ideas:

- the camera design note;
- the theme design note;
- the QA contact-sheet note.

## 6. Rejected dependencies

GSAP core, DrawSVGPlugin, MotionPathPlugin, MorphSVGPlugin, HyperFrames and its dependency tree, FFmpeg, headless Chrome rendering, the Iconify API, the Gemini vision step, and the Font Awesome subset as a default.

## 7. Unresolved legal risks

1. **GSAP licence terms** were not re-read in this audit. This does not matter for ArchFlow, because GSAP is rejected.
2. **HyperFrames npm package** has no licence field. The repository says Apache-2.0. This does not matter for ArchFlow, because HyperFrames is rejected.
3. **Authorship of the "original" icon sheets** cannot be verified. Not adopted.
4. **Font provenance and Reserved Font Names** for the bundled WOFF2 subsets. Not adopted. Take any future font from its upstream release.
5. **`narration.wav`** has no licence. Not adopted.
6. **Mismatch between `THIRD_PARTY.md` and git:** GSAP is described as installed by `setup.sh`, but it is also committed to the repository. Anyone cloning the upstream repository redistributes GSAP under GreenSock's terms. ArchFlow must never vendor or clone these files into its own repository; the research clone lives only in a scratch directory outside the repository.
