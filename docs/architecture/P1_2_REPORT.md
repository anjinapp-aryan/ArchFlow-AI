# P1.2 Report — Canonical model, scenario model, versioning, strict semantic validation

Date: 2026-11-26. Scope: P1.2 only. Nothing deployed, nothing pushed. No importers, no AI scenario generation, no P1.3+.

## Result

**GO for P1.2.** Spec: `docs/architecture/CANONICAL_MODEL.md`. `npm run ci` passes locally: typecheck, lint (ESLint + Prettier), 146 unit tests, 12 browser/golden tests, licence gate. The CI workflow still has not been executed (no push).

## Files changed

New

- `LICENSE` (MIT, **copyright holder is a documented placeholder**)
- `packages/canonical-model/src/rules.ts` (all semantic rules), `codes.ts` (issue catalog), `migrate.ts` (versioning)
- `packages/canonical-model/test/semantic.test.ts` (87 tests), `migrate.test.ts` (24 tests)
- `docs/architecture/CANONICAL_MODEL.md`, `docs/architecture/P1_2_REPORT.md`

Modified

- `packages/canonical-model/src/schema.ts`: additive optional fields `respondsTo`, `retryOf`, `fallbackOf` (packet), `waitingFor` (timeout), `recovers` (node_state), `parentFlowId`, `description` (flow), `diagramId` (scenario), `schemaMinor` (document); `CANONICAL_SCHEMA_MAJOR/MINOR`
- `packages/canonical-model/src/validate.ts` (now orchestration only; result gains `warnings`; `ValidationOptions`), `index.ts`
- `packages/renderer-adapter/src/adapt.ts`: `toEngineDocument(input, options?)`, new `assertEngineSafe` (code `adapter.engine_would_drop`)
- `packages/renderer-adapter/test/adapt.test.ts`: new safety-net tests; the "maps arrow directions" test now passes `{ directionPolicy: "off" }` (see note below)
- `fixtures/scenarios/order-flow.canonical.json`, `linear-3.canonical.json`: **metadata only** (`respondsTo`, `retryOf`, `attempt`, `recovers`, flow hierarchy, `diagramId`; flows `a12/a13/s4` moved to `request`, `response` flow removed)
- `fixtures/scenarios/invalid/groups-unsupported.json`: added `respondsTo` so it still fails only for its intended reason
- Licence: root and all four `packages/*/package.json` + `package-lock.json` -> `MIT`; `README.md`, `THIRD_PARTY_NOTICES.md` (one sentence; all notices preserved), comment in `scripts/check-licenses.mjs`

Untouched: engine build, pinned hashes, `engine/`, golden files (`fixtures/golden/**`), `licenses/`, P1.0/P1.1 docs, `poc/`, `research/`.

**On the two existing tests I touched.** No assertion was weakened. (1) "maps arrow directions" flips an edge's direction while the same scenario still sends requests along it; that is now (correctly) rejected as `packet.against_direction`, so the test opts out of that one rule via the new `directionPolicy: "off"` option while asserting exactly the same arrow mapping. (2) The groups fixture needed one metadata field so the intended error (`unsupported.groups`) is the one reported. Golden files were not regenerated: adapter output for both fixtures is byte-identical, so display-list and pixel goldens still match.

## Schema examples

See `CANONICAL_MODEL.md` §3 for the full request/timeout/retry/recovery document (it is parsed by a test, so it cannot rot). Minimal packet with all relationship fields:

```json
{ "type": "packet", "id": "p2", "t": 3000, "durationMs": 800, "flowId": "q",
  "from": "api", "to": "db", "variant": "retry", "attempt": 2, "retryOf": "p1" }
```

## Validation rules implemented

