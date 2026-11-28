# Accessibility, security and performance report

An independent review agent ran this review against the production build (`apps/web/dist`) in headless Chrome 158 at 1366×768. It used scripted keyboard walks, contrast calculation, injection payloads, network and storage inspection, and performance traces. The findings were fixed in this pass. Each fix is covered by a test or re-measured, as stated below.

The contrast calculator is in `artifacts/release/a11y-security/contrast.mjs`.

## Summary

| Area | Result |
| --- | --- |
| Critical / High findings | **None** |
| Medium findings | 5. All are fixed. |
| Low findings | 6. Five are fixed; one is accepted (4K bitrate cap, see below). |
| XSS / injection | No execution with `<img onerror>` payloads in Describe, Mermaid and JSON labels, titles and ids. 0 elements were created, and labels are drawn as text. |
| CSP | 0 violations, including CSSOM style writes and `form method=dialog` under `form-action 'none'`. |
| Network | 0 requests after page load while loading examples, importing, downloading JSON and exporting WebM. Processing is fully local. |
| Storage | `localStorage` holds only `welcomed`, `workspaceTheme`, `sidebar` and `sidebarWidth`. No diagram content is stored. |
| File import | A 4.2 MB file is refused with a clear message. |
| Prototype pollution | A `__proto__` key in JSON did not pollute any object. |
| Export file names | Sanitised. |

## Findings and fixes

| # | Severity | Finding | Fix | Verified by |
| --- | --- | --- | --- | --- |
| 1 | Medium (security, dev tooling only) | The local dev server (`scripts/serve-web.mjs`) crashed on a malformed URL such as `/%E0%A4%A`. `decodeURIComponent` threw, and later requests failed. This is not in the deployed product, which uses Cloudflare static assets. | Decode inside try/catch and answer **400**. A no-op line was removed. | Browser test "the local server answers a malformed URL with 400 and keeps running" |
| 2 | Medium (WCAG 1.4.3) | Contrast was too low in four places: light `--accent` on surface-2 (4.27:1), light `--ok` on ok-soft (4.40:1), and white on the dark-theme error badge (2.52:1). | Light `--accent` changed `#2f6fed` → `#2a63d4` (about 5:1). Light `--ok` changed `#1a7f4b` → `#17703f`. A new `--on-error` token is white in light and `#0b1018` in dark (about 8:1). | Values recomputed with `contrast.mjs` |
| 3 | Medium (WCAG 2.5.8) | "Show on diagram" (20 px tall) and "Technical details" (17 px) were too small and too close together. | `min-height: 24px` on diagnostic action links and on `summary` | Screenshots `05-diagnostics`, `15-diagnostic-highlight` |
| 4 | Medium (WCAG 1.4.11) | The amber canvas highlight was 1.55:1 on light animation themes. | A dark under-stroke (`rgba(27,20,0,0.9)`, 5·dpr) is drawn under the amber line. The outline is now visible on light and dark scenes. | Browser test of the highlight pixel count; screenshot `1920-15-diagnostic-highlight` |
| 5 | Medium (screen readers) | `#view-chip` was a live region, so 12 zoom key presses gave 12 announcements. | The chip is no longer live. A separate `sr-only` `#view-announce` status announces **mode changes only** (for example "Manual view"), not each percentage. | Browser test "focus and announcements…" |
| 6 | Low | Closing the example gallery sent focus to the canvas, not to the button that opened it. | `showWelcome` remembers the opener; `hideWelcome` restores focus to it, or to the canvas if it is gone. | Browser test: Enter on `#open-examples`, Esc, focus is back on `#open-examples` |
| 7 | Low | The view popover stayed open after tabbing out of it. | It closes on `focusout` when focus leaves `.menu-wrap`. | Same browser test |
| 8 | Low (WCAG 1.4.1) | Failure ticks on the timeline and warning or error marks in the editor differed by colour only. | Failure ticks are taller (12 px against 6 px) and have a title such as "Timeout at 6.6 s". Warning bands have a dashed edge; error bands keep a solid edge. | Screenshot `tablet-1024-side443-after` (red tall tick) |
| 9 | Low (ARIA) | `aria-label` was set on a plain `span` (`#time`). | `role="timer"` with `aria-live="off"` | Markup |
| 10 | Low (performance) | In a 200,000-line editor, every keystroke split the whole text and rebuilt every gutter number (about 2.3 s). | Newlines are counted without building an array, and only the difference is added to or removed from the gutter. | Unit and browser tests; no layout change |
| 11 | Low (quality) | 4K exports are capped at 12 Mbit/s. | Accepted, not changed. The measured 4K files average 1.6–2.7 Mbit/s, far below the cap (see EXPORT_VALIDATION_REPORT.md). | Export measurements |

## Verified without changes

- **Keyboard:**
  - The order is logical, with 37 stops: header → tabs → editor → resizer → canvas → tools → transport → footer.
  - The focus ring is visible on every stop, in light and dark.
  - Arrow keys, Home and End move between the sidebar tabs.
- **Focus after actions:**
  - "Show on diagram" moves focus to "Back to overview".
  - "Back to overview" moves focus to the canvas, not to `<body>`.
  - "Go to line" selects the line, and the gutter scrolls with the text.
  - Dialogs return focus to their opener.
  - Leaving presentation returns focus to the Present button.
- **Reduced motion:** playback does not start by itself, and CSS transitions are off. This was checked in Chrome and Edge by emulation and in Firefox through its `ui.prefersReducedMotion` setting.
- **Contrast elsewhere:**
  - overlay text 15.4:1;
  - amber "Back to overview" 11.8:1;
  - muted text 5.0–7.6:1;
  - focus ring on the overlay 3.98:1 (light) and 5.72:1 (dark).
- **Target sizes:** all transport and toolbar buttons are at least 30×30 px.

## Performance (production build, 10 s of `bench-text` playback)

- **Frames:** 594 frames. The median frame interval is 16.70 ms and p95 is 16.90 ms, with one frame over 20 ms and no long tasks.
- **Main-thread work:** about 1.43 ms per frame, of which layout is about 0.17 ms.
- **Memory:** after loading all 11 examples twice, the heap was 4.7 MB then 4.8 MB. DOM nodes (3448/3447) and listeners (93) stayed flat.
- **Leaks:** 40 diagnostics re-renders and 30 highlight/clear cycles did not change the listener count.
- **Bundle (final build):**

  | Asset | Bytes | Gzip |
  | --- | --- | --- |
  | app JS | 344,318 | 112,835 |
  | app CSS | 23,631 | 5,817 |
  | engine | 375,849 | 161,713 |

  Against the baseline (109,914 B gzip), the app JS grew by 2.9 KB gzip and the CSS by 0.5 KB gzip. The growth comes from diagnostic navigation, the line gutter, the accessibility fixes and the Firefox MP4 fixes.

## Dependencies

- No dependency was added, removed or updated: `git diff package.json package-lock.json apps/web/package.json` is empty.
- `npm run licenses:check` scanned 287 packages and reported OK, with the same 5 documented exceptions as before.
- No paid service or API is used.
