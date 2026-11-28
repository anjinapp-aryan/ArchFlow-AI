# Export validation report

Every number in this report comes from a real exported file, measured with ffprobe 9.0.1 (Gyan full build). The raw data is in `artifacts/release/export/results.json`, the generated summary is `artifacts/release/export/SUMMARY.md`, and the videos and extracted frames are in `artifacts/release/export/{chrome,edge,chrome-headless}/`.

- Script: `scripts/export-validation.mjs`, run against the frozen build in `artifacts/release/dist-snapshot/`.
- Browsers: Google Chrome 158.0.8127.88 (headed), Microsoft Edge 158.0.4370.45 (headed), and Chrome 158 headless for comparison.
- Firefox 161.0 was checked separately, against the final build. See "Firefox" below.

## Result

**WebM VP9 at 720p and 1080p and 30 fps passes in both headed browsers.**

- 18 exports were made.
- All 18 decode cleanly.
- Every file has exactly the expected number of frames.
- The duration matches the animation.
- The last frame matches the in-app final frame.
- The automatic camera matches playback.

**MP4 (H.264) works in Chrome, Edge and Firefox.** It is offered as "best effort", as designed. In Firefox it failed before this pass; see "Firefox" below.

## WebM and MP4 exports

| Browser | Example | Format | Size | fps | Camera | Frames expected / decoded | Bytes | Render time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome | aws-alb | WebM VP9 | 1280×720 | 30 | auto | 343 / 343 | 663,801 | 0.8 s |
| Chrome | aws-alb | WebM VP9 | 1920×1080 | 30 | auto | 343 / 343 | 1,025,648 | 1.0 s |
| Chrome | bench-text | WebM VP9 | 1280×720 | 30 | auto | 394 / 394 | 1,280,508 | 0.7 s |
| Chrome | bench-text | WebM VP9 | 1920×1080 | 30 | auto | 394 / 394 | 2,098,682 | 1.1 s |
| Chrome | bench-text | WebM VP9 | 1280×720 | 60 | auto | 787 / 787 | 1,664,084 | 1.3 s |
| Chrome | bench-text | WebM VP9 | 1280×720 | 30 | off | 394 / 394 | 609,192 | 0.6 s |
| Chrome | aws-alb | MP4 H.264 | 1280×720 | 30 | auto | 343 / 343 | 495,548 | 0.8 s |
| Chrome | aws-alb | MP4 H.264 | 1920×1080 | 30 | auto | 343 / 343 | 795,808 | 1.1 s |
| Edge | aws-alb | WebM VP9 | 1280×720 | 30 | auto | 343 / 343 | 663,679 | 0.8 s |
| Edge | bench-text | WebM VP9 | 1920×1080 | 30 | auto | 394 / 394 | 2,099,380 | 1.1 s |
| Edge | bench-text | WebM VP9 | 1280×720 | 30 | off | 394 / 394 | 608,968 | 0.7 s |
| Edge | aws-alb | MP4 H.264 | 1280×720 | 30 | auto | 343 / 343 | 495,495 | 1.1 s |
| Edge | aws-alb | MP4 H.264 | 1920×1080 | 30 | auto | 343 / 343 | 795,808 | 1.2 s |
| Chrome headless | 5 further exports | WebM and MP4 | 720p and 1080p | 30 | auto | all exact | see SUMMARY.md | 0.7–1.4 s |

**Streams**

- WebM is VP9 Profile 0, yuv420p.
- MP4 is H.264 High in an `isom` container.
- There is no audio track. The product does not record audio, and the dialog does not offer it.

**Duration**

- aws-alb lasts 11.4 s and bench-text 13.1 s, the same as the in-app timeline.
- The MP4 container reports 1/30 s more (11.433 s) because it counts the last frame's duration. This is cosmetic.

## Camera synchronisation and final frame

- **aws-alb**: the last exported frame, at 720p WebM and at 1080p MP4, matches the in-app canvas at t=11.4 s. Both show the ending note "✓ Success: Client received its response · unhealthy: Order API (traffic routed around it)", with Client in the Success state and Order API shown as unhealthy.
- **bench-text, automatic camera**: the dialog says "Automatic, as in playback (1 close-up)".
  - At t=3.27 s the export is the same close-up of API Gateway, Order Service and Kafka in Chrome at 720p and in Edge at 1080p.
  - At 6.55 s and 9.82 s it shows the overview.
- **bench-text, camera off**: the export shows the whole diagram at every sampled instant. The dialog says "Whole diagram (auto camera off; a manual zoom is not exported)".

## JSON download and re-import

| Browser | Example | Schema | Nodes / edges / events | Re-import errors | Playback after re-import |
| --- | --- | --- | --- | --- | --- |
| Chrome | aws-alb | archflow/canonical@1 | 11 / 12 / 34 | 0 | plays (0.5 s → 1.5 s) |
| Chrome | bench-text | archflow/canonical@1 | 8 / 7 / 23 | 0 | plays |
| Edge | aws-alb | archflow/canonical@1 | 11 / 12 / 34 | 0 | plays |
| Edge | bench-text | archflow/canonical@1 | 8 / 7 / 23 | 0 | plays |