56 error codes and 5 warning codes, catalogued in `codes.ts` and documented in `CANONICAL_MODEL.md` §4: references/identity, connector existence/ambiguity/direction, duration and scenario bounds, request/response pairing (reversed endpoints, ordering, one answer per request), retry chains (target failed, ordering, attempt = previous + 1, no duplicate retry, attempt cap), fallbacks, timeouts (waiting node, ordering, response-before-expiry), contradictory/disabled node states and recovery, flow hierarchy (cycle, mismatch, parent ordering), group cycles, plus the adapter's `engine_would_drop` safety net. Two meta-tests enforce that every error and warning code has a negative test and that no code used in `rules.ts` is missing from the catalog.

## Tests and commands

| Command                                                           | Result                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                               | PASS                                                                                       |
| `npm run lint`                                                    | PASS                                                                                       |
| `npm run test:unit`                                               | PASS, 146 tests (canonical-model 133 incl. a 600-case seeded fuzz; renderer-adapter 13)   |
| `npm run test:browser`                                            | PASS, 12 tests, goldens unchanged and **not regenerated**                                  |
| `npm run licenses:check`                                          | PASS, 279 packages, 5 reviewed exceptions (unchanged)                                      |
| `npm run ci`                                                      | PASS, 158 tests total                                                                      |

Test categories: positive (baseline, both fixtures, timeout+retry+fallback, parallel flows), negative (one per error code, plus P1.1 invalid fixtures), boundary (duration 1 / 0.999 ms, end exactly at scenario end, 5000 vs 5001 events, id 64/65, coordinates +-100000, node size 20/19.99, waypoints 32/33, label 200/201, retry attempt 10/11 and configurable cap, retry exactly at failure end, response exactly at request end), regression (everything the engine silently repairs is an error; adapter safety net), robustness (600 seeded mutations: never throws, `ok` iff no errors; determinism; input not mutated), migration (current/newer major/newer minor/garbage/injected multi-step migrations/missing step), documentation example.

## Unresolved design decisions (need your call, none blocks P1.3)

1. **Copyright holder** in `LICENSE`: placeholder, must be confirmed before any publication.
2. **Strict direction default.** Requests/retries/events must follow the arrow. Right for architecture diagrams, but importers (Mermaid `<-->`, draw.io arrows) may produce edges whose arrow disagrees with the traffic. Kept `strict` as the default with `warn`/`off` available; revisit with the P1.3 corpus.
3. **`down` nodes are warnings, `disabled` nodes are errors.** I kept a `down` component sending/receiving as a warning so the benchmark's "Consumer 2 down -> error -> retry" story is expressible. If you want it an error, the fixture needs an explicit non-`down` state for the failing component.
4. **Failure semantics** ("a retry needs a failed target") rely on `variant: error` or an explicit `timeout.waitingFor`. Importers/AI must emit these links; there is no inference. Intentional (explicit beats guessed) but adds authoring burden.
5. **Edges named `edges`, not `connectors`.** Kept for P1.1 compatibility; the spec says edge = connector. Renaming would be a major-version change.
6. **Groups** are modelled and validated but still rejected by the adapter (engine cannot render them). Options for later: flatten to a background rectangle, or extend the engine.
7. **Tightening unreleased P1.1 schema** without a major bump (the only documents are our fixtures). From the first public release, rule changes follow the policy in `CANONICAL_MODEL.md` §5.
8. Retry cap default (10) and `maxCoordinate`/`maxEvents` limits are my choices; adjust if real diagrams need more.

## Risks

- Rule set was designed from the benchmark scenario and my reading of the engine; real importer output (P1.3+) will probably reveal rules that are too strict or missing. Mitigated by warn/off policies and the code catalog.
- Fuzz test is a smoke test (600 cases, one seed), not exhaustive.
- CI workflow, Linux/macOS builds and cross-OS pixel goldens remain unverified, as in P1.1.
- `parseCanonical` migration path is unexercised by real data until a second major exists.

## Recommendation

**GO for P1.2.** Stopping here; P1.3 not started. Waiting for explicit approval and your decisions on items 1-3.
