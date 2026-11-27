# Layout, connector routing and connector semantics

This note covers diagrams whose geometry ArchFlow generates: text descriptions, Mermaid flowcharts and PlantUML component diagrams. draw.io and canonical JSON keep the author's geometry; they still get connector semantics and label anchors when present.

The code is in `packages/diagram-importers/src/layout.ts`. Geometry shared with the renderer is in `packages/canonical-model/src/connector-geometry.ts`.

## Layout pipeline

1. **Separate monitoring from requests.**
   - A *monitor-only* component is one whose every connector is a monitoring connector it starts, for example "ALB Health Check".
   - Monitor-only components and all monitoring connectors are left out of the request layout, so health checks cannot pull targets out of line or add crossings.
2. **Order the request flow.** dagre (MIT) assigns ranks, orders components within each rank and gives cross-axis positions, including the positions of connectors that skip ranks.
3. **Space the ranks.** Each gap between ranks gets just enough width for its vertical connector tracks plus the widest label that may sit there. Text is never shrunk to make a layout fit.
4. **Assign ports.**
   - Every connector leaves and enters through its own port, spread along the node side and sorted by the position of the other end to avoid crossings.
   - Nodes with many ports on one side grow taller.
   - Ellipse, diamond, cloud, parallelogram, hexagon and queue shapes use the midpoint of their side, because their outline is not a straight vertical line.
5. **Assign tracks.**
   - Each vertical leg runs on its own track in its gap.
   - Track order is improved by adjacent swaps while that removes crossings, which is deterministic and bounded.
   - Monitoring tracks sit closest to their target column, so a probe's last leg never crosses request legs.
6. **Monitoring band.**
   - Monitor-only components go below the request flow.
   - Their connectors run in lanes there; labelled lanes are spaced so their labels fit.
   - The connectors climb to the far side of their targets, away from incoming requests.
   - Lane order matches track order, which gives no crossings within one checker's connectors.
7. **Place labels.**
   - Each label is tried at candidate positions along its own connector. Request labels try the last segment first, next to the target; monitoring labels try lanes first.
   - The first position that touches no node and no placed label wins. Positions are computed with the engine's own `PointAlong` math, so the label lands exactly there.
   - If any label cannot be placed, spacing grows and the layout repeats, up to 5 attempts, keeping the best.
8. **Other directions.** Top-to-bottom, bottom-to-top and right-to-left layouts are computed in a left-to-right frame and mapped back.

Everything is rounded to integers and uses estimated text widths. The same input gives byte-identical output in Node and every browser.

## Connector semantics

Canonical `edge.interaction` (schema minor 2) is either explicit or inferred and reported; see `CANONICAL_MODEL.md`.

| Interaction | Line | Animation | Packets |
| --- | --- | --- | --- |
| `sync_request` | solid, triangle head | none | request capsule; response back on the same connector |
| `async_message` | dotted | running dashes along the connector while a message travels (engine `link` step) | event envelope |
| `monitoring` | thin dashed teal, open head | none | `probe`: small teal dot, no trail; answer `success`/`error`; target flashes healthy/unhealthy |
| `response` | dashed slate, open head | none | responses of the call it answers |

The adapter applies these styles only when `interaction` is set explicitly. Documents without it, such as the existing golden fixtures, render exactly as before.

## Engine details that matter

- **Ports.** The engine (pinned AnimatedDiagrams v2.2.0) supports node ports and edge `fromPort`/`toPort`.
  - It makes ids unique across the whole document, renaming clashes, so the adapter uses document-unique port ids (`port:<node>:<n>`).
  - It always draws a 4 px marker at every port. ArchFlow's painter hides exactly those markers (`portMarkerKeys`) in playback and video export.
  - The painter parity test proves that hiding them changes pixels only within 8 px of a port.
- **Label anchors.** Labels use the engine's own `labelPos`/`labelOff`.

## Health checks

See `SYNTHESIZER.md`. In short:

- **Probes:** periodic rounds in their own flows, independent of request timing.
- **Results:** healthy targets answer on the same connector. An injected failure on a health check makes probes time out or error and marks the target "unhealthy".
- **No invented configuration:** interval text stays a label, and no thresholds are invented.
- **Phase 2:** routing round-robin traffic away from targets marked unhealthy.

## Readability of large diagrams

Labels keep the engine's 12 px, and gaps grow to fit them; text is never shrunk. In the app, mouse-wheel zoom, the zoom buttons and drag-to-pan (up to 8×) make any part readable. Video export renders the whole diagram.

## Tests

- **`apps/web/test/routing.test.ts`**, run on every generated-geometry fixture (all text, Mermaid flowchart and PlantUML component fixtures):
  - every segment horizontal or vertical;
  - no connector through a node;
  - no label on a node or on another label;
  - crossings at or below a per-fixture maximum (currently 0 everywhere);
  - byte-identical output on a second run.
- **AWS ALB checks** in the same file: column order, health checker below the request flow, monitoring connectors, zero crossings, and reported inference.
- **`packages/scenario-synthesizer/test/health.test.ts`**:
  - probes only on monitoring connectors, and no traffic on them;
  - separate flows;
  - healthy and unhealthy results;
  - the injected failure;
  - no invented configuration;
  - determinism.
- **`packages/renderer-adapter/test/adapt.test.ts`**: styles per interaction, probe packets, async link animation, document-unique ports, label anchors.
- **`packages/canonical-model/test/semantic.test.ts`**: the new error and warning codes.
- **`packages/engine-host/test/painter.browser.test.ts`**: pixel parity with the upstream player now includes the ALB diagram (ports, waypoints, label anchors, probes, edge animation), and port markers are hidden only at ports.
- **`apps/web/test/app.browser.test.ts`**: zoom, pan without toggling playback, and fit.
- **Golden frames:**
  - `aws-alb` (display list and pixels) renders `fixtures/scenarios/aws-alb.canonical.json`.
  - `apps/web/test/regression-fixture.test.ts` keeps that file equal to the pipeline output for `fixtures/regression/aws-alb.txt`.
  - The existing `linear-3` and `order-flow` goldens are unchanged.
  - Pixel goldens use the upstream reference player, which shows port markers; the app does not.
