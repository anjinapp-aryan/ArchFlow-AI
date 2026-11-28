# Automatic camera, themes and visual QA

Phase "feature adoption" from the audit of omkamal/animated-diagrams-skill ([research summary](../research/RESEARCH_EXECUTIVE_SUMMARY.md)).

- **Ideas only.** The camera rules, theme tokens and contact sheets were adapted as ideas. No upstream code or asset was copied, and nothing new is a runtime dependency.
- **Rendering unchanged.** Rendering is still the pinned WASM engine plus ArchFlow's painter.

## Automatic camera

Code: `packages/renderer-adapter/src/camera.ts` (pure) and `apps/web/src/framing.ts` (shared by playback and export).

**Inputs.** The canonical document, the engine's content bounds, the viewport aspect ratio, the scenario duration and the options. The plan never measures the DOM and never reads the clock.

**Output.** A list of segments:
- `hold`: a fixed view;
- `move`: a transition;
- `follow`: tracking one packet.

`cameraBoundsAt(plan, t)` returns the world rectangle the painter fits at instant `t`. Whenever the overview is shown, it returns exactly the engine's bounds, so those frames are pixel-identical to painting without a camera (browser-tested).

**What must stay visible.** Each scenario event adds something that must stay on screen while it runs:
- for a packet: both components, the connector path with room for the packet and its label, and the connector label;
- for a state change or a timeout: the component with its badge;
- for a note: the note.

The planner is greedy over the timeline:
- A stop frames everything active from the start of the transition into it until its own dwell and the next transition are over.
- A stop grows, by zooming out, when new activity does not fit and it is too early to move.
- When a frame would not gain at least 1.25× over the overview, the overview is used instead.

During a move, the frame's edges are interpolated linearly. Anything visible at both ends therefore stays visible throughout. An earlier version interpolated the zoom and broke this; the regression test with 12 sequence participants caught it.

**Options** (`CameraOptions`, all configurable):

