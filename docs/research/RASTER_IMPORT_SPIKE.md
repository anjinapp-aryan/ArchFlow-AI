# Raster (PNG/JPG) import feasibility (P1.7 spike) — decision: **NO-GO for automatic import**

Date: 2026-11-26. Code: `research/spikes/raster/run.mjs` (research only, isolated `package.json`, never bundled). Raw results: `research/spikes/raster/out/results.json`, images in the same folder.

## Method

- **Input:** the 10 generated corpus diagrams rendered to 1280×720 PNG by ArchFlow's own painter. Every component rectangle, label and connector is known exactly.
  - This is the **easiest possible raster input**: flat colours, no compression artefacts, no photo distortion, no hand-drawn shapes, and a known font.
  - Real screenshots, photos and whiteboard pictures will score lower.
- **Tools** (all permissive, none shipped):
  - `tesseract.js` 7.0.0 (Apache-2.0), using the WebAssembly Tesseract core (Apache-2.0).
  - English LSTM language data, downloaded by `tesseract.js` at run time; the `tessdata` data is Apache-2.0.
  - No machine-learning detector was used. Component and connector detection are classic image processing written for the spike.
- **Steps:**
  1. Component detection: flat-colour region growing, then size and fill-ratio filters.
  2. Connector detection: "ink" sampling along the straight segment between two detected components.
  3. OCR on an inverted, grey-scaled, 2× upscaled copy. This preprocessing is standard; without it OCR read **0 / 45** labels.
  4. Direction detection (arrowheads): not attempted.

## Measured

| What | Result |
| --- | --- |
| Components found (IoU ≥ 0.5 with truth) | 45 / 45 found; 45 / 45 of detections correct |
| Labels read (every word of the label in the OCR text) | **26 / 45 (58 %)** |
| Connectors found (correct pair) | **34 / 44 (77 %)**; 34 / 44 of detections correct |
| Connectors fully recovered (link plus both endpoint labels) | **15 / 44 (34 %)** |
| Arrow direction | **0 / 44** (not attempted) |
| Connector labels, dashed or routing style, groups | not attempted |
| Mean OCR confidence (Tesseract, per image) | 62–80 |

Why connectors fail:
- curved and orthogonal connectors (straight-line sampling misses them);
- connectors that pass through or behind other components;
- false links where two components sit on one line;
- multiple connectors between one pair (counted once).

Why labels fail: small text (11–13 px), state subtitles ("Normal") mixed into labels, and labels cut by component borders.

Confidence scores: Tesseract gives per-word confidences; the detectors give none. A product would have to compute one per component and per connector and show it to the user.

## Decision

**NO-GO for automatic raster import.** Even on idealised input only a third of the connectors come back complete, and none with a direction. Animating that would show packets travelling wrong or missing paths with no warning, which the product principles rule out.

## What it would take (not planned for Phase 1)

1. **Assisted import, not automatic import.** Detections become editable suggestions in a correction UI (move or rename components, draw or flip connectors). Human correction would be required for every diagram.
2. **A real detector.** Candidates are a permissively licensed diagram or object detection model (licences for weights **and** training data must be checked separately), or an optional vision LLM producing canonical JSON. The LLM route needs explicit user consent to upload the image and must stay optional.
3. **A real-image corpus** with ground truth (screenshots from several tools, photos) to measure on, not our own renders.
