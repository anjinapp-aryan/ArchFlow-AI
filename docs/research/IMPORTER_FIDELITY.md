# Importer fidelity (P1.3 measurement, updated in P1.4)

Date: 2026-11-26. Question: **how faithfully does each importer turn draw.io and Mermaid files into diagram structure that ArchFlow can animate?** "A parser accepted the file" is not evidence of support; every number below is a comparison against a ground truth.

P1.3 measured two existing importers and found neither usable. P1.4 built ArchFlow's own importers (`docs/architecture/IMPORTERS.md`) and measures them with the same corpus and scorer, plus three hand-written files added to test real-world patterns the generated files lacked.

## Update (final Phase 1)

PlantUML was added: 13 PlantUML files (11 generated, 2 hand-written). ArchFlow's importers pass **38 / 38** files; the native importer and CogniFlow do not support PlantUML (0 / 13, rejected). Current numbers are always in `fixtures/diagrams/results.json`; see also `PLANTUML_IMPORT_SPIKE.md`.

## 1. Method

- **Corpus**: 15 diagrams: 12 draw.io files and 13 Mermaid files (11 flowcharts, 2 sequence diagrams), under `fixtures/diagrams/`, each with a ground truth (`*.truth.json`). Source: `packages/importer-eval/src/corpus.ts`; `npm run corpus:generate` writes the files and a unit test fails on drift.
  - 12 generated diagrams cover: linear; branching; parallel consumers; multiple connectors between one pair; bidirectional and request/response; nested groups (two levels); labeled connectors with special characters; dashed, curved and orthogonal connectors; missing/ambiguous arrows (plain line, arrow at source, dangling connector); the order-flow architecture; a compressed draw.io page; a sequence diagram.
  - 3 **hand-written** files (ground truth written from the formats' documented semantics): `13-drawio-realworld` (UserObject wrapper with HTML label, untitled selection group, free-text cell, second layer, cylinder shape, AWS-style container, edge-label child cell, waypoints, open arrowhead, a connector into a container, ids with spaces); `14-mermaid-syntax` (frontmatter, init directive, comments, `graph TD`, six node shapes, entity codes, text-form label, thick link, chain, `&` fan-out, `o--o`, invisible link, subgraph listed after use, link to a subgraph, classDef/class/style/click); `15-sequence-rich` (autonumber, title, actor, aliases, box, activations, failed `-x` and async `-)` messages, retry, reply pairing, note, `par/and`, `loop`).
- **Importers measured**
  1. **ArchFlow TS** (`@archflow/diagram-importers`): the shipped importers. Run in Node; a separate test proves byte-identical output in Chrome.
  2. **Native AnimatedDiagrams v2.2.0** `--convert` (Qt/C++, Windows binary from Phase 0): reference oracle only, not browser-capable.
  3. **CogniFlow TS** (`drawio.ts`, `mermaid.ts`, MIT, run unmodified in headless Chrome 158): the only pre-existing browser-capable candidate.
- **Scoring** (`packages/importer-eval/src/score.ts`): nodes matched by label; edges as a multiset on unordered endpoints plus label, then direction compared (a backward edge may be expressed as the reverse forward edge; a plain line must not become an arrow); node position and size (±1 px, draw.io only); dashed style; routing (draw.io); groups, nesting, membership; sequence messages (order, endpoints, label) and reply recognition. Extra nodes or invented edges fail a diagram. A field the importer does not provide is a failure, not a pass. Features a format cannot express are excluded from its truth.
- The scorer has its own tests (mutations that must fail, boundaries), so it cannot pass a bad importer by accident.

## 2. Results

Diagram pass = every applicable check complete, nothing extra.

| Importer               | draw.io (12)     | Mermaid (13)     |
| ---------------------- | ---------------- | ---------------- |
| **ArchFlow TS**        | **12 / 12**      | **13 / 13**      |
| Native v2.2.0 (oracle) | 10 / 12          | 10 / 13          |
| CogniFlow TS           | 0 / 12 (1 rejected) | 5 / 13        |

Per-check totals (matched / expected):

| Check                 | ArchFlow draw.io | ArchFlow Mermaid | Native draw.io | Native Mermaid | CogniFlow draw.io | CogniFlow Mermaid |
| --------------------- | ---------------- | ---------------- | -------------- | -------------- | ----------------- | ----------------- |
| nodes                 | 52/52            | 60/60            | 51/52          | 60/60          | 48/52             | 49/60             |
| node position (±1 px) | 52/52            | n/a              | 51/52          | n/a            | 42/52             | n/a               |
| node size (±1 px)     | 52/52            | n/a              | 51/52          | n/a            | 0/52              | n/a               |
| edges                 | 50/50            | 56/56            | 49/50          | 56/56          | 47/50             | 44/56             |
| edge direction        | 50/50            | 56/56            | 49/50          | 56/56          | 44/50             | 43/56             |
| dashed style          | 6/6              | 6/6              | 6/6            | 6/6            | 0/6               | 0/6               |
| routing               | 4/4              | n/a              | 4/4            | n/a            | 0/4               | n/a               |
| groups                | 3/3              | 5/5              | 0/3            | 0/5            | 0/3               | 0/5               |
| group nesting         | 1/1              | 1/1              | 0/1            | 0/1            | 0/1               | 0/1               |
| group membership      | 5/5              | 9/9              | 0/5            | 0/9            | 0/5               | 0/9               |
| sequence messages     | n/a              | 12/12            | n/a            | 4/12           | n/a               | 0/12              |
| sequence replies      | n/a              | 4/4              | n/a            | 4/4            | n/a               | 0/4               |

Full per-diagram detail is in `fixtures/diagrams/results.json` (the recorded baseline; the browser test re-runs all three importers when their sources are present and compares).

**Caveat on the ArchFlow numbers.** The same person (this agent) wrote the corpus, the hand-written ground truths and the importers. 100 % on this corpus shows the importers implement the behaviour the corpus specifies; it does not show they handle files from the wild. See §4.

## 3. Findings about the other importers

Native v2.2.0 (oracle):

- Drops **groups** everywhere: silently for draw.io, with a warning for Mermaid subgraphs.
- Reads only the **first line of an HTML label** in a `UserObject` (`<b>Web</b><br>Client` becomes `Web`).
- Turns a Mermaid **link to a subgraph** into a new node named after the subgraph.
- Applies `autonumber` to message labels (`1. POST /orders`). Defensible as rendering, but it changes the label text, so it is counted as a mismatch.
- Otherwise very faithful: exact geometry including nested relative coordinates, all arrow directions, dashed and routing, compressed pages, sequence messages as ordered steps with replies recognised.

CogniFlow TS (P1.3 findings, unchanged):

- Its output model has no node size, stroke style or routing (0/52, 0/6, 0/4).
- Container children keep parent-relative coordinates, and containers become ordinary components.
- It **invents direction**: a plain line becomes an arrow, and an arrow at the source becomes bidirectional.
- It silently drops a second Mermaid link between the same pair.
- It rejects compressed draw.io pages and does not support sequence diagrams.
- On the hand-written files it also keeps `#quot;` entity codes and `/Payments/` shape markers in labels, turns the `sequenceDiagram` and `autonumber` lines into components, and invents a `core` node.

## 4. Limits of this evidence

1. **No file in the corpus comes from the wild.** 12 files are generated; 3 are hand-written imitations of real exports. Real draw.io files (AWS/Azure/GCP stencils, tables, swimlane pools with lanes, multi-page documents with links, collapsed containers, rotated shapes, custom styles) and real Mermaid (theme blocks, long markdown labels, unusual spacing) will produce cases not covered here. Before calling a format "supported" to users, add consented real files to the corpus.
2. 25 files, 112 nodes and 106 connectors: enough to find structural gaps, not to estimate a failure rate.
3. Mermaid layout quality (crossings, readability) is checked only for absence of overlaps and frame containment, not for aesthetics.
4. The native importer ran on Windows only.
5. Nodes are matched by label; diagrams with duplicate labels would need id-based matching.

## 5. Reproduce

```
npm run corpus:generate        # rewrite fixtures/diagrams from corpus.ts (drift = unit-test failure)
npm run test:unit              # corpus integrity, scorer self-tests, ArchFlow acceptance (all files must pass)
npm run test:browser           # all importers vs the recorded baseline; Chrome/Node parity; engine end-to-end
npm run importers:report       # re-record fixtures/diagrams/results.json (review the diff)
```

Native and CogniFlow runs skip, with a reason, when `research/binaries` or `research/upstream/CogniFlow` is absent (CI). The ArchFlow acceptance test always runs.
