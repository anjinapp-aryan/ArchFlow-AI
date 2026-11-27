# ArchFlow AI — Dependency Decisions (Phase 0)

Date: 2026-11-25. Classes: **A** permissive · **B** open source with obligations · **C** free but not open source · **D** commercial · **E** unclear (reject until verified). Evidence in `docs/research/LICENSE_AUDIT.md`. A dependency is only approved if its license was verified from the repo/registry; "verified" below means `npm view`/LICENSE file/binary self-report on 2026-11-25. Approval is *proposed* — nothing is final until the Phase 0 sign-off.

## 1. Decision matrix — candidate repositories

| Repository | Decision | Class | Scope of use | Conditions |
|---|---|---|---|---|
| codeRATny/AnimatedDiagrams | **REUSE** (foundation) | A (own code) | Pinned release v2.2.0 as external executable; later fork/build `ad_core` | SHA-256 pin; fork readiness; add missing Qt/FFmpeg notices before redistribution; no redistribution of DLLs in Phase 1 |
| PrashobhPaul/CogniFlow | **ADAPT** (parts) / REFERENCE (rest) | A | Copy with attribution: graph schema/validator ideas (`air.ts`), model-output validation (`candidate.ts`), NL rule compiler (`compiler.ts`), serializers. Do **not** depend on the app. | Keep MIT notice; re-test on our benchmark phrasing (it misclassified several edge types) |
| heygen-com/hyperframes | **REFERENCE** now; conditional **ADAPT** (fallback renderer) | A (≥0.9.x) | Fallback renderer; determinism docs | Use only ≥0.9.x or repo build (0.6.91 has no license metadata); no GSAP adapter; Chrome redistribution unverified |
| hyperframes/hyperframes (brief's URL) | **REJECT** | E | none | README-only, no license/code |
| omkamal/animated-diagrams-skill | **REFERENCE**; **REJECT** runtime | A (own) / C (GSAP) | Ideas only: determinism rules, QA loop, camera-rig concepts | Do not copy GSAP-based timelines; do not ship LLM-authored JS |
| xyflow/xyflow | **REUSE (deferred)** | A | Only for a future web editor | Re-audit transitive tree then |
| mermaid-js/mermaid | **REFERENCE** | A | Syntax authority; optional validator | Full transitive scan if ever adopted at runtime |
| drawcms/drawcms | **REJECT** (code) | B-strong (AGPL-3.0) + C (GSAP) | none | No code copying; avoid reading source for clean-room safety |

## 2. Approved dependency list (proposed)

### 2.1 Runtime (product)

| Dependency | Version | License (verified how) | Class | Use | Obligations |
|---|---|---|---|---|---|
| AnimatedDiagrams engine | v2.2.0 (win64 zip sha256 `77f6734f7c1f2b6d0aaeb9338d5c0b9aa1b6db8824d98f776548988db973efd7`) | MIT (`LICENSE`) | A | Render engine (external process) | Keep MIT notice if redistributed |
| ↳ FFmpeg libs (avcodec 63 etc.) bundled in release | n9.0.x | LGPL-3.0-or-later (`avcodec-63.dll` self-report) | B | Video/GIF encoding | If redistributed: LGPL text, notice, source offer, dynamic linking preserved. Not redistributed in Phase 1 |
| ↳ Qt 6 (Core/Gui/Widgets/Network/Svg) bundled | 6.8 per upstream CI | LGPL-3.0/GPL-3.0/commercial tri-license (**not independently verified in the shipped DLLs**) | B | GUI toolkit needed by the CLI binary | Same as above; confirm which license applies to each shipped module before redistribution |
| ↳ merman (Mermaid parser, Rust) | 0.8.0 | MIT OR Apache-2.0 (`third_party/merman/LICENSE-MIT`) | A | Mermaid import | Notices present upstream |
| ↳ pugixml, zlib, libzip, nanosvg | vcpkg-pinned | MIT/Zlib/BSD-3/Zlib (per library; from vcpkg manifest, not scanned in the zip) | A | internals | notices missing upstream |
| Node.js | ≥22 | MIT (project license) | A | Orchestrator runtime | — |
| TypeScript | 7.0.2 | Apache-2.0 (`npm view`) | A | build-time | — |
| Zod **or** Ajv | zod 4.6.7 / ajv 8.20.0 | MIT / MIT (`npm view`) | A | Schema validation (choose one in P1.1) | — |
| Commander | 15.1.0 | MIT (`npm view`) | A | CLI parsing | — |

### 2.2 Development/test only (not shipped)

| Dependency | Version | License | Class | Use |
|---|---|---|---|---|
| Vitest | 5.1.2 | MIT | A | Unit tests |
| puppeteer-core | 25.18.1 | Apache-2.0 | A | Headless player tests |
| Chrome / chrome-headless-shell | 131 (via HyperFrames cache) | BSD-style Chromium; **Google distribution/redistribution terms unverified** | E for redistribution | Local dev/test only; never bundled |
| license-checker-rseidelsohn | 5.0.1 | BSD-3-Clause | A | License gate in CI |
| FFmpeg (`ffmpeg`/`ffprobe` CLI) | system | **GPL-3.0 build on the audit machine** | B-strong | QA tooling only (external process, never bundled). CI should use an LGPL/user-installed build |
| Bun, pnpm | 1.4.5, 10.30.3/12.21.0 | (Bun: MIT; pnpm: MIT — **not re-verified in this audit; tool-only**) | — | Only if we ever run upstream suites; not product deps |

### 2.3 Conditionally approved (not in Phase 1 default path)

| Dependency | Condition |
|---|---|
| `heygen-com/hyperframes` ≥0.9.x (Apache-2.0) | Only if fallback renderer is triggered (see PROPOSED_ARCHITECTURE §6); run without GSAP adapter; verify Chrome redistribution first |
| `@xyflow/react` (MIT) | Only for a web editor (Phase 2+) |
| Open-weight VLM/OCR/LLM models | Each model card's license must be read and recorded **before** adoption (CogniFlow's SmolLM2-360M / SmolVLM-500M "Apache-2.0" claim is unverified). Models are class-E until then. |
| SVG parsing library; PlantUML parser | Not chosen. Candidates must pass license audit first |