## Download again, cancel, responsiveness and memory

**Download again**

- The second file is byte-identical to the first in both browsers (Chrome 663,801 B, Edge 663,679 B).
- It arrives in about 0.13 s, with no re-render and no progress shown.

**Cancel**

- Chrome shows "Export cancelled." 15 ms after the click, and Edge after 8.5 ms.
- No file is saved, and the Export button is enabled again.

**Responsiveness**

- During a 1080p export the page answers script calls in at most 27 ms (mean 4–7 ms).

**JS heap during a 1080p export**

- It is 4.4–5.9 MB before the export and peaks at 5.7–7.8 MB.
- This metric does not include encoder, GPU or ArrayBuffer memory, so it is a lower bound.

## Encoder support for larger sizes (`VideoEncoder.isConfigSupported`)

| Codec | 3840×2160 | 1080×1920 |
| --- | --- | --- |
| VP9 (`vp09.00.40.08`, `vp09.00.10.08`) | yes (software only) | yes (software only) |
| H.264 High 4.0 (`avc1.640028`) | **no** | yes |
| H.264 High 5.1 (`avc1.640033`) | yes (hardware and software) | yes |

The results are the same in Chrome, Edge and Chrome headless.

`avc1.640033` was added to the end of the MP4 codec list in `apps/web/src/export.ts`, so a 4K MP4 can be offered. Exports at 1080p and below still pick level 4.0, so their output is unchanged.

## 4K and vertical presets

Both presets were added in this pass as new size options. They were measured with `node scripts/export-presets-check.mjs --headed` in headed Chrome 158.0.8127.88 and Edge 158.0.4370.45, against the final build. The raw data is in `artifacts/release/export/presets/results.json`.

| Browser | Example | Size | Format | Frames expected / decoded | Bytes | Wall time (click to "Saved") | JS heap before → peak |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome | aws-alb | 3840×2160 | WebM VP9 | 343 / 343 | 2,436,896 | 3.9 s | 6.0 → 6.0 MB |
| Chrome | aws-alb | 3840×2160 | MP4 H.264 High 5.1 | 343 / 343 | 1,733,064 | 3.0 s | 6.3 → 6.3 MB |
| Chrome | bench-text | 3840×2160 | WebM VP9 | 394 / 394 | 4,483,067 | 4.4 s | 5.4 → 6.0 MB |
| Chrome | aws-alb | 1080×1920 | WebM VP9 | 343 / 343 | 556,532 | 1.1 s | 4.6 → 6.0 MB |
| Chrome | aws-alb | 1080×1920 | MP4 H.264 | 343 / 343 | 453,937 | 1.2 s | 5.7 → 5.9 MB |
| Chrome | bench-text | 1080×1920 | WebM VP9 | 394 / 394 | 1,461,421 | 1.4 s | 6.8 → 7.6 MB |
| Edge | aws-alb | 3840×2160 | WebM VP9 | 343 / 343 | 2,437,385 | 3.9 s | 5.8 → 5.8 MB |
| Edge | aws-alb | 3840×2160 | MP4 H.264 | 343 / 343 | 1,732,708 | 3.0 s | 4.9 → 5.9 MB |
| Edge | bench-text | 3840×2160 | WebM VP9 | 394 / 394 | 4,485,398 | 4.4 s | 5.2 → 6.0 MB |
| Edge | aws-alb | 1080×1920 | WebM VP9 | 343 / 343 | 556,532 | 1.1 s | 5.2 → 5.6 MB |
| Edge | aws-alb | 1080×1920 | MP4 H.264 | 343 / 343 | 453,694 | 1.2 s | 5.7 → 6.0 MB |
| Edge | bench-text | 1080×1920 | WebM VP9 | 394 / 394 | 1,458,811 | 1.4 s | 5.5 → 6.4 MB |

All 12 exports decode with the exact frame count. ffprobe confirms the 4K MP4 is H.264 High at level 5.1 (`avc1.640033`).

**Decision: both presets are kept.**

- **4K:** the render takes 3–4.4 s, at most 4.5 MB, with no growth in the JS heap. That is reasonable on a desktop, and the option is labelled "4K, slower".
- **Bitrate:** the agent noted the 12 Mbps bitrate cap at 4K. The measured files average 1.6–2.7 Mbit/s, far below the cap, so the cap does not soften these diagrams.
- **Vertical 1080×1920:**
  - It is fast and small.
  - The extracted frames show that a wide diagram is letterboxed into the portrait frame, so its text is small. During a camera close-up the diagram fills the frame well (`bench-text` at 3.27 s).
  - The option is labelled "1080 × 1920 (vertical · wide diagrams look small)" so the trade-off is visible before exporting.
