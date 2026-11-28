# Before / after comparison

Both sets were captured by `scripts/ui-screenshots.mjs` (headless Chrome, `prefers-color-scheme: dark`, same build pipeline):

- Before: `--tag before` on commit `d041a0e`.
- After: `--tag after` on the redesigned workspace.

Full sets are in `artifacts/ui/screens/{before,after}/<size>/` (git-ignored). The copies below are in `docs/ui/screenshots/`.

## Workspace at 1366×768

| Before | After |
| ------ | ----- |
| ![before](screenshots/before/1366x768-initial.png) | ![after](screenshots/after/1366x768-02-workspace.png) |

| Measure (1366×768, from the screenshots) | Before | After |
| --- | --- | --- |
| Canvas size | ≈ 860 × 485 px (≈ 40 % of the window), fixed 16:9 box in a card | ≈ 1020 × 640 px (≈ 62 %); 1366 × 640 (≈ 83 %) with the sidebar collapsed; 1366 × 768 (100 %) in presentation |
| Page scroll needed | Yes: scenario controls and export below the fold (the script reported `fail-mode`, `fail-retries`, `apply` off-screen) | No: zero off-screen controls on all 56 screens |
| Controls | One wrapping row mixing transport, zoom, camera, speed, loop, theme and dim | Transport bar (playback only), canvas toolbar (view only), Diagram style popover, Export dialog |
| Export | Bottom of the page | Header button, opening a dialog |

## Same comparison at the other sizes

| Size | Before | After |
| --- | --- | --- |
| 1920×1080 | ![](screenshots/before/1920x1080-initial.png) | ![](screenshots/after/1920x1080-02-workspace.png) |
| 1280×720 | ![](screenshots/before/1280x720-initial.png) | ![](screenshots/after/1280x720-02-workspace.png) |

## Error state

| Before | After |
| --- | --- |
| ![](screenshots/before/1366x768-error.png) | ![](screenshots/after/1366x768-12-error.png) |

- **Before:** the raw code `mermaid.unsupported_diagram`, below the fold, while the old animation kept playing as if it were current.
- **After:** the line under the editor says "Cannot animate: Unsupported Mermaid diagram type" with a Details link. The editor gets a red border, the Diagnostics tab gets a red badge, and the canvas is dimmed with "Showing the last valid animation · fix the errors to update it".

## New screens (after only)

| Screen | Image |
| --- | --- |
| First visit: three ways to start | ![](screenshots/after/1366x768-01-first-visit.png) |
| Example gallery | ![](screenshots/after/1366x768-03-examples.png) |
| Scenario tab (failure injection grouped) | ![](screenshots/after/1366x768-04-scenario.png) |
| Diagnostics tab | ![](screenshots/after/1366x768-05-diagnostics.png) |
| Manual zoom (chip says "Manual view · 196%", auto camera switch off) | ![](screenshots/after/1366x768-07-manual-zoom.png) |
| Diagram style popover (animation theme, dim) | ![](screenshots/after/1366x768-08-view-options.png) |
| Presentation mode | ![](screenshots/after/1366x768-09-presentation.png) |
| Export dialog | ![](screenshots/after/1366x768-10-export-dialog.png) |
| Export finished | ![](screenshots/after/1366x768-11-export-done.png) |
| Sidebar collapsed | ![](screenshots/after/1366x768-13-sidebar-collapsed.png) |
| Light workspace (the diagram keeps its own theme) | ![](screenshots/after/1366x768-14-light-workspace.png) |
| 1920×1080 presentation | ![](screenshots/after/1920x1080-09-presentation.png) |
| 1280×720 first visit | ![](screenshots/after/1280x720-01-first-visit.png) |

## What did not change

The diagram itself is unchanged: same engine, painter, geometry, labels and camera. Canvas pixels at the same view are identical, as the golden tests, the camera tests and the "workspace theme is independent of the animation theme" browser test confirm. The canvas only got more room.
