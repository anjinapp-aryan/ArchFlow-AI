# ArchFlow diagram importers (`@archflow/diagram-importers`)

Status: implemented in P1.4 (2026-11-26). Evidence: `docs/research/IMPORTER_FIDELITY.md`; acceptance test: `packages/importer-eval/test/acceptance.test.ts`.

## 1. Decisions (long-term)

| Question                    | Decision                                                                                                                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Importer route              | **Our own TypeScript importers that emit the canonical model directly.** CogniFlow is a reference, not a dependency; the native AnimatedDiagrams importer is the oracle.                                                                                                                                                                                                                     | The only browser-capable candidate (CogniFlow) failed the corpus and its output model cannot carry size, stroke, routing, groups or nesting. The native importer cannot run in the browser. Emitting the canonical model avoids a second lossy model. |
| Reuse                       | Parsers and layout are reused, not written: **saxes** (strict XML, ISC) and **dagre** (layered layout, MIT, the algorithm family Mermaid uses). Mermaid syntax is parsed by our own small parser.                                                                                                                                                                                               | REUSE > BUILD where a mature permissive library exists. The official Mermaid parser needs the full Mermaid runtime and a DOM (megabytes); a focused parser for the two supported diagram types is small (all of our code, validator included, is about 46 KB minified) and fully testable. |
| Groups                      | **Kept** in the canonical model, now with an optional `frame` rectangle (canonical minor 1). The renderer adapter still cannot draw them: it rejects groups by default and offers an explicit `groups: "flatten"` option that reports `info.groups_flattened`.                                                                                                                                | Groups are real architecture information (VPCs, subnets, bounded contexts). Losing them at import time would make them impossible to support later; losing them at render time is visible and reversible.                                 |
| Plain lines                 | A connector with **no arrowhead imports as `direction: "none"`**; an arrow only at the source is `backward`. Nothing is inferred.                                                                                                                                                                                                                                                             | Inventing a direction sends animated packets the wrong way. The validator allows packets either way on `none` edges; the product can ask the user later.                                                                                 |
| Native importer             | Stays a **dev oracle**, frozen in `fixtures/diagrams/results.json`. Not needed by CI or users.                                                                                                                                                                                                                                                                                                  | Windows + Qt binary; useful to compare behaviour, never shipped.                                                                                                                                                                        |
| Runtimes                    | Identical behaviour in Node and browsers: no DOM, no font measurement, no clocks, no randomness. draw.io decompression uses the standard `DecompressionStream("deflate-raw")`.                                                                                                                                                                                                                 | Deterministic outputs (proven byte-identical in Chrome and Node by a test) and server-free use on Cloudflare static hosting.                                                                                                           |

## 2. API

```ts
importDrawio(text, { page?, diagramId?, name? }): Promise<ImportResult>
importMermaid(text, { diagramId?, name? }): ImportResult
importDiagram(text, "drawio" | "mermaid", options): Promise<ImportResult>
detectFormat(text, fileName?): "drawio" | "mermaid" | undefined

type ImportResult =
  | { ok: true; document: CanonicalDocument; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[]; warnings: ImportIssue[] };
interface ImportIssue { code: string; message: string; source?: string } // source = cell id or "line N"
```

Every successful result has passed `validateCanonical`; validator warnings are passed through as `validation.*` warnings. A document that would fail validation is returned as `ok: false` (an importer bug, never a silent repair).

## 3. What is supported

### draw.io / diagrams.net (`.drawio`, `.xml`)

- Uncompressed and **compressed** pages (base64 + raw DEFLATE + URI encoding), `<mxfile>` with several pages (page 1 by default, `page` option, warning when more exist), bare `<mxGraphModel>`.
- Shapes on every layer; `UserObject`/`object` wrappers (id and label taken from the wrapper).
- **Absolute geometry**: children of containers are converted from parent-relative coordinates through any depth; width/height kept; shapes below 20 px enlarged with a warning.
- Containers (`swimlane`, `container=1`, titled `group`, or any shape with child shapes) become canonical **groups** with frames and nesting; untitled selection groups are flattened (warning).
- Connectors: source/target, `startArrow`/`endArrow` (default end arrow `classic` as in draw.io), arrowhead shape (`classic/block` -> triangle, `open`, `diamond*`, `oval/circle/dot`; others -> triangle with a warning), `dashed`, dotted (`dashPattern` starting with 1), routing (`curved=1`, orthogonal/elbow/entity-relation styles), waypoints (absolute), labels from `value` plus **edge-label child cells**.
- Labels: HTML labels are converted to plain text (tags removed, never interpreted; entities decoded once); plain labels verbatim; > 200 characters truncated with a warning.
- Shape kinds: cylinder/datastore -> `db`, rhombus -> `decision`, document, cloud, actor -> `user`, queue; everything else `service` (no guessing from label text).
- Ids rewritten deterministically to the canonical charset (FNV-1a suffix for long ids), unique per kind, reported once.

### Mermaid flowchart (`flowchart`, `graph`)

