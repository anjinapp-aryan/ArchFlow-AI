# ArchFlow canonical model — specification (schema `archflow/canonical@1`, minor 1)

Source of truth: `packages/canonical-model/src/schema.ts` (structure), `rules.ts` (semantics), `codes.ts` (issue catalog), `migrate.ts` (versioning). This document describes them; if they disagree, the code wins and this file is a bug.

## 1. Principles

1. **Renderer-independent.** Nothing here mentions AnimatedDiagrams, canvas, WASM, Qt or any engine field. `@archflow/renderer-adapter` maps the model to the engine's document v3 and is the only place that knows the engine.
2. **Data only.** No field carries code, expressions, URLs or file paths. Everything is bounded (`LIMITS`). Unknown keys are errors (`z.strictObject`).
3. **Strict before rendering.** The upstream engine silently erases unknown-node steps, removes self-loops and clamps durations. Every such case is an error in our validator, and the adapter re-checks its own output (`assertEngineSafe`, code `adapter.engine_would_drop`).
4. **Deterministic.** Validation is pure; issue order is document order per rule; no clocks, no randomness.

## 2. Document shape

```
CanonicalDocument
├─ schema        "archflow/canonical@1"        (literal; major version)
├─ schemaMinor   int 0..CANONICAL_SCHEMA_MINOR  (default 0)
├─ diagram
│   ├─ id, name, description?, background? (#rrggbb)
│   ├─ nodes[]   id, label, subtitle?, kind, x, y, w, h (>=20), groupId?
│   ├─ edges[]   id, from, to, label?, direction, arrowHead, stroke, routing, curve?, waypoints?   (an edge IS a connector)
│   └─ groups[]  id, label, parentId?, frame? {x, y, w, h}   (frame: minor 1)
└─ scenario?
    ├─ id, name?, diagramId?, durationMs (1000..600000)
    ├─ flows[]   id, label?, description?, parentFlowId?
    └─ events[]  discriminated on `type`: packet | node_state | timeout | note
```

### Identifiers

`^[A-Za-z0-9_.:-]{1,64}$`. Node, edge, group, event and flow ids are each unique within their kind; **event ids are unique across all event types** (they are cross-referenced). Ids are stable: tools must never renumber ids when editing, because `respondsTo`, `retryOf`, `fallbackOf`, `waitingFor`, `recovers`, `edgeId`, `flowId` and `parentFlowId` point at them.

### Connectors (geometry, direction, arrowheads)

An edge has endpoints (`from`,`to` node ids), an optional `waypoints` polyline (<= 32 points, diagram pixels), `routing` (`curved|straight|orthogonal`), `curve` (-1..1), `stroke`, and:

- `direction`: `forward` (arrowhead at `to`), `backward` (at `from`), `both`, `none`.
- `arrowHead`: shape used on every end that has one (`triangle|open|diamond|circle|none`).

Component relationships are the edges plus `groups` (hierarchy via `parentId`, membership via `node.groupId`). The adapter currently **rejects groups** (`unsupported.groups`) because the engine cannot draw them; the model keeps them so importers do not lose information.

### Events