| Option | Default | Meaning |
| --- | --- | --- |
| `maxStaticNodes` | 6 | no camera at or below this many components |
| `maxZoom` | 2.2 | relative to the overview fit |
| `minZoomGain` | 1.25 | a stop must zoom at least this much |
| `minDwellMs` | 1000 | shortest stop |
| `moveMs` | 1200 | one transition (cubic ease in-out) |
| `endHoldMs` | 1200 | final overview hold, when the scenario is long enough |
| `margin` | 28 | world px around the focus |
| `followPackets` | false | follow a lone packet along its real connector (orthogonal routes, engine easing) |
| `followZoom` | 1.8 | zoom while following |
| `snapToGroups` | true | frame the smallest group containing the focus, if it still gains enough zoom |
| `context` | true | keep the next destination in view: while a request or response travels, also frame the hop the scenario takes next from its destination |
| `safeMargin` | 0.05 | free space around the focus, as a fraction of the view per side (not at the diagram's own edge) |
| `avoidCuts` | true | a frame never cuts a component or a connector label at its edge; the planner searches zoom (3 % steps) and centre shifts (up to 20 %) for the highest cut-free frame |

Further rules (AWS ALB quality pass):
- A long state (a caller waiting for its answer, a target that stays unhealthy) is framed when it starts and when it ends, not for its whole duration.
- An ending summary (notes after all traffic) is always shown on the overview, from its start to the end.
- The optional packet-follow mode tracks the packet and is exempt from `avoidCuts`.

**In the app.**
- **Auto camera** is on by default.
- A manual zoom or pan switches it off, starting from the current camera view.
- Playback re-plans when the canvas aspect ratio changes.
- Export plans for the video's aspect ratio. For the same aspect ratio, playback and export get identical bounds at every frame (unit-tested).

**Limitation.** Everything active must stay visible, and frames must not cut anything. Diagrams with simultaneous activity across the whole diagram therefore stay mostly on the overview:
- the AWS ALB example: health-check rounds run during the request. Routed to one target group, the request takes about 7 s and overlaps both probe rounds, so no stop can be held for 1 s with its transitions. The example therefore plays on the overview, where adaptive labels keep the text readable;
- broadcasts to many consumers.

The camera then zooms only between those moments. Groups are not drawn by the engine (they are flattened), so group zoom frames the group's components without showing a container.

## Ending summary held to the last frame

Code: `packages/renderer-adapter/src/summary.ts`, the painter's `Framing.heldNotes`, and `apps/web/src/framing.ts` `heldNotes` (shared by playback and export).

- **Problem.** The engine fades every note out over the last 12 % of its duration. A summary that lasts to the end therefore faded during the final 0.4 s.
- **Fix.** `endingSummary(doc)` finds the note that starts after the last packet and timeout and lasts to the end. Once its fade-in is over, the painter draws that card, its accent bar and its text at full opacity, up to and including the last frame.
- **Matching.** The painter recognises the three items by the engine's note geometry (`_DrawNote`).
- **Scope.** Other notes keep the engine's fade. The engine and its display lists are unchanged.
- **Test.** A browser test checks that on the final frame the summary region equals the fully visible card, and that frames while the card is fully visible are pixel-identical with or without the hold.

## Adaptive connector labels

Code: `packages/renderer-adapter/src/labels.ts`, the painter's `Framing.labelScale`, and `apps/web/src/framing.ts` `labelScaler`.

- **Free space.** Each connector label gets a maximum scale, at most 1.5×. At that scale its box still touches no component, no other label and no other connector, and stays inside the diagram.
- **Scaling.** When a label is smaller than 11 px on screen (CSS px), the painter enlarges it up to that maximum. Labels that are already readable, at camera stops or in 1080p, are drawn exactly as laid out.
- **What does not change.** No label is hidden or shortened, and the layout is unchanged.
- **Measurements.** `apps/web/test/readability.test.ts` checks the rules at 1280×720 and 1920×1080 and writes `artifacts/qa/label-readability.md`.

## Themes

Code: `packages/renderer-adapter/src/themes.ts`, adapter option `theme`.

- **Mechanism.**
  - The engine's built-in design systems (`light`, `dark`, `blueprint`, `high-contrast` in `Model/Library.cpp`) are named in the document's `designSystem`.
  - Their scene colours are copied into `scene`, as the engine's own ApplyDesignSystem does.
- **Default.** `default` leaves the engine document byte-identical, so existing goldens are unchanged.
- **Deviations, both for contrast:**
  - **Light:** edge colour `#64748b` instead of `#94a3b8`, raising the ratio from 2.4:1 to 4.5:1.
  - **Blueprint:** a document-local copy (`archflow-blueprint`) of the built-in, with a clearly red "down" state. The built-in "warn" and "down" look alike.
- **Connector semantics.** Async, monitoring and response connectors and probes use a palette per theme.
- **Contrast tests.** WCAG 2 ratios for:
  - text on the background and on every state fill: at least 4.5;
  - connectors and connector labels: at least 3 and at least 4.5;
  - state colours must be told apart.
- **Engine check.** A browser test confirms the engine paints the assumed background and state fills. ArchFlow's painter equals the upstream player pixel for pixel in every theme.
- **Light theme limitation.** The light theme's node outline in the normal state (`#cbd5e1` on `#f6f8fc`) is faint. It comes from the engine's built-in, and the node fill, accent bar and title carry the node.

## Dim inactive components (off by default)

Code: `packages/renderer-adapter/src/dim.ts`, adapter option `dimInactive`.

- **Behaviour.** While something happens, components not involved fade to 35 % opacity and come back when involved. Inactive spells shorter than 800 ms are not dimmed.
- **How it is built.** Only engine `effect` steps:
  - built-in `fade-out`/`fade-in` at intensity 0.65;
  - one library effect holding 0.35.
- **Limitation.** The engine applies effects to nodes only. Connectors and packets keep full opacity.
- **Prerequisite, verified.** The painter draws effects exactly like the upstream player: 0 differing pixels at every instant tested. The effects change the picture only while they run.

## QA

| Tool | What it does |
| --- | --- |
| `npm run golden:sheet [-- --case aws-alb --times 0,7100]` | Contact sheet of recorded pixel goldens (case, scenario name, environment, timestamps) in `artifacts/contact-sheets/`. Reads goldens only; reproducible within one environment |
| `packages/qa/test/temporal.browser.test.ts` | For every event of every golden case: one frame before it starts, the engine output equals the animation without that event; halfway through, it differs |
| `apps/web/test/camera-check.ts` | Independent camera checks, sampled at 60 fps: components and packets (with labels) of every running event inside the frame, no jump (centre ≤ 12 % of the view per frame, zoom ≤ 6 %), zoom ≤ max, stops ≥ min dwell, one move at a time, starts and ends on the overview |
| `apps/web/test/camera.browser.test.ts` | The same checks with the engine's own bounds; painter determinism; overview == no camera; camera golden `fixtures/golden/aws-alb/camera.json` (platform independent); review sheets |
| `apps/web/test/visual-qa.test.ts` | Report in `artifacts/qa/visual-report.md`: overlapping labels, titles too long for their box, on-screen label size at the overview and at camera stops, components cut at stops. It does not judge colour harmony, balance, or text the engine places itself |