- Directions TB/TD/BT/LR/RL; frontmatter `title`; `%%` comments and `%%{init}%%` directives; `;` separators.
- Node shapes `[]`, `()`, `([])`, `[[]]`, `[()]` (-> `db`), `(())`, `((()))`, `{}` (-> `decision`), `{{}}`, `[//]`, `[/\]`, `>]`, and `id@{ shape: ..., label: ... }`.
- Labels: quoted, markdown strings, `#quot;`/`#35;` entity codes, HTML entities, `<br>`.
- Links: `-->`, `---`, `-.->`, `-.-`, `==>`, `<-->`, `<-.->`, `o--o`, `--o`, `x--x`, `--x`, longer links, `|label|` (quoted labels may contain `|`), `-- label -->`, `== label ==>`, `-. label .->`, chains, `&` fan-out, edge ids `e1@-->`.
- Subgraphs (`id [title]`, `id["title"]`, `"title"`, bare words), nesting; a node first used outside joins the first subgraph that lists it.
- Layout: dagre, rank separation 70, node separation 50; node width from a **deterministic** text-width table (no font measurement); group frames enclose members and child groups plus a title band.

### Mermaid sequence diagrams (`sequenceDiagram`)

Diagram **and** scenario:

| Mermaid                                      | Canonical                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `participant X as Label`, `actor` (-> `user`) | node in a row (left to right)                                                                                    |
| `box Title ... end`                           | group with frame                                                                                                 |
| each communicating pair                       | one connector; `both` if requests flow both ways                                                                 |
| `->>`, `->`                                   | packet `request`                                                                                                 |
| `-->>`, `-->` (dashed)                        | packet `response` with `respondsTo` the latest unanswered opposite request that has ended; otherwise `success` |
| `-x`, `--x`                                   | packet `error`                                                                                                   |
| `-)`, `--)`                                   | packet `event` (async)                                                                                           |
| `+` / `-`, `activate` / `deactivate`          | `node_state` `active` intervals                                                                                  |
| `Note ...`                                    | `note` event                                                                                                     |
| `par ... and ... end`                         | branches start at the same instant; continues after the longest branch                                         |
| `loop`, `alt`, `opt`, `critical`, `break`     | played once in document order (warning: logic not represented)                                                  |

Timing: first message at 300 ms, each message 800 ms, 200 ms gap; deterministic. The scenario always passes the semantic validator (responses never start before their request ends).

## 4. What is not supported (reported, never silent)

draw.io: connectors to containers or text cells, self-loops, dangling connectors (all dropped with a warning); free text cells (ignored with a warning; not components); `%placeholders%` (imported as written); images/icons, colours, fonts; embedded draw.io in `.svg`/`.png`.

Mermaid: every diagram type except flowchart/graph and sequenceDiagram (`mermaid.unsupported_diagram`); links to subgraphs; invisible links; styling (`classDef`, `class`, `style`, `linkStyle`), `click` (never followed); per-subgraph `direction`; thick links are imported as solid; cross arrowheads as triangles; sequence `destroy`, `autonumber`, `title`, `link(s)`, `properties`, `details`; bidirectional messages (`<<->>`) as one message.

## 5. Issue codes

Errors (import fails): `drawio.not_text`, `drawio.too_large`, `drawio.empty`, `drawio.malformed`, `drawio.doctype_rejected`, `drawio.too_complex`, `drawio.no_model`, `drawio.no_page`, `drawio.decompress_failed`, `drawio.no_components`, `drawio.too_many_nodes`, `drawio.too_many_edges`, `drawio.too_many_groups`; `mermaid.not_text`, `mermaid.too_large`, `mermaid.empty`, `mermaid.unsupported_diagram`, `mermaid.not_flowchart`, `mermaid.not_sequence`, `mermaid.no_nodes`, `mermaid.no_participants`, `mermaid.sequence_too_long`, `mermaid.too_many_events`; `validation.*` (importer produced an invalid document, i.e. a bug).

Warnings (import succeeds): `import.ids_rewritten`, `import.label_truncated`; `drawio.multiple_pages`, `drawio.placeholders_not_expanded`, `drawio.duplicate_cell_id`, `drawio.selection_group_flattened`, `drawio.text_ignored`, `drawio.missing_geometry`, `drawio.node_resized`, `drawio.dangling_edge`, `drawio.edge_to_group`, `drawio.edge_unsupported_endpoint`, `drawio.self_loop`, `drawio.waypoints_truncated`, `drawio.arrow_mapped`; `mermaid.ignored_<keyword>`, `mermaid.unrecognised_statement`, `mermaid.unbalanced_end`, `mermaid.unclosed_subgraph`, `mermaid.unclosed_block`, `mermaid.subgraph_direction_ignored`, `mermaid.id_conflict`, `mermaid.invisible_link`, `mermaid.edge_to_group`, `mermaid.self_loop`, `mermaid.thick_link`, `mermaid.cross_arrow`, `mermaid.destroy_ignored`, `mermaid.block_flattened`, `mermaid.deactivate_inactive`, `mermaid.self_message`, `mermaid.bidirectional_message`; `validation.<warning code>`.

## 6. Security and resource limits

- Input is data only. Nothing is executed, fetched or followed (no URLs, no `click` handlers, no image loading). HTML labels are stripped as text, never parsed by a browser.
- XML: `DOCTYPE`/`ENTITY` refused before parsing (no entity expansion, no external entities); strict well-formedness (saxes); at most 50,000 elements and depth 64.
- Inputs above 4,000,000 characters rejected; compressed pages above 16 MB after inflation rejected (decompression-bomb guard, streamed).
- Output bounded by the canonical limits (500 nodes, 1,500 edges, 100 groups, 5,000 events, 10 min scenarios).
- Fuzzing: 1,200 seeded mutations of the corpus per run; importers never throw and never return an invalid document.

## 7. Size

Browser bundle of importers + validator, esbuild minified: 147,732 B, **49,117 B gzip** (our code 45.7 KB, dagre 48.0 KB, zod 25.8 KB, saxes 23.6 KB, xmlchars 4.1 KB before gzip).
