# ArchFlow AI — Proposed Architecture (Phase 0 output, pending approval)

> **Update 2026-11-25 (P1.0 / P1.1):** the deployed product no longer runs the native Qt/FFmpeg binary; the renderer is the engine core compiled to WebAssembly. See `RENDERER_STRATEGY.md`, `DEPENDENCY_DECISIONS.md` §6–7 and the repository `README.md`. Sections below that mention the native CLI, Qt or FFmpeg describe the Phase 0 plan and are kept as history.

Status: **proposal only. No application code exists.** Based on `docs/research/*`. Every "verified" statement refers to evidence in `BASELINE_TEST_RESULTS.md`; every "assumption" is something Phase 1 must prove or kill.

## 1. Guiding decision

Use **AnimatedDiagrams (MIT, v2.2.0)** as the animation/rendering engine, treated as a **pinned external executable with a JSON contract**, and write only the layers it does not have: input ingestion for formats it lacks, AI scenario synthesis with schema validation, an orchestrator, and QA. The document JSON is the boundary, so the engine can be replaced (fork, rebuild, or swap for a TS engine + HyperFrames) without touching the rest.

Why this shape:
- It follows REUSE > ADAPT > REFERENCE > BUILD: the engine, player, exporters and draw.io/Mermaid importers already exist and were measured.
- Principle 6 is satisfied structurally: the AI never emits code, only a scenario document that is validated against a schema and then interpreted by a fixed engine.
- Principle 7: every frame is a pure function of (document, time); three identical renders were byte-identical on one machine.
- Principle 8: draw.io/Mermaid coordinates become node positions; raster inputs need an overlay mode that is **unproven** (§6, risk R3).

## 2. System overview

```
 Inputs                      Ingest adapters                 Canonical doc          Scenario            Render             Outputs
 ─────────────               ───────────────                 ─────────────          ────────            ──────             ───────
 draw.io  ───────────────►  (delegated to engine importer) ─┐
 Mermaid  ───────────────►  (delegated: merman in engine)  ─┤
 SVG      ──► svg2doc  (NEW, small) ────────────────────────┤
 PNG/JPG  ──► vision2doc (NEW, spike; VLM + OCR → boxes) ───┼─►  Diagram JSON v3  ──►  Scenario    ──►  engine CLI   ──►  GIF / WebM / MP4
 PlantUML ──► puml2doc (NEW, spike; subset) ────────────────┤     (+ ArchFlow       Synthesizer        `--export`        interactive HTML
 Text     ──► text2doc (ADAPT CogniFlow rules + LLM) ───────┘      envelope)        (LLM→JSON,         (pinned           PPTX (optional)
                                                                                    schema-checked)    binary)           PNG frames (golden tests)
                                                                                         │                                  │
                                                                                         ▼                                  ▼
                                                                                 Validator (schema +                 QA harness (ffprobe, frame
                                                                                 semantic rules)                     hashes, contact sheet)
```

### 2.1 Components

| # | Component | Source | Size of original code |
|---|---|---|---|
| C1 | **Engine wrapper** — resolves the pinned AnimatedDiagrams binary (path + SHA-256 check), runs `--export`, captures stderr/exit, enforces timeouts | thin Node/TS around the CLI | S |
| C2 | **Canonical document** = AnimatedDiagrams JSON v3 plus an ArchFlow envelope (`archflow: {sourceFormat, sourceHash, generator, promptHash}`) — kept in a sidecar file to avoid forking the engine's schema | adopt upstream schema | S (JSON Schema derived from `docs/file-format.md` + `src/` validation) |
| C3 | **draw.io / Mermaid ingestion** | engine importers (`--export x.mp4 in.drawio|in.mmd`) | none (test only) |
| C4 | **text2doc** — description → nodes/edges | ADAPT CogniFlow `compiler.ts`/`air.ts` (MIT) for deterministic first pass; optional LLM for ambiguity; output via a validated `candidate` pattern | M |
| C5 | **svg2doc** — SVG shapes/paths/text → nodes and edge polylines | new; SVG parsing via a vetted XML/SVG library (to be chosen in Phase 1) | M |
| C6 | **vision2doc** — PNG/JPG → boxes/labels/arrows | new; local VLM/OCR (open weights, runs on user machine). **Feasibility spike before commitment** | L, uncertain |
| C7 | **puml2doc** — PlantUML subset (component/sequence) → doc | new; parser choice open (no audited candidate) | M, uncertain |
| C8 | **Scenario Synthesizer** — doc + user intent → `scenario.steps` | new: prompt + JSON-schema-constrained generation; deterministic templates for common patterns (request/response, pub/sub, retry+fallback) reuse the engine's own templates concept | M |
| C9 | **Validator** — JSON Schema + semantic rules: ids exist, edges exist for `message` steps, no negative/zero durations, bounded step count/duration, no unknown step types, step overlap limits, string length caps (XSS/path safety for labels) | new (schema lib: Ajv or Zod, both MIT) | S–M |
| C10 | **QA harness** — `ffprobe` duration check, PNG-sequence frame hashing for determinism (encoder-independent), contact sheet for human/agent inspection | idea REFERENCE from skill (contact sheet, probe); new code | S |
| C11 | **CLI / MCP façade** — `archflow animate <input> [--prompt …] --out dir`; MCP tools reuse engine's own MCP server where possible | new, thin | S |
| C12 | **Optional later: web viewer/editor** | xyflow (REUSE) + engine's WASM player | Deferred (Phase 2+) |

