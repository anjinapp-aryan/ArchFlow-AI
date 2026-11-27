# SVG import feasibility (P1.6 spike)

**Decision:**
- **GO** for draw.io SVG with an embedded diagram. This is shipped.
- **NO-GO for this release** for generic SVG. The prototype works on clean fixtures but has not been validated on real exports.

Date: 2026-11-26. Code:
- **Shipped:** the `svg` branch in `packages/diagram-importers/src/drawio.ts`.
- **Prototype, not shipped:** `packages/importer-eval/src/spikes/svg.ts`.

Measurements come from `packages/importer-eval/test/svg-spike.test.ts`; results are written to `artifacts/spikes/svg-results.json`.

## Fixtures

We used the 10 generated corpus diagrams, with exact ground truth, each rendered three ways:

1. **draw.io "Export as SVG → Include a copy of my diagram".** The full `mxfile` is stored in the root `content` attribute.
2. **Plain SVG**, covering every element the master prompt lists:
   - nested `<g transform="translate(…)">` groups;
   - `rect` and `text` components;
   - `path` connectors with `marker-end` and `marker-start` arrowheads;
   - straight (`L`), quadratic-curve (`Q`) and orthogonal (`H`/`V`) paths;
   - dashes set by a CSS class in a `<style>` block;
   - `id` and `url(#…)` references.
3. **An imitation of Mermaid's SVG structure:**
   - centred node groups;
   - `foreignObject` HTML labels;
   - cubic paths, with markers and dashes set by CSS classes;
   - cluster groups and edge-label groups.

   This imitates the structure; it is **not** output from Mermaid itself.

## Measured (per check, all 10 diagrams)

| Check | draw.io SVG (shipped) | Plain SVG (prototype) | Mermaid-like SVG (prototype) |
| --- | --- | --- | --- |
| diagrams fully correct | **10 / 10** | 9 / 10 | 9 / 10 |
| components (labels) | 45 / 45 | 45 / 45 | 45 / 45 |
| geometry ±1 px (position, size) | 45 / 45 | 45 / 45 | 45 / 45 |
| connectors (endpoints and labels) | 44 / 44 | 44 / 44 | 44 / 44 |
| arrow direction (markers) | 44 / 44 | 44 / 44 | 44 / 44 |
| dashed (attribute, style or CSS class) | 5 / 5 | 5 / 5 | 5 / 5 |
| groups, nesting, membership | 2/2, 1/1, 4/4 | 2/2, 1/1, 4/4 | 2/2, 1/1, 4/4 |
| routing style (curved/orthogonal) | 3 / 3 | 0 / 3 | 0 / 3 |

**Can packets follow existing connector paths?**
- **draw.io SVG: yes.** Waypoints and routing come from the embedded model.
- **Generic SVG: partly.** The prototype recovers only the connector endpoints, not the path shape. Following the original curve would mean sampling the path into canonical `waypoints` (up to 32 points). That is feasible, but it was not built.

## Why generic SVG is NO-GO for now

1. **The fixtures are ours.** Their connectors end exactly on node borders, labels sit inside shapes, and nothing else is drawn. Real exports (Lucid, Visio, Excalidraw, Figma, Mermaid, Graphviz) add:
   - shadows and duplicate outline shapes;
   - icons, text broken into glyph paths, and unlabelled decorative rectangles;
   - connectors drawn as several segments, with arrowheads as separate polygons instead of markers.

   None of that was tested.
2. **SVG carries no semantics.** An SVG has no notion of "this path connects these two boxes", so every rule is a geometric guess (15 px snapping, label-to-midpoint distance). Wrong guesses produce wrong animations silently, and that is exactly what this project's principles forbid.
3. **Hostile input.** `DOCTYPE` declarations are common in SVG files (Inkscape, older tools), and our XML parser rejects them by policy. The prototype removes a plain `DOCTYPE` before parsing. A product version would need a careful policy and a sanitizer review.

## What ships

`.svg` files and pasted SVG go to the draw.io importer:
- **SVG with an embedded draw.io diagram:** imported exactly, with the info warning `drawio.from_svg`.
- **Any other SVG:** rejected with `svg.not_supported` and a clear hint (re-export from draw.io with the diagram included, or use the source file).

## To reconsider generic SVG later

Collect 20 or more real SVG exports from at least 4 tools, run the prototype through the same scorer, and add a correction UI before any automatic import ships. Decide again on those numbers.
