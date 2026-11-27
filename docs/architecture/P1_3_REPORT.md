# P1.3 Report — Importer fidelity corpus

Date: 2026-11-26. Scope: P1.3 only (corpus + fidelity measurement). No importer written, nothing deployed or pushed, no P1.4+ work. Evidence and analysis: `docs/research/IMPORTER_FIDELITY.md`.

## Result

**GO for P1.3 as a measurement step; NO-GO to rely on any existing importer as-is.** The corpus, the scorer and a recorded baseline exist and are tested. They show that no importer we can run in the browser is good enough yet (details below).

## Files

New

- `packages/importer-eval/` (workspace `@archflow/importer-eval`): `src/corpus.ts` (12 ground-truth diagrams plus draw.io and Mermaid renderers), `src/score.ts` (importer-neutral scorer), `src/native.ts` (native AnimatedDiagrams runner and adapter), `src/cogniflow.ts` (esbuild bundle and Chrome runner for the CogniFlow importers), `src/run.ts`; tests `corpus.test.ts`, `score.test.ts`, `importers.browser.test.ts`
- `fixtures/diagrams/` (34 generated files: 11 `.drawio`, 11 `.mmd`, 12 `.truth.json`) and `results.json` (recorded baseline)
- `scripts/make-corpus.mjs`, `scripts/importers-report.mjs`
- `docs/research/IMPORTER_FIDELITY.md`, `docs/architecture/P1_3_REPORT.md`

Modified: `package.json` (scripts `corpus:generate`, `importers:report`), `.prettierignore` (generated fixtures), `package-lock.json` (new workspace link only). Nothing in P1.0 to P1.2 code, goldens, engine or licences changed.

## Headline numbers (22 files per importer; checks matched / expected)

| Importer              | draw.io passing  | Mermaid passing  | Notable failures                                                                                   |
| --------------------- | ---------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| Native v2.2.0 (oracle)| 10 / 11          | 10 / 11          | groups, nesting, membership all 0 (draw.io drops them silently; Mermaid warns)                      |
| CogniFlow TS (browser)| 0 / 11           | 5 / 11           | size 0/48, dashed 0/5, routing 0/3, groups 0, relative-coordinate bug, invents arrow direction, drops duplicate connectors, rejects compressed draw.io, no sequence support |

## Commands and results

| Command                                       | Result                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `node scripts/make-corpus.mjs`                | 34 files written; unit test fails on any drift                                                    |
| `npm run importers:report`                    | Native 22 files in about 2 s; CogniFlow bundle + 22 files in Chrome 158; baseline written        |
| `npm run typecheck`, `npm run lint`           | PASS                                                                                             |
| `npm run test:unit`                           | PASS (corpus 7 tests, scorer and baseline 40 tests, plus all P1.1/P1.2 tests)                     |
| `npm run test:browser`                        | PASS (12 golden tests unchanged, 2 importer baseline tests)                                      |
| `npm run ci`                                  | PASS: 207 tests (193 unit, 14 browser), licence gate unchanged                                    |

## Unresolved decisions (need your call)

1. **Importer route** (the real P1.3 outcome). Options: (a) fix CogniFlow's code until it passes the corpus, (b) write our own TypeScript importers that emit the canonical model directly, using the native importer as oracle and this corpus as the acceptance test, reusing CogniFlow ideas where sound. I recommend (b), draw.io first. It needs its own approval; I did not start it.
2. **Groups** are unsupported everywhere (importers, engine document v3, adapter). Choose later: flatten to a background rectangle, or extend the engine. Until then importers must report groups as unsupported explicitly.
3. **Plain lines** (no arrowheads) are imported as `direction: none`. The canonical validator then allows packets either way; decide whether the product should ask the user instead.
4. Whether to keep the native importer as a permanent dev oracle (needs the Phase 0 binary, Windows only here) or freeze its outputs as extra goldens.

## Risks

- The corpus is synthetic (authored by us); real-world files will break assumptions. Add real exports (with permission/licence) before declaring any importer supported.
- Mermaid layout quality, large-diagram performance, malformed/hostile input and multi-page draw.io are not measured.
- Importer tests skip when `research/` is absent (CI); there the committed baseline is the only importer evidence, and it is not re-verified.
- Native results are Windows only.

## Recommendation

GO for P1.3. Stopping here; the next step is your decision on item 1.
