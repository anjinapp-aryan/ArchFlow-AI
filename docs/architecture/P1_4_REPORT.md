# P1.4 Report — draw.io and Mermaid importers

Date: 2026-11-26. Scope: importers only. Nothing deployed or pushed; no scenario synthesizer, UI or export work.

**Numbering note.** The master prompt's P1.4 ("scenario schema and validator") was delivered inside P1.2. After P1.3 showed that no existing importer was usable, the owner delegated the choice ("do what is best long-term"), so P1.4 became the importer implementation. The master prompt's P1.5 (synthesizer and order-flow benchmark from text and from Mermaid) is next and is now unblocked.

## Result

**GO.** ArchFlow's own importers pass **every applicable fidelity check on all 25 corpus files** (12 draw.io, 13 Mermaid), including 3 hand-written real-world-style files. They behave byte-identically in Node and Chrome, and every imported corpus diagram loads and draws in the pinned WASM engine. `npm run ci` passes: 369 tests, licence gate green.

## Decisions taken (long-term view)

1. **Own TypeScript importers emitting the canonical model** (`@archflow/diagram-importers`). CogniFlow is a reference only; the native AnimatedDiagrams importer stays a frozen dev oracle.
2. **Reuse proven libraries for the hard generic parts**: `saxes` 6.0.0 (ISC) for XML and `@dagrejs/dagre` 3.1.3 (MIT) for layout. Mermaid syntax is parsed by our own focused parser, because the official parser needs the whole Mermaid runtime and a DOM.
3. **Groups are preserved, never lost at import.** Canonical minor 1 adds an optional `group.frame` (additive; minor-0 documents unchanged). The renderer adapter gains an explicit `groups: "flatten"` option that reports `info.groups_flattened`; the default still rejects groups.
4. **No arrow inference.** Plain lines import as `direction: "none"` and arrows only at the source as `backward`.
5. **Sequence diagrams import as diagram plus scenario**: timed packets, reply pairing via `respondsTo`, `-x` as error, async as event, `par` branches in parallel, activations as `active` states, `box` as a group.
6. **Everything dropped is reported** with a stable warning code (32 warning codes, 23 error codes, plus pass-through `validation.*`; see `IMPORTERS.md` §5).

## Files

New

- `packages/diagram-importers/`: `src/common.ts` (issues, id mapping, labels, validation), `xml.ts` (saxes tree with limits), `drawio.ts`, `layout.ts` (dagre), `mermaid-text.ts`, `mermaid-flowchart.ts`, `mermaid-sequence.ts`, `mermaid.ts`, `index.ts`; tests `drawio.test.ts` (50), `mermaid.test.ts` (70), `robustness.test.ts` (6), `browser.browser.test.ts` (4)
- `packages/importer-eval/src/archflow.ts`, `test/acceptance.test.ts`
- `fixtures/diagrams/13-drawio-realworld.*`, `14-mermaid-syntax.*`, `15-sequence-rich.*` (hand-written sources and truths)
- `scripts/license-sources/` (saxes licence text and provenance); `licenses/{zod-MIT,saxes-ISC,xmlchars-MIT,dagre-MIT,graphlib-MIT}.txt`
- `docs/architecture/IMPORTERS.md`, `docs/architecture/P1_4_REPORT.md`

Modified

- `packages/canonical-model`: `group.frame` (`FrameSchema`), `CANONICAL_SCHEMA_MINOR` 0 -> 1, warning `geometry.node_outside_group` (+ tests; the minor constant test was updated to 1 because the minor was deliberately bumped)
- `packages/renderer-adapter/src/adapt.ts`: `AdaptOptions.groups` (+ 2 tests)
- `packages/importer-eval`: corpus `raw` sources, third importer in harness and baseline, groups scored for every format, sequence connectors as participant pairs; `fixtures/diagrams/results.json` re-recorded
- `scripts/collect-licenses.mjs` (npm bundle licences), `THIRD_PARTY_NOTICES.md` §1b, `DEPENDENCY_DECISIONS.md` §8, `CANONICAL_MODEL.md` (minor 1), `docs/research/IMPORTER_FIDELITY.md`, `README.md`, `package.json`/`package-lock.json` (new workspace and pins)

Unchanged: engine build and hashes, golden files, P1.2 validation rules other than the one added warning.

## Evidence

| Check                                                                   | Result                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Acceptance: all corpus files, all applicable checks (unit test, runs in CI) | 25 / 25                                                                                    |
| Fidelity vs native oracle / CogniFlow                                   | ArchFlow 12/12 + 13/13; native 10/12 + 10/13; CogniFlow 0/12 + 5/13 (`IMPORTER_FIDELITY.md`) |
| Node vs Chrome 158 output                                               | byte-identical for every corpus file                                                           |
| Import -> validate -> adapt (`flatten`) -> WASM engine                  | all 25 load and draw every component label; sequence packets visible at imported times       |
| Fuzz: 1,200 seeded mutations                                            | never throws, never returns an invalid document                                                |
| Hostile XML (DOCTYPE/entities, external DTD, depth, element count, 20 MB decompression bomb) | rejected with stable codes                                       |
| Scale                                                                   | 400-node / 1,000-link Mermaid and 500-shape draw.io import; 501 shapes rejected               |
| Browser bundle (importers + validator)                                  | 147,732 B minified, 49,117 B gzip; no `eval`/`new Function`                                    |
| `npm run typecheck`, `npm run lint`, `npm run licenses:check`           | pass (283 packages, 5 reviewed exceptions, unchanged)                                          |
| `npm run ci`                                                            | pass, 369 tests (unit: canonical-model 133, diagram-importers 126, importer-eval 75, renderer-adapter 15; browser: qa 12, diagram-importers 4, importer-eval 3) |

## Risks and honest limits

- **Self-graded corpus.** The corpus, ground truths and importers were written by the same agent. 100 % proves consistency with the specified behaviour, not robustness on real files. **Real exported files are the most important missing evidence**; add consented examples before telling users a format is supported.
- Mermaid membership rule (a node joins the first subgraph that lists it) and some syntax corners (`A--text-->B` without spaces, new v11 shape names beyond the common ones) are implemented from the documentation, not checked against Mermaid's own parser.
- Layout is deterministic and overlap-free on the corpus, but its readability is unmeasured. Mermaid's own renderer will look different.
- The engine still cannot draw groups; flattening is visible but loses the container frames in the animation.
- `saxes` is stable but has had no release since 2021 (low churn, but also low maintenance). It sits behind `xml.ts`, so it can be replaced by another strict parser without touching the importers.
- The native and CogniFlow measurements still need `research/` locally; CI relies on the committed baseline for those two.

## Open decisions for you

1. **Real-world corpus.** Can you provide 5–10 real draw.io/Mermaid files (anonymised if needed) to add to the corpus? This is the main gap.
2. **Rendering groups.** Keep "flatten with warning", or plan an engine-side container drawing later (fork patch, per the fork policy)?
3. **Plain-line edges** (`direction: none`): keep packets allowed both ways, or ask the user in the UI when a scenario uses them?
4. **Next phase**: proceed to the master prompt's P1.5 (deterministic scenario synthesizer + order-flow benchmark from text and from Mermaid)?

Stopping here for approval.