## 3. Rejected dependency list

| Dependency | Class | Reason |
|---|---|---|
| **GSAP core + DrawSVG/MotionPath/MorphSVG/SplitText etc.** (all versions under the "Standard No Charge" license) | C | Free but not open source; license bans use in tools enabling no-code visual animation building that competes with Webflow; terms revocable/updatable by Webflow. ArchFlow generates and plays animations → unacceptable legal exposure, and violates the FOSS requirement. Also absent from the chosen foundation, so no cost to rejecting. |
| `hyperframes@0.6.91` (npm, pinned by the skill) | E | No license field or LICENSE file in the tarball; superseded by 0.9.94 (Apache-2.0) |
| `hyperframes/hyperframes` GitHub repo | E | README-only, no license, no code |
| drawcms (AGPL-3.0-only, CLA, commercial dual-license) | B-strong | Copyleft with network clause incompatible with permissive-only policy; also bundles GSAP |
| animated-diagrams-skill *as a product dependency* | A+C mix | Its core value (LLM-authored GSAP JS) is rejected by principle 6 and GSAP; Apache-2.0 notes/ideas remain referenceable |
| Iconify cliparts fetched at authoring time (skill) | E | Per-set licenses include CC-BY-SA (share-alike) and CC-BY; unreviewed → cannot ship |
| Font Awesome 6 Free icons (CC-BY 4.0) | B | Attribution obligation; unnecessary — prefer own/Apache/MIT icon set (e.g., CogniFlow's original icons, simple-icons CC0 for brand marks with trademark caveat) |
| Any GPL-enabled FFmpeg build (e.g., Gyan "full") *bundled in the product* | B-strong | Would impose GPL on distribution; use LGPL builds or user-supplied binary |
| H.264 as the *only* video output | E/B | Patent-licensing ambiguity and encoder variance; make WebM default |
| Docker as a runtime requirement | — | Not required by any chosen path; daemon was off during the audit |
| Any paid API as a mandatory service | D | Violates the "no paid mandatory services" rule |
| `jszip` under its GPL option | B-strong | Dual-licensed; if ever used, elect **MIT** |
| `lightningcss`, `sharp` (libvips LGPL), `caniuse-lite` | B | Fine as build-time tools in CogniFlow, but not needed by our stack; avoid importing them |
| PlantUML (any parser) | E | Not audited; multi-licensed; decision deferred to Spike C |

## 4. Verification debt (must close before the corresponding use)

1. Qt module licenses for the exact DLLs we may redistribute.
2. Cisco OpenH264 vs Media Foundation vs other: which H.264 encoder ran on this machine (not logged) and its redistribution position.
3. Google `chrome-headless-shell` redistribution terms.
4. Full transitive license scans of `mermaid` and `xyflow` if adopted at runtime.
5. Model cards for any ML model we adopt.
6. Re-read GSAP's live license page and archive a copy if we decide to rely on any of its terms (we plan not to).
7. Confirm with the AnimatedDiagrams maintainer: notice completeness, release signing, plans for a headless CLI, willingness to merge Windows/notice fixes.

## 5. Single best foundation and minimum original code

- **Foundation:** AnimatedDiagrams (engine + player + exporters + importers).
- **Minimum original code:** engine wrapper, scenario schema/validator, scenario synthesizer (LLM + templates), text→doc (adapted from CogniFlow), QA harness, CLI/MCP façade; plus **three spike-dependent adapters** (SVG, raster, PlantUML) that may or may not justify their cost. No custom animation engine, no custom video encoder, no custom player.

---

## 6. P1.0 amendments (2026-11-25) — supersede conflicting Phase 0 entries above

Strategy change: the **deployed product uses the AnimatedDiagrams engine core compiled to WebAssembly**, not the native Qt/FFmpeg binary (see `RENDERER_STRATEGY.md`). Consequences: Qt, LGPL FFmpeg, libzip, pugixml, zlib and merman are **no longer product dependencies** (the native release remains a dev/reference oracle only; its Phase 0 notice gap is now irrelevant to distribution). All entries below are "proposed — pending P1.0 GO confirmation". Versions are those actually used in the spike.

| Dependency | Version / hash | License (how verified) | Class | Scope | Transitive | Status |
|---|---|---|---|---|---|---|
| AnimatedDiagrams source | v2.2.0 = commit `3ce17fc3be7cacdb6b65dce362c86674043a4baa` (GitHub API: tag → commit) | MIT (`LICENSE`) | A | Shipped (engine core compiled to WASM) | nlohmann_json, nanosvg (below) | Provisionally approved |
| nlohmann_json | v3.11.3, `json.tar.xz` SHA-256 `d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d` (pinned by upstream) | MIT (`LICENSE.MIT` read) | A | Shipped (header-only, compiled in) | none | Approved; notice required |
| nanosvg (`nanosvg.h`) | commit `93ce879dc4c04a3ef1758428ec80083c38610b1f`, SHA-256 `b0057538cd65b6d8a37a2ef7f5aa3905a14f82964b741534ca61bf20054dcc31` (pinned by upstream) | zlib license (header of `LICENSE.txt` in the repo clone read; **note**: my separate clone was a later commit `239e102e…`, license text only) | A | Shipped (compiled in) | none | Approved; notice required |
| Emscripten (emcc 7.0.1) | emsdk, SDK `releases-9146b21a…` | MIT **and** UIUC/NCSA dual (`LICENSE` read) | A | Build-time; runtime glue is embedded in output | LLVM/clang 24.0.0git, binaryen, node 24.19.0, python 3.13.3 (emsdk-bundled) | Approved build tool; **LLVM/libc++/musl license files in the sysroot must be read and recorded in P1.1** |
| Emscripten sysroot libs (libc/libc++/libc++abi) linked into the WASM | as built | expected MIT / Apache-2.0 w/ LLVM-exception — **not verified from files yet** | E until verified | Shipped | — | Verify in P1.1 |
| CMake (pip wheel `cmake` 4.4.5) | 4.4.5 | wheel metadata: "Apache 2.0" (CMake itself is BSD-3-Clause per upstream — not independently verified) | A | Build-time | — | Approved |
| Ninja (pip wheel `ninja` 1.13.2) | 1.13.2 | `License-Expression: Apache-2.0` (wheel metadata) | A | Build-time | — | Approved |
| webm-muxer | 5.1.4 (exact) | MIT (`package.json`; also in CogniFlow license scan) | A | Shipped (browser WebM muxing) | none observed (0 runtime deps in `npm ls` not separately run) | Approved |
| puppeteer-core | 25.18.1 (exact) | Apache-2.0 (`npm view`) | A | Dev/test only | 28 packages total installed in poc (not individually license-scanned yet) | Approved dev-only; run license scan in P1.1 |
| wrangler | 4.168.0 (exact) | MIT OR Apache-2.0 (`package.json`) | A | Dev/deploy tool | 79 packages installed (not scanned) | Approved dev-only; scan in P1.1 |
| workerd | (wrangler's pinned version) | Apache-2.0 (`package.json`) | A | Dev only (local Workers runtime) | platform binary | Approved dev-only |
| Chrome headless-shell 131 | cache from HyperFrames | redistribution terms unverified | E (redistribution) | Dev/test only; never shipped | — | Dev-only |

**Decisions on Phase 0 conditionals:** HyperFrames ≥0.9 stays *unused* (server-side Chromium cannot run on Workers; remains an offline fallback only). xyflow untouched. GSAP remains rejected.

**Zod vs Ajv comparison (P1 requires choosing one):** deferred to P1.1; both MIT. Decision criteria recorded there (bundle size in browser, JSON-Schema export, error-path quality). Neither is in the P1.0 PoC.

**Not yet done for any listed dependency:** full transitive license scans (`license-checker`) of the poc `node_modules` trees; this is a P1.1 CI gate.


---

## 7. P1.1 inventory and decisions (2026-11-25)

### 7.1 Engine WebAssembly artifact — closed inventory (supersedes the "to be verified" rows in §6)

Evidence: wasm-ld link map of the pinned build (`licenses/ENGINE_LINK_INPUTS.txt`, regenerated by every `npm run engine:build`; adding the map flag was verified not to change the output hash) and licence texts copied from the pinned sources by `npm run licenses:collect` (`licenses/MANIFEST.json`).

| Component | Linked how | Licence (text read) | Class | Status |
|---|---|---|---|---|
| AnimatedDiagrams `ad_engine` + `player/Player.cpp` @ `3ce17fc3…` | compiled | MIT | A | **Approved** |
| nlohmann/json 3.11.3 | header-only, compiled in | MIT (`LICENSE.MIT`) | A | **Approved** |
| nanosvg.h @ `93ce879d…` | header-only, compiled in | zlib licence (header text; also credits AGG 2.4 SVG example and canvg-derived code) | A | **Approved** |
| Emscripten runtime glue + `libemmalloc` (2 members) + `libemcc-legacysjlj` (2) + libc glue (`emscripten_*`) | linked | MIT and UIUC/NCSA (dual) | A | **Approved** |
| musl libc members: 16 from `libc.a` (`fmod`, `fmodl`, `exp2`, `exp_data`, `scalbn`, `fwrite`, `strlen`, `strerror`, `__fpclassifyl`, `__math_oflow/uflow`, `__errno_location`, `__towrite`, plus emscripten_* glue) and `libc_optz.a(pow_small)` | linked | MIT + permissive third-party parts enumerated in `COPYRIGHT` (Sun/ARM-derived math, TRE BSD-2-Clause, etc.) | A | **Approved** (notice shipped) |
| LLVM compiler-rt builtins: 15 members of `libclang_rt.builtins.a` (soft-float `__*tf3`, `__multi3`, shifts, `fp_mode`) | linked | Apache-2.0 **with LLVM Exceptions** (+ legacy UIUC/MIT text) | A | **Approved** |
| LLVM libunwind: `Unwind-wasm.o` (legacy-exception build) | linked | Apache-2.0 with LLVM Exceptions | A | **Approved** |
| LLVM libc++ | **headers only** (templates instantiated in the engine); **no libc++ or libc++abi archive appears in the link map** | Apache-2.0 with LLVM Exceptions | A | **Approved**; notice shipped as a precaution |
| llvm-libc | not in link map | Apache-2.0 with LLVM Exceptions | A | Not shipped; text kept for completeness |

Corrections to earlier statements: P1.0 documents said libc++ from the Emscripten sysroot is linked into the WASM. The link map shows only libc++ _headers_ contribute (no libc++/libc++abi archive members). No dependency in the artifact is GPL/LGPL/AGPL, non-OSI, or requires a network service. The sysroot licence question marked **E** in §6 is **closed**.

Caveat: the inventory is for the `win32-x64` build host. Emscripten's sysroot libraries are the same sources on other hosts, but a Linux/macOS link map has **not** been produced; CI uploads `link-inputs.txt` per OS so a difference would be visible.

### 7.2 Schema library: Zod vs Ajv (decision: **Zod 4.6.7, `zod/mini`**)

Measured in `poc/p11-schema-compare/` with the same node/edge/graph schema, esbuild `--bundle --minify`:

| Criterion | Zod 4.6.7 (full) | Zod 4.6.7 `zod/mini` | Ajv 8.20.0 |
|---|---|---|---|
| Browser bundle (min / gzip) | 454 KB / 92.5 KB | **16.6 KB / 5.8 KB** | 125 KB / 38.6 KB |
| Works with code generation from strings disabled (`node --disallow-code-generation-from-strings`, the equivalent of a CSP without `unsafe-eval`) | yes | **yes** | **no**: `new Function` in `ajv/dist/compile/index.js`; needs precompiled standalone validators or `unsafe-eval` |
| TypeScript types from the same definition | yes | **yes** | no (separate types or `JSONSchemaType` boilerplate) |
| Error paths | `issues[].path` arrays + codes | same | `instancePath` + `keyword` |
| JSON Schema export | `z.toJSONSchema` | not in the mini build | native |
| Licence | MIT | MIT | MIT |

Rationale: the engine is built with `DYNAMIC_EXECUTION=0` and the deployment target may impose a strict CSP; a validator that needs `eval` would undermine that. `zod/mini` is about 6.7× smaller than Ajv once gzipped (5.8 KB vs 38.6 KB). Trade-off accepted: fewer ergonomics than full Zod, and JSON-Schema export is unavailable from the mini build (a JSON Schema for third-party tooling can be generated from the full build at build time if needed). Not compared: Ajv's runtime dependency licences (not re-verified).

### 7.3 npm dependencies added in P1.1 (exact versions; licences from `npm view` / `package.json`)

| Package | Version | Licence | Shipped? | Purpose |
|---|---|---|---|---|
| zod | 4.6.7 | MIT | yes (browser bundle, `zod/mini`) | canonical-model schema; 0 runtime deps |
| typescript | 6.0.3 | Apache-2.0 | no | type checking (7.x rejected: `typescript-eslint` peer range is `<6.1`) |
| esbuild | 0.28.2 | MIT | no | bundle engine-host for the browser/QA |
| vitest | 5.1.2 | MIT | no | tests |
| puppeteer-core | 25.18.1 | Apache-2.0 | no | headless-Chrome QA; downloads no browser |
| eslint / @eslint/js | 10.15.0 / 10.0.1 | MIT | no | lint |
| typescript-eslint | 8.74.0 | MIT | no | lint |
| prettier | 3.10.1 | MIT | no | formatting |
| @types/node | 26.6.10 | MIT | no | types |
| license-checker-rseidelsohn | 5.0.1 | BSD-3-Clause | no | licence gate |

Full-tree scan (`npm run licenses:check`, 279 packages): MIT 156, ISC 64, Apache-2.0 28, BlueOak-1.0.0 14, BSD-2-Clause 8, BSD-3-Clause 4, CC0-1.0 1, **MPL-2.0 2, CC-BY-3.0 1, (MIT AND CC-BY-3.0) 1**. The four non-allow-listed entries are dev-only transitive packages, recorded as reviewed exceptions in `scripts/license-exceptions.json` with reasons: `lightningcss` (+ platform binary; MPL-2.0; pulled by vitest → vite; unmodified; not distributed) and `spdx-exceptions` / `spdx-ranges` (CC-BY-3.0 data; pulled by license-checker; not distributed). A Linux CI run installs `lightningcss-linux-x64-gnu`; an exception for it is pre-registered (same rationale) but has **not** been observed yet. The only production npm dependency is zod (MIT, no transitive dependencies; `npm ls --omit=dev`).

### 7.4 Build toolchain pins (from `engine/upstream.lock.json`)

emsdk `a7c808831a666cc903fedb906c171a718cd97341`, emscripten **7.0.1** (clang 24.0.0git, node 24.19.0 and python 3.13.3 bundled by emsdk), cmake 4.4.5 and ninja 1.13.2 (PyPI wheels). All build-time only; none shipped.

### 7.5 Still open

- Project licence of ArchFlow itself.
- webm-muxer and Zod MIT texts must be added to `licenses/` when the web app bundles them.
- Linux/macOS engine hashes and link maps (CI will produce candidates; not yet reviewed).
- Chrome redistribution terms (not distributed).


## 8. P1.4 importer dependencies (2026-11-26)

Shipped in the browser bundle (exact pins, all permissive; texts in `licenses/`, listed in `THIRD_PARTY_NOTICES.md` §1b):

| Package | Version | Licence | Transitive | Why this one |
| --- | --- | --- | --- | --- |
| `saxes` | 6.0.0 (2021, stable) | ISC | `xmlchars` 2.2.0 (MIT) | Strict, well-tested XML parser (used by jsdom); no DTD/entity expansion; works unchanged in Node and browsers. Chosen over `fast-xml-parser` 5.12 (6 transitive packages, recent churn) and over the browser `DOMParser` (absent in Node, so results could differ between runtimes). |
| `@dagrejs/dagre` | 3.1.3 (2026-10-24; newest 3.1.4 was < 2 weeks old) | MIT | `@dagrejs/graphlib` 4.0.6 (MIT) | Layered graph layout with compound (group) support, the algorithm family Mermaid itself uses; deterministic; 48 KB minified. ELK (`elkjs`) rejected: EPL-2.0 and much larger. |

Not used: the official `mermaid` package (needs a DOM and several MB; its flowchart parser is not separately packaged), CogniFlow code (reference only, see `docs/research/IMPORTER_FIDELITY.md`).

`saxes@6.0.0` publishes no LICENSE file in its npm tarball; the ISC text is taken from the repository at the published `gitHead` and recorded with its hash in `scripts/license-sources/README.md`.
