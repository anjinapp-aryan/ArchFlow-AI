# PlantUML import feasibility (P1.8 spike) — decision: **GO (shipped)**

Date: 2026-11-26. Code: `packages/diagram-importers/src/plantuml.ts`. Tests: `packages/diagram-importers/test/plantuml.test.ts` (20), corpus acceptance (`packages/importer-eval/test/acceptance.test.ts`).

## Approach

PlantUML itself is a Java program (GPL by default; LGPL/EPL/Apache/MIT editions exist with reduced features). It cannot run in the browser bundle and its default licence is incompatible with an MIT product, so it is **not used**. ArchFlow translates PlantUML text, statement by statement, into the intermediate statements its Mermaid parsers already consume:

- **Component and deployment diagrams** go through the flowchart parser plus layout.
- **Sequence diagrams** go through the sequence parser, which produces timed packets, reply pairing, activations and boxes.

Element kinds (database, queue, actor, cloud, artifact…) are carried across. Diagram type is decided from keyword signals, as PlantUML itself does.

## What was tested

| Requirement (master prompt) | Covered by |
|---|---|
| Component diagrams | 10 generated diagrams (`*.puml` rendering of the corpus) + `16-plantuml-component.puml` |
| Sequence diagrams | `11-sequence.puml` (generated) + `17-plantuml-sequence.puml` |
| Directional connectors | `-->`, `->`, `..>`, `<--`, `<-->`, `--`, `..`, `-up->`/`-right->`, `-[#red]->`, UML heads (`--|>`) |
| Labels | `A --> B : label` (labels containing `:` too), quoted names |
| Groups and packages | `package`, `node`, `folder`, `frame`, `cloud`, `rectangle` … `{ }`, nested |
| Relationships and aliases | `[Long name] as X`, `component "Name" as X`, `actor Name as X`, `X as "Name"`, `()`, `:actor:` |

## Measured results (same scorer as draw.io/Mermaid)

| File set | Passing | Notes |
|---|---|---|
| 11 generated component diagrams | 11 / 11 | nodes, edges, direction, dashed, groups, nesting, membership all 100 % |
| 2 sequence diagrams | 2 / 2 | ordered messages and reply recognition 100 % |
| 13 PlantUML files total | **13 / 13** | native AnimatedDiagrams and CogniFlow do not support PlantUML (0 / 13, rejected) |

Identities are preserved: aliases become canonical ids, display names become labels. Element kinds become canonical kinds.

## Limits (reported to the user, never silent)

- **Not imported:** notes, dividers, delays, `ref`, `return`, multi-line notes, skinparams, themes, sprites, stereotypes. They raise warnings `plantuml.note_ignored`, `plantuml.sequence_construct_ignored` and `plantuml.ignored_*`.
- **UML relation heads** (extension, composition, aggregation) become plain arrows (`plantuml.uml_relation`).
- **Other diagram types** (class, use case, activity, state, mindmap, gantt) are rejected with `plantuml.unsupported_diagram`, or produce warnings.
- **`!include` and preprocessing** (`!define`, `!procedure`) are ignored. Includes are never fetched.
- **Layout:** positions come from ArchFlow's dagre layout, not PlantUML's Graphviz layout, so the picture differs while the structure matches.
- **Evidence:** the corpus is synthetic and self-written, the same caveat as `IMPORTER_FIDELITY.md`.

## Decision

**GO.** It ships as a supported input format, with a tab and examples in the web app. The next evidence needed is real PlantUML files from users.
