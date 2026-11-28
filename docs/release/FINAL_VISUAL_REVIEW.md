# Final visual review

The screens were captured from the final build with `node scripts/ui-screenshots.mjs --tag after` in Chrome 158. There are 16 screens at 4 window sizes, 64 images in all. The full set is in `artifacts/ui/screens/after/<size>/`, which git ignores. The key images are copied to `docs/release/screenshots/`.

## Screens captured (each at 1920×1080, 1600×900, 1366×768 and 1280×720)

| Screen | File | Reviewed |
| --- | --- | --- |
| Welcome (first visit) | `01-first-visit` | ✓ |
| Workspace | `02-workspace` | ✓ |
| Example gallery | `03-examples` | ✓ |
| Scenario panel | `04-scenario` | ✓ |
| Diagnostics panel | `05-diagnostics` | ✓ |
| Playback with automatic camera | `06-playing-auto-camera` | ✓ |
| Manual zoom | `07-manual-zoom` | ✓ |
| View options | `08-view-options` | ✓ |
| Presentation | `09-presentation` | ✓ |
| Export dialog | `10-export-dialog` | ✓ |
| Export success | `11-export-done` | ✓ |
| Error state (stale animation) | `12-error` | ✓ |
| Sidebar collapsed | `13-sidebar-collapsed` | ✓ |
| Light workspace | `14-light-workspace` | ✓ |
| Diagnostic highlighted on the diagram (new) | `15-diagnostic-highlight` | ✓ |
| Editor error line (new) | `16-editor-error-line` | ✓ |

Phone and tablet widths were checked separately:

- 390×844, 768×1024 and 1024×768 in Chrome, Edge and Firefox;
- 360×740 in Chrome and Edge.

See BROWSER_VALIDATION_REPORT.md.

## Defects found and fixed (before → after)

| Defect | Before | After |
| --- | --- | --- |
| Header wider than a 390 px phone screen; Export button off-screen and covered | `screenshots/phone-390-before.png` | `screenshots/phone-390-after.png`. The header fits and shows the logo and icon buttons; "Local" stays readable to screen readers. |
| Page scrolled 42 px behind the welcome overlay on phones | (same before image: header cut off) | The welcome now covers the whole window on narrow screens; scroll position 0 |
| Saved 443 px sidebar pushed speed and loop off-screen at 1024×768 | `screenshots/tablet-1024-side443-before.png` | `screenshots/tablet-1024-side443-after.png`. The sidebar is clamped so the stage keeps at least 640 px; the saved preference is kept for larger windows. |
| Loop toggle invisible in presentation (white icon on a light background) | `screenshots/present-loop-before.png` | `screenshots/present-loop-after.png`. Blue tint and white icon |
| Highlight outline invisible on light animation themes | — | Dark under-stroke under the amber outline (`screenshots/1920-15-diagnostic-highlight.png`) |
| Failure ticks differ from normal ticks by colour only | — | Taller red tick, visible in the tablet after-image |

## New screens from this pass

- **Diagnostic → diagram** (`1366-15-diagnostic-highlight.png`, `1920-15-diagnostic-highlight.png`):
  - "Show on diagram" frames the named components with an amber outline.
  - The chip reads "Highlighted: Auth TG, Web TG, Auth Service".
  - The "Back to overview" button appears next to the chip.
- **Editor error line** (`1366-16-editor-error-line.png`):
  - The editor has a line-number gutter.
  - The line the diagnostic names is marked in the gutter and with a band behind the text, and "Go to line" selects it.

## Known visual limitations (not fixed)

- In `bench-text` at t≈6.5 s, the "1s" timeout ring and its caption overlap the "Consumer 1" title. The overlap is drawn by the pinned animation engine and painter, and it is the same in playback and export. Classification: Low, future engine work.
- On phones the editor comes before the canvas, and the canvas uses 70% of the viewport height. Editing a diagram on a phone works but is cramped. The product targets desktop and tablet.
- A wide diagram in the vertical 1080×1920 export is letterboxed and small. The option label says so.
