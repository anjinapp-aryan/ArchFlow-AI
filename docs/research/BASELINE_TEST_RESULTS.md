# ArchFlow AI — Phase 0 Baseline Test Results

Run date: 2026-11-25. Machine: Windows 11 Pro 10.0.26300, Intel Core Ultra 7 265K (20 cores), 31.6 GB RAM. Tooling present: Git 2.53, Node 24.14.1, npm 11.11, Python 3.12.10, FFmpeg 9.0.1 (Gyan *full_build*, **GPL**), Docker 29.5 (daemon not running, not needed). Not present: Bun, pnpm, CMake, Qt, vcpkg, Rust → Bun 1.4.5 and pnpm 10.30.3 / 12.21.0 were installed with `npm i` into a scratch directory outside the repos, not globally.

Layout (all under `research/`): `upstream/` untouched clones · `logs/` raw output · `benchmark/` outputs · `scripts/` my test scripts · `binaries/` the one downloaded release.

**Honesty ledger.** "PASS" below means a command I ran returned success and I read the output. Items under *Not run / blocked* were not executed and must not be read as passing.

---

## 1. Environment findings (blockers and workarounds)

| # | Blocker | Affects | Workaround used | Upstream fixed? |
|---|---|---|---|---|
| B1 | `python3` on Windows resolves to the Microsoft Store stub ("Python was not found") — `skill-setup.log` exit 49 | animated-diagrams-skill `scripts/setup.sh` | shim `python3` → real Python on PATH (`scripts/python3.shim.sh`) | No |
| B2 | Python `Path.read_text()` with no encoding → `UnicodeDecodeError` (cp1252) in setup smoke test | same | `PYTHONUTF8=1` | No |
| B3 | `scripts/render.mjs` `spawnSync("…/.bin/hyperframes")` → exit `null` (extensionless bin on Windows) | same | call `hyperframes.cmd` directly | No |
| B4 | `hyperframes.cmd` breaks when the project path contains a space and is invoked with an absolute path from Git Bash | HyperFrames CLI | use relative paths | No |
| B5 | `inline_html.mjs` throws `ENOENT` if `renders/` doesn't exist | skill | `mkdir renders` | No |
| B6 | No CMake / Qt 6.8 / vcpkg / Rust / Emscripten | **AnimatedDiagrams source build and its GoogleTest suite** | Used the official v2.2.0 Windows release zip instead | n/a |
| B7 | `bun` not installed; CogniFlow and HyperFrames use it | CogniFlow tests, HyperFrames monorepo | Bun 1.4.5 via `npm i bun` in scratchpad | n/a |
| B8 | Docker daemon not running | HyperFrames `doctor` shows ✗ (only affects Docker render mode) | not needed | n/a |

## 2. Per-repository baseline

### 2.1 AnimatedDiagrams v2.2.0 (release binary)