Minimum original code for Phase 1 = C1, C2 schema, C4 (adapted), C8, C9, C10, C11. C5–C7 are scoped by spikes; C6 may be cut.

### 2.2 Trust boundary and AI safety

- LLM/VLM output is parsed as JSON, validated against a closed schema (enumerated step types, variants, packet shapes; numeric ranges; max counts), then rejected or repaired by deterministic code. **Nothing the model returns is evaluated, templated into code, or used as a path/command.** (CogniFlow's `candidate.ts` demonstrates this pattern in MIT code we can adapt.)
- Labels are plain text and are escaped by the engine's renderers; the HTML export embeds the document as `application/json` data and engine-compiled WASM — no per-diagram generated script (checked: the exported HTML has two JSON data blocks plus two plain `<script>` tags; with the JSON blocks removed, the benchmark and sample exports differ by only 24 bytes of ~365 KB, consistent with a title string, so the executable part is the same static player/engine for every diagram. I did not diff line by line.)
- The external engine runs as a subprocess with no network need (it exported with no network in my run; I did not sandbox-test network access).
- AI providers: pluggable OpenAI-compatible HTTP endpoint (local Ollama/llama.cpp, or user-supplied hosted key). **No mandatory paid service.** The default must work with a local model or with no model at all (rule-based text2doc + templates).

### 2.3 Determinism and testing strategy

| Layer | Test |
|---|---|
| Document validation | JSON Schema unit tests + golden invalid documents |
| Engine contract | Pinned binary SHA-256; for a corpus of documents, export **PNG sequence** and compare per-frame hashes against goldens (encoder-independent). MP4/GIF byte equality asserted only on the same machine/binary, since H.264 encoder selection is a runtime fallback (`libx264 → libopenh264 → h264_mf → mpeg4`). |
| Importers | corpus of draw.io and Mermaid files → expected node/edge counts and positions within tolerance |
| AI synthesis | fixed-seed/temperature-0 prompts where the provider supports it; **schema-valid rate** and semantic-rule pass rate on a prompt set; never asserts exact text |
| Visual regression | contact-sheet generation + image diff on selected timestamps |
| Licensing | CI job runs a license scanner over any added dependency; fails on class C/D/E |

### 2.4 Distribution plan (Phase 1)

Do **not** vendor or redistribute the engine's Qt/FFmpeg DLLs yet. A `fetch-engine` script downloads the pinned release asset and verifies SHA-256 (value recorded in-repo). This avoids taking on the LGPL notice/relinking obligations — and the upstream notice gap — until we decide to ship binaries. When we do ship: add Qt/FFmpeg/pugixml/zlib/libzip/nanosvg notices, LGPL texts and source-offer, or build `ad_core` + a minimal CLI from source (the core is Qt-free; this is the likely Phase 2+ answer).

### 2.5 Output policy

Default video: **WebM (VP9/AV1)** + **animated HTML**; MP4 and GIF offered (MP4 best-effort because of H.264 encoder/patent ambiguity), PPTX optional. Interactive HTML is the primary deliverable (seek/pause verified).

## 3. What is deliberately not in the architecture

- **GSAP** anywhere (class C, competing-product clause).
- LLM-authored JavaScript/GSAP timelines (the skill's approach).
- drawcms code (AGPL).
- HyperFrames in the default path. It remains the designated **fallback renderer** (Apache-2.0, Chrome+FFmpeg) if the AnimatedDiagrams engine proves unmaintainable; the document boundary makes that swap a rewrite of C1 plus a scene→frame adapter, not a redesign.
- xyflow/mermaid-js as runtime dependencies (not needed in Phase 1).
- Any hosted/paid API as a hard requirement.

## 4. Risks and open assumptions

| ID | Risk / assumption | Evidence so far | Mitigation / gate |
|---|---|---|---|
| R1 | **Upstream bus factor**: 5 stars, one maintainer-looking account, 29 commits, `main` quiet since 2026-10-12 | repo stats | Pin release + SHA; keep schema boundary; budget for a fork (MIT); open upstream issues early; Phase 1 gate "fork builds on CI" |
| R2 | Engine is shipped as a 93 MB Qt app; no slim CLI | zip contents | Spike: build `ad_core` + export-only CLI; otherwise accept the app binary |
| R3 | Raster (PNG/JPG) inputs cannot preserve original layout unless the engine can draw over a background image | engine has no documented image-background feature that I verified | Spike D; if absent: patch engine (fork) or render overlays as transparent WebM/HTML layered over the original image |
| R4 | SVG and PlantUML import don't exist | README/format list | Build small adapters; PlantUML parser choice requires its own license audit |
| R5 | draw.io fidelity unknown | importer reads `mxGeometry`, **not run** | Corpus test in P1.3 |
| R6 | Cross-machine determinism of MP4/GIF | same-machine only | Golden tests on PNG frames |
| R7 | Windows/other-OS reproducibility of building engine | no toolchain here (B6) | Run its CI recipe in CI; first Linux, then Windows |
| R8 | LLM scenario quality (timing, causality, retry semantics) | not evaluated | Phase 1 eval set; deterministic templates as floor |
| R9 | Licensing: Qt/FFmpeg notices, H.264 | upstream notices incomplete | Resolve before any binary redistribution; WebM default |
| R10 | Docs partly Russian; format spec partly Russian | `docs/file-format.md` | Translate/maintain our own schema doc |

## 5. Phase 1 implementation plan (to be started only after approval)

Goal of Phase 1: an end-to-end **walking skeleton** — a draw.io or Mermaid file or a text description in; validated scenario JSON; WebM + interactive HTML (+ MP4/GIF) out — with automated tests, and go/no-go answers for the three uncertain adapters.

| Step | Work | Acceptance criteria |
|---|---|---|
| P1.0 | Approval gate. Record decisions in `DEPENDENCY_DECISIONS.md`; confirm GSAP exclusion and codec policy | Written sign-off |
| P1.1 | Repo skeleton (TS, Node ≥22), `fetch-engine` with SHA-256 pin, license-scan CI, schema package | Fresh clone → `npm ci` → engine fetched/verified on Windows and Linux CI |
| P1.2 | **Engine wrapper + golden tests**: render the 3 shipped samples and the benchmark JSON; PNG-sequence hashes | Re-render equality on CI; wrapper handles non-zero exit/timeouts |
| P1.3 | **Importer fidelity**: corpus of ≥10 draw.io and ≥10 Mermaid files (flowchart + sequence) | Node/edge counts match; positions within tolerance; failures listed |
| P1.4 | **Validator + Scenario Synthesizer** (templates first, then LLM) | 100% of accepted documents pass schema; ≥X% of a 30-prompt eval produce valid, semantically sensible scenarios (X fixed at P1.0); adversarial prompts cannot produce code/paths |
| P1.5 | **Benchmark acceptance**: the Order-flow scenario generated from text and from Mermaid, with parallel consumers, failure+retry, response path | MP4/WebM + HTML produced; seek verified headlessly; contact sheet reviewed |
| P1.6 | **Spike A — SVG import** | Go/no-go + prototype on 5 real SVGs |
| P1.7 | **Spike B — raster input**: VLM/OCR → boxes; overlay-on-original proof | Go/no-go with measured box/edge recall on 10 diagrams; decision on engine patch vs layered overlay |
| P1.8 | **Spike C — PlantUML**: pick parser (license audit first) | Go/no-go; license class recorded |
| P1.9 | CLI/MCP façade and docs | `archflow animate` documented; MCP tool list reviewed |

Exit criteria for Phase 1: P1.1–P1.5 complete and green on CI; spikes P1.6–P1.8 have written go/no-go decisions; license scan clean (no C/D/E); upstream issues filed for the Windows/notice gaps we found.

Not in Phase 1: web editor, hosted service, PPTX polish, voice-over, plugin ecosystem.

## 6. Fallback decision

If at the P1.2/P1.3 gate the engine proves unfit (fidelity failures we can't patch, maintainer vanishes and fork cost is high), switch the renderer to **HyperFrames (Apache-2.0, ≥0.9.x) + our own deterministic frame adapter** driven by the same document schema (no GSAP), accepting heavier runtime (Chrome+FFmpeg) and building the timeline interpreter ourselves. CogniFlow's SMIL/frame-painter code is the available MIT reference for that path.