- **Evidence frames:** `artifacts/release/export/presets/chrome/{aws-alb_3840x2160_last.png, aws-alb_1080x1920_last.png, bench-text_1080x1920_t3.png}`.
- **Measurement limits:**
  - These were measured on one Windows 11 desktop.
  - Slower or memory-constrained devices were not tested.
  - The JS heap figure excludes encoder and GPU memory.

## Firefox

Firefox 161.0 (headed, WebDriver BiDi) was checked against the final build with a scratch script. The script captured each saved file from the page, so nothing went to the Downloads folder. The files are in `artifacts/release/export/firefox/`, with the raw data in `results.json` there.

`VideoEncoder.isConfigSupported` reports VP9 and H.264 (`avc1.640028`, `avc1.42001f`, `avc1.640033`) as supported at 1280×720, 1920×1080 and 3840×2160.

| Example | Format | Size | Frames expected / decoded | Bytes | Duration | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| aws-alb | WebM VP9 | 1280×720, 30 fps | 343 / 343 | 321,831 | 11.400 s | 5.6 s |
| bench-text | WebM VP9 | 1920×1080, 30 fps | 394 / 394 | 1,211,404 | 13.100 s | 8.4 s |
| aws-alb | MP4 H.264 High | 1280×720, 30 fps | 343 / 343 | 643,505 | 11.433 s | 1.3 s |

- Firefox renders WebM about 5–8 times slower than Chrome (5.6 s against 0.8 s at 720p). That is still well under the animation length.
- The last frames match the in-app final frame, as in Chrome.
- `ffmpeg -v warning` decodes the Firefox MP4 with no warnings.

**Two Firefox MP4 defects were found and fixed** in `apps/web/src/export.ts`:

1. **Export failed** with `can't access property "colorSpace", t.info.decoderConfig is null`.
   - Firefox's H.264 encoder emits B-frames, so chunks arrive out of presentation order. Every timestamp is also one frame late: the first chunk reports 33,333 µs, not 0.
   - mp4-muxer threw "The first chunk for your media track must have a timestamp of 0" inside the encoder's output callback. The browser swallowed that error, and the muxer then failed at the end with the misleading message above.
   - Fix: H.264 chunks are held until the encoder is flushed. `h264Timing` then gives each one a decode time and a composition offset, so B-frames are muxed correctly (`ctts` box). Errors thrown in the output callback now fail the export with their real message.
   - Firefox MP4 files start at 1/30 s (`start_time=0.033`), because one frame of B-frame delay is needed. Every frame is present.
2. **Malformed decoder record.** Firefox writes the SPS and PPS in the `avcC` record with their NAL header byte repeated (`67 67 64 …`, `68 68 …`). ffmpeg recovered from the in-band parameter sets but printed "crop values invalid" and "sps_id 1 out of range". Strict players could reject the file.
   - Fix: `repairAvcC` removes the repeated byte. A well-formed record is returned unchanged.

**Chrome and Edge output is unchanged by these fixes.** A re-export after the fix (`artifacts/release/export/mp4-recheck/`) was compared with the earlier export:

- **Chrome 1920×1080 MP4:**
  - The `ffmpeg -f framemd5` packet hashes and timestamps are identical.
  - The files differ only in 12 bytes, which are the creation times in the header boxes.
- **Chrome and Edge 1280×720 MP4:**
  - 343/343 frames, no `ctts` box, start time 0 and no decoder warnings.
  - The packets differ slightly from the earlier run. They already differed between Chrome and Edge before the fix (495,548 B against 495,495 B), so the 720p encoder is not bit-exact between runs.

The two helpers have unit tests in `apps/web/test/export-timing.test.ts`, including the exact `avcC` bytes Firefox produced.

## Defects found

| Severity | Defect | Status |
| --- | --- | --- |
| High | MP4 export failed in Firefox: B-frames and a late first timestamp, with the real error swallowed | Fixed (`h264Timing`; output errors now reported) |
| Medium | Firefox's MP4 decoder record repeats the NAL header byte | Fixed (`repairAvcC`) |
| Low | Firefox writes H.264 level 3.1 even at 1080p, where level 4.0 is correct. ffmpeg decodes it. | Open. This is the Firefox encoder's choice. |
| Medium | MP4 at 3840×2160 was impossible because the codec list held only level 4.x profiles | Fixed (`avc1.640033` added) |
| Low | MP4 is tagged full range (yuvj420p) and WebM limited range (yuv420p). No visible difference was found, but players that ignore the flag may differ slightly. | Open. This is the browser encoder's default. |
| Low | In bench-text at t=6.55 s, the "1s" timeout ring and its caption overlap the "Consumer 1" title. This appears in playback and in export alike. | Open. It is in the engine and painter, which are pinned and out of scope. |
| Cosmetic | The MP4 container reports a duration 1/30 s longer than the WebM | Accepted |

No console errors were seen in any browser during the exports.