| Step | Command (run from the extracted release dir `…/animated-diagrams-2.2.0-win64`) | Result |
|---|---|---|
| Download | `gh release download v2.2.0 -R codeRATny/AnimatedDiagrams -p animated-diagrams-2.2.0-win64.zip -p SHA256SUMS.txt` | PASS |
| Integrity | `sha256sum animated-diagrams-2.2.0-win64.zip` = `77f6734f…efd7` = value in `SHA256SUMS.txt` | PASS (same-origin checksum only; no signature checked) |
| Inspect | DLL list; `avcodec-63.dll` string: "libavcodec license: LGPL version 3 or later" | LGPL FFmpeg confirmed |
| Documented example | `./bin/animated-diagrams.exe --export <out>.gif samples/fallback-retry.json` (also `.mp4`, `.webm`, `.html`) | PASS: gif 181 frames 297,322 B · mp4 181 frames 334,431 B · webm 147,432 B · html 367,167 B. Headless, no display. |
| Benchmark | same CLI on `benchmark/animated-diagrams/bench.json` (8 nodes, 8 edges, 17 steps (13 messages + 4 states), 16 s) | PASS: mp4 **1,826 ms** (241 frames, 1148×418, 16.07 s, H.264 Constrained Baseline, 423,758 B); html **137 ms** (368,195 B); gif 308,888 B |
| Repeatability | rendered mp4 and gif 3× each, `sha256sum` | PASS: mp4 `43741af1292667bc…` ×3 identical; gif `1f873f324656aee2…` ×3 identical (same machine/binary) |
| Visual inspection | `bench-contact.png` (8 frames across 16 s) | Packets move on edges with labels; Consumer 2 turns red ("Down") while a red "timeout" packet runs to PostgreSQL, a "retry" packet follows, Consumer 2 turns green; "ack" packet returns; "201 Created" returns to User; User turns green |
| HTML player | `scripts/player-test.mjs` (puppeteer-core + chrome-headless-shell 131 from HyperFrames' cache): list controls, `postMessage({type:'ad-player',action:'seek',time})` at 0/5500/6500/9000/12000 ms, set range slider to 7000, screenshot each | PASS: controls = Previous, Play/pause, Next, Position slider, Loop; each seek renders the expected state (e.g., t=7000 shows Consumer 2 Down); **0 page errors**. Screenshots in `benchmark/animated-diagrams/player-*.png` |

Not run / blocked: upstream CMake/GoogleTest suite (B6); `--export deck.pptx`; `--mcp` server; draw.io and Mermaid import; Data-platform plugin (Kafka/PostgreSQL icons); Linux/macOS; Firefox/Safari for the HTML player.

### 2.2 PrashobhPaul/CogniFlow

| Step | Command | Result |
|---|---|---|
| Install | `npm install --no-audit --no-fund` (repo ships `bun.lock`, not an npm lockfile) | PASS, 444 packages, 57 s. Not lockfile-reproducible (resolved `@xyflow/react` 12.12.1). Created untracked `package-lock.json`. |
| Tests | `bun test tests/` | **PASS: 19 pass, 0 fail**, 59 expects, 429 ms |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | PASS (exit 0) |
| Build | `npm run build` (`vite build`) | PASS (exit 0; built in 935 ms; largest chunk `palette` 925 KB / 257 KB gz). Regenerated tracked file `src/routeTree.gen.ts`. |
| License scan | `npx license-checker-rseidelsohn --production --summary` | MIT 251 / ISC 27 / BSD-3 16 / Apache-2.0 9 / MPL-2.0 2 / … (see LICENSE_AUDIT §2.4) |
| Benchmark (headless API) | `bun run scripts/bench-cogni.ts` → `compile({text})` on the 10-line description; `exportGraph` to `air`/`mermaid`/`drawio`/`svg`/`svg_animated` | PASS, no errors. compile 4.5 ms; 7 nodes, 10 edges, validation issues `[]`; svg 8 ms (51,571 B); animated SVG 1.4 ms (63,196 B; 47 `animateMotion`, 8 `animateTransform`, 3 `animate`, no `<script>`) |
| Quality check | semantic types the compiler assigned | **Wrong for several edges**: "validate token"→`stream`, "authorized"→`control`, "consume"→`request`, "ack"→`request`, "201 Created"→`request`, "result"→`response`(ok). |
| Visual check | puppeteer, `svg.pauseAnimations()` + `setCurrentTime` at 0.5/1.5/3/4.5 s at a 1400×700 viewport → `benchmark/cogniflow/svg-contact.png` | Nodes laid out as a single cramped row; labels overlap; SMIL is seekable via DOM, but no player UI ships with the SVG. (Viewport clipped the SVG; I did not measure its natural size.) |

Not run / blocked: GIF/MP4/WebM/PPTX export (browser-only: WebCodecs, canvas); draw.io import (needs `DOMParser`); in-browser SmolLM2/SmolVLM (≈630 MB downloads); MCP server; the studio UI.

### 2.3 omkamal/animated-diagrams-skill (+ HyperFrames 0.6.91 via npm)

| Step | Command | Result |
|---|---|---|
| Install | `npm ci --no-audit --no-fund` | PASS, 171 packages, 15 s |
| Setup script | `bash scripts/setup.sh` | **FAIL** B1 (exit 49), then B2, then B3 (exit 1). `hyperframes doctor` otherwise ✓ (Node, FFmpeg, FFprobe, Chrome headless shell cached at `~/.cache/hyperframes/chrome/…`); reports "0.6.91 → 0.9.94 available". Side-effect: the four vendored GSAP files show as modified (line-ending only: `git diff --ignore-cr-at-eol` empty). |
| Smoke render (workaround) | `node_modules/.bin/hyperframes.cmd render .smoke/warmup -o …/smoke.mp4` | PASS: 2.4 s composition, 45.8 KB, 4.6 s |
| Documented example | `hyperframes.cmd render examples/architecture-demo -o benchmark/skill-example/arch-demo.mp4` | PASS: 1.5 MB, h264, 1920×1080, 30 fps, 14.0 s, **12.9 s** render. Visual check (`arch-demo-contact.png`): staged node entrances, edge draw-on, yellow pulse, camera zoom — high quality |
| Lint | `hyperframes.cmd lint ../../benchmark/hyperframes-gsap` | PASS, 0 errors, 3 warnings (overlapping GSAP tweens in *my* generated timeline) |
| Benchmark | `node scripts/gen-hf.mjs bench.json index.html` (my generator, same coordinates ×1.6) then `hyperframes.cmd render` | PASS: 1920×1080, 16.0 s, 498.6 KB, **14.9 s** wall (14.2 s reported by the pipeline) |
| Repeatability | render twice; `ffmpeg -f framemd5` and `sha256sum` | PASS: frame-MD5 stream `e33a7198…` identical; file SHA-256 `b1bc2ab1…` identical |
| Visual check | `benchmark/hyperframes-gsap/contact.png` (frames 150/195/230/260) | Packets, parallel consumers, red failure + yellow retry visible; my generator draws no arrowheads and puts packet labels on top of node text (my template, not an upstream defect) |
| Interactive HTML | `node scripts/inline_html.mjs --project …` (after `mkdir renders`, B5) | PASS: 104 KB single file. `scripts/hf-player-test.mjs`: controls = pause button + range input; slider to 45 % → timeline time 7.2 s and paused; 0 page errors. Autoplay not observed (`window.__timelines.main.time()` stayed 0 over 1 s) — my generated page only autoplays when `navigator.webdriver` is false and headless Chrome sets it true; the skill's template uses the same guard, so this is an artefact of headless testing, not a verified defect. |

Not run: `render.mjs` itself (B3), `--gif`/`--webm`/`--svg` options, camera rig, voice-over/SRT, RTL, Iconify fetch.

### 2.4 heygen-com/hyperframes (real project) — and the URL from the brief

| Step | Command | Result |
|---|---|---|
| `hyperframes/hyperframes` | `git clone`; `git log`; `gh api repos/hyperframes/hyperframes` | 2 commits, only `README.md`, license null → **REJECT** |
| Real repo clone | `git clone --depth 50 https://github.com/heygen-com/hyperframes hyperframes-heygen` | OK; HEAD 2026-11-25 |
| Install | `bun install --frozen-lockfile` | PASS, 724 packages, 137 s; "Blocked 1 postinstall" (Bun's default untrusted-script block) |
| Unit tests, attempt 1 | `cd packages/core && bun run test` (nothing pre-built) | **FAIL**: 2652 pass, 19 fail; 190/347 files failed to load — "Cannot find package '@hyperframes/parsers/…'" (unbuilt workspace dependency) |
| Unit tests, attempt 2 | `bun run --filter @hyperframes/parsers build` then `bun run test` in `packages/core` | **Still failing**: 6933 pass, **7 fail**, 52 skipped; 23/347 files failed. Remaining causes seen: `@hyperframes/lint` / `@hyperframes/studio-server` not built, missing generated `runtime-inline`, 2 tests exceeding 5 s timeouts. I did not build the rest of the monorepo, so I cannot say the suite is green on Windows. |

Not run: producer/engine/player/cli suites, regression renders (`test:regression`), Docker mode, `hyperframes preview` studio.

### 2.5 xyflow/xyflow

| Step | Command | Result |
|---|---|---|
| Install | `pnpm@12.21.0 install --frozen-lockfile` (CI=1) | PASS (~2 min; Cypress postinstall) |
| Tests | `cd packages/system && pnpm test` | **PASS: 2 files, 13 tests**, 442 ms |

Not run: `@xyflow/react|svelte|vue` Playwright/Cypress e2e; build; lint.

### 2.6 mermaid-js/mermaid

| Step | Command | Result |
|---|---|---|
| Install | `pnpm@10.30.3 install --frozen-lockfile` (CI=1) | PASS (~2 min). Side effects: `packages/mermaid/src/config.type.ts`, `packages/tiny/package.json` regenerated (tracked files modified by `prepare`). |
| Tests (subset) | `pnpm exec vitest run packages/mermaid/src/diagrams/flowchart packages/mermaid/src/diagrams/sequence` | **PASS: 31 files, 1299 passed, 3 skipped**, 8.9 s |

Not run: full `pnpm test` (includes lint), e2e/Playwright/Cypress, rendering benchmark.

### 2.7 drawcms/drawcms

| Step | Command | Result |
|---|---|---|
| Install | `npm ci --no-audit --no-fund` | PASS, 772 packages, 69 s |
| Tests | `npx vitest run` | **PASS: 56 files, 555 tests**, 14 s |

Not run: `next build`, lint, any animation/GIF export, WebMCP.

## 3. Benchmark scoreboard (User → API Gateway → Authentication Service → Order Service → Kafka → Consumer(s) → PostgreSQL)

Scenario content (17 steps (13 messages + 4 states), 16 s): POST /orders; gateway↔auth validate/ok; gateway→order create; order→Kafka `OrderCreated`; Kafka→Consumer 1 and Consumer 2 **in parallel**; Consumer 2 goes *Down*; Consumer 1 INSERT to PostgreSQL; Consumer 2 INSERT **times out (error packet)**; **retry** succeeds; Consumer 2 turns *Success*; DB `ack`; Order→Gateway `201`; Gateway→User `201 Created`; User *Success*.

| Requirement | AnimatedDiagrams | HyperFrames+GSAP (hand-generated) | CogniFlow (headless) |
|---|---|---|---|
| Request packets on arrows | PASS | PASS | PASS (loop) |
| Component highlighting | PASS | PASS | PASS (badges) |
| Kafka producer & consumer flows | PASS (event packets; generic node kind) | PASS | PASS (not inspected in studio) |
| Parallel processing | PASS | PASS | loop-concurrent only |
| Database write | PASS | PASS | PASS (data edge) |
| Response propagation | PASS | PASS | PASS (types partly wrong) |
| Failure + retry | PASS | PASS | not expressible as a timeline in exported SVG |
| Play/pause + seek | PASS (verified) | PASS (verified; no speed control) | seek via DOM only; no UI |
| MP4 | PASS 1.8 s | PASS 14.9 s | not run |
| Interactive HTML | PASS | PASS | animated SVG only |
| Repeatability | 3/3 identical | 2/2 identical | not measured |

## 4. Upstream hygiene

Source files were not edited. Side-effects, for the record: CogniFlow — regenerated `src/routeTree.gen.ts`, new untracked `package-lock.json`; mermaid — `config.type.ts` and `packages/tiny/package.json` regenerated by `prepare`; animated-diagrams-skill — vendored GSAP files rewritten by setup (line-endings only), `.smoke/` removed afterwards. `node_modules/` and build outputs are git-ignored in each repo.

## 5. Reproducing

Scripts: `research/scripts/{bench-cogni.ts,gen-hf.mjs,player-test.mjs,hf-player-test.mjs,svg-shot.mjs,python3.shim.sh}`. They contain absolute paths to this machine and to the scratchpad; edit before reuse. Raw logs: `research/logs/`.