| type         | key fields                                                                          | meaning                                                                                  |
| ------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packet`     | `from`,`to`,`edgeId?`,`variant`,`label?`,`shape?`,`count?`,`attempt?`,`respondsTo?`,`retryOf?`,`fallbackOf?` | data travelling over a connector for `[t, t+durationMs]`            |
| `node_state` | `nodeId`,`state`,`recovers?`                                                        | component activity: `ok active busy warn down success disabled`                           |
| `timeout`    | `nodeId`,`waitingFor?`                                                              | a wait that expires: `nodeId` is waiting (usually for the packet in `waitingFor`)         |
| `note`       | `text`,`x`,`y`                                                                      | free annotation                                                                          |

Common: `id`, `t` (start, ms), `durationMs` (>= 1 ms), `flowId?`. Packet variants: `request response retry error success event`.

Parallel execution = overlapping events, typically in different flows. A **flow** is a named logical thread; `parentFlowId` says which flow spawned it (a consumer flow spawned by a publish flow). Flows are kept in the canonical model only; the engine has no flow concept (adapter emits `info.flow_ids_not_rendered`).

## 3. Examples

### Request / response with timeout, retry and recovery (abridged)

```json
{
  "schema": "archflow/canonical@1",
  "diagram": {
    "id": "d",
    "name": "Demo",
    "nodes": [
      { "id": "api", "label": "API", "x": 0, "y": 0, "w": 100, "h": 50 },
      { "id": "db", "label": "DB", "kind": "db", "x": 300, "y": 0, "w": 100, "h": 50 }
    ],
    "edges": [{ "id": "e1", "from": "api", "to": "db", "label": "SQL" }]
  },
  "scenario": {
    "id": "s",
    "diagramId": "d",
    "durationMs": 10000,
    "flows": [{ "id": "q" }],
    "events": [
      { "type": "node_state", "id": "down", "t": 1000, "durationMs": 3000, "flowId": "q", "nodeId": "db", "state": "down" },
      { "type": "packet", "id": "p1", "t": 1000, "durationMs": 800, "flowId": "q", "from": "api", "to": "db", "variant": "request", "label": "INSERT" },
      { "type": "timeout", "id": "to1", "t": 1000, "durationMs": 2000, "flowId": "q", "nodeId": "api", "waitingFor": "p1", "label": "timeout" },
      { "type": "packet", "id": "p2", "t": 3000, "durationMs": 800, "flowId": "q", "from": "api", "to": "db", "variant": "retry", "attempt": 2, "retryOf": "p1", "label": "retry" },
      { "type": "node_state", "id": "up", "t": 4000, "durationMs": 1000, "flowId": "q", "nodeId": "db", "state": "ok", "recovers": "down" },
      { "type": "packet", "id": "p3", "t": 4000, "durationMs": 800, "flowId": "q", "from": "db", "to": "api", "variant": "response", "respondsTo": "p2", "label": "ok" }
    ]
  }
}
```

`p1` "fails" because a timeout waits for it (`to1`, ends 3000); the retry `p2` starts at 3000 (not earlier), repeats `api -> db`, and is attempt 2. The `down` state is a warning (`state.down_node_used`), not an error: showing traffic hitting a dead component is the point of the scenario.

### Failure variants of the same idea

- Error packet instead of timeout: `{"variant":"error", ...}` marks failure at its end; a retry may follow.
- Fallback: `{"variant":"request","from":"api","to":"replica","fallbackOf":"p1", ...}` (same source, different destination, after failure).

## 4. Semantic validation rules

Errors block the renderer; warnings do not. Codes are stable API (`codes.ts`); every error code has a negative test and a meta-test enforces that.

**Structural (stage 1, `schema.<zod code>`)** — types, enums, limits (500 nodes, 1500 edges, 100 groups, 5000 events, 32 waypoints, 200-char labels, 64-char ids, durations <= 600 s, coordinates +-100000, node size >= 20), unknown keys, `schemaMinor <= CANONICAL_SCHEMA_MINOR`.

**References & identity** — `ref.duplicate_id`, `ref.unknown_node|edge|group|flow`, `ref.diagram_mismatch`, `edge.self_loop`, `group.cycle`.

**Connectors** — `packet.no_connector`, `packet.ambiguous_connector` (several edges join the pair and no `edgeId`), `packet.edge_mismatch`, `packet.same_endpoints`, `packet.against_direction` (request/retry/event packets must follow the arrow unless the edge is `both`/`none`; responses, success and errors may go back; configurable `directionPolicy: strict|warn|off`).

**Timing** — `event.invalid_duration` (< 1 ms), `event.beyond_scenario` (ending exactly at scenario end is allowed); warning `event.unsorted`.

**Request/response** — `response.missing_responds_to` (variant `response` needs `respondsTo`), `response.unknown_target|target_not_packet|self_reference`, `response.endpoints_not_reversed`, `response.before_request` (may start exactly when the request ends), `response.duplicate` (one answer per request).

**Retries & fallbacks** — `retry.missing_retry_of`, `retry.unexpected_retry_of`, `retry.unknown_target|target_not_packet|self_reference`, `retry.endpoint_mismatch`, `retry.target_not_failed` (target must be variant `error` or have a timeout waiting for it), `retry.before_failure` (not before the failure is known), `retry.bad_attempt` (= target attempt (default 1) + 1), `retry.duplicate`, `retry.too_many_attempts` (default 10, `maxRetryAttempts`). `fallback.*`: unknown/not-packet/self target, `source_mismatch`, `same_destination`, `target_not_failed`, `before_failure`.

**Timeouts** — `timeout.unknown_packet|target_not_packet`, `timeout.node_mismatch` (the waiting node is the packet's sender), `timeout.before_packet`, `timeout.response_before_expiry` (a response that arrives before the timeout ends contradicts it).

**Node states** — `state.contradictory_overlap` (different states on one node at once), `state.disabled_node_used` (packet to/from a disabled node); warnings `state.redundant_overlap`, `state.down_node_used`. Recovery: `recover.unknown_target|target_not_state|node_mismatch|target_not_failure|bad_state|before_failure_end`.

**Flows** — `flow.cycle`, `flow.mismatch` (an event and the event it references are in different flows), `flow.starts_before_parent`; warning `flow.empty`. Warnings `geometry.nodes_overlap` and `geometry.node_outside_group` (a node or child group not inside its group's frame).

Result type: `{ ok, value?, errors[], warnings[] }`; each issue `{ code, path (JSON Pointer), message }`. `validateCanonical` never throws (fuzz-tested).

## 5. Versioning, compatibility, migration

- **Major** (`archflow/canonical@N` in `schema`): any change that can make a previously valid document invalid or change its meaning (renamed/removed field, tightened rule that existing data could violate, changed semantics). A new major requires a migration `N-1 -> N`.
- **Minor** (`schemaMinor`, absent = 0): additive, optional, backwards-compatible fields and new _warnings_. Old documents stay valid unchanged.
- **Readers**: a reader supports exactly one current major plus migrations from older majors. Documents with a **newer major** (`version.newer_than_supported`) or a **newer minor** (`version.minor_newer`; unknown fields cannot be preserved safely) are rejected with a clear message rather than guessed at.
- **Migrations**: pure functions on raw JSON, registered in `MIGRATIONS[n]` (n -> n+1), applied in order by `migrateCanonical`, then validated. `parseCanonical = migrate + validate` is the entry point for stored files; `validateCanonical` is for current-major data. No migration exists yet (only major 1); the mechanism is tested with injected fake migrations.
- **Tightening rules**: a new _error_ rule is a major-version change if real documents might break; the preferred path is to ship it first as a warning for one minor, then promote it in the next major with a migration that repairs or flags data. (P1.2 itself tightened the unreleased P1.1 schema; the only existing documents are our own fixtures, which were updated metadata-only.)
- **Engine independence**: the engine document version (v3) is separate and lives only in the adapter. A new engine version changes the adapter, not the canonical version.
- **AI output** must be a canonical document and goes through `parseCanonical`; nothing else may reach the adapter.

### Version history

| Minor | Date       | Change                                                                                                                       |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0     | 2026-11-26 | P1.2 baseline                                                                                                                |
| 1     | 2026-11-26 | optional `group.frame` (absolute rectangle, kept by importers); new warning `geometry.node_outside_group`. Minor-0 documents stay valid unchanged. |

## 6. Known gaps (deliberate)

Groups (with their frames) are modelled but not renderable by the engine; the adapter rejects them unless called with `groups: "flatten"`, which reports `info.groups_flattened`; `flows` are not rendered; no coordinate-level checks that waypoints stay near their nodes; no connector-crossing analysis; no per-flow timing budgets. Scenario generation is a later phase; importers are specified in `IMPORTERS.md`.
