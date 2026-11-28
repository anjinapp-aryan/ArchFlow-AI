import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { paintFrame, type BrowserText, type EngineHost } from "@archflow/engine-host";
import type { CameraPlan, EndingSummary, LabelBoost } from "@archflow/renderer-adapter";
import { cameraFrameBounds, heldNotes, labelScaler } from "./framing.ts";

/**
 * Video export on the user's device. Frames are rendered directly from the engine (no screen
 * recording, no waiting for the display), encoded with WebCodecs and muxed in memory.
 * WebM/VP9 is the default; MP4/H.264 is offered only when the browser has an H.264 encoder.
 */

export type VideoFormat = "webm" | "mp4";

export interface ExportRequest {
  engine: EngineHost;
  text: BrowserText;
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  hiddenMarkers?: ReadonlySet<string>;
  /** Automatic camera planned for this video's aspect ratio (same plan logic as playback). */
  camera?: CameraPlan;
  /** Ending summary held to the last frame (same rule as playback). */
  summary?: EndingSummary;
  /** Adaptive connector labels (same rule as playback; video px are device px). */
  labels?: readonly LabelBoost[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const CODECS: Record<VideoFormat, string[]> = {
  webm: ["vp09.00.40.08", "vp09.00.10.08", "vp8"],
  // level 4.0 first (up to 1080p, unchanged output); level 5.1 for 4K
  mp4: ["avc1.640028", "avc1.4d0028", "avc1.42001f", "avc1.640033"],
};

export const webCodecsAvailable = (): boolean =>
  typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === "function" &&
  typeof (globalThis as { VideoFrame?: unknown }).VideoFrame === "function";

/** First codec the browser can encode at this size, or undefined. */
export async function pickCodec(
  format: VideoFormat,
  width: number,
  height: number,
  fps: number,
): Promise<string | undefined> {
  if (!webCodecsAvailable()) return undefined;
  for (const codec of CODECS[format]) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate: fps,
        bitrate: bitrateFor(width, height),
      });
      if (s.supported) return codec;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

/**
 * Muxer timing for H.264 chunks given in decode order. Some encoders (Firefox) emit B-frames, so
 * presentation timestamps arrive out of order, and their first timestamp can be one frame late.
 * Presentation times are taken relative to the first chunk (the I-frame shown first). Decode
 * times are the sorted presentation times, and every presentation time is delayed just enough
 * that no frame is shown before it is decoded. Without B-frames the result is the input, with
 * zero offsets. The first decode time is 0, as the muxer requires.
 */
export function h264Timing(
  timestamps: readonly number[],
): { timestamp: number; compositionOffset: number }[] {
  if (timestamps.length === 0) return [];
  const base = timestamps[0]!;
  const pts = timestamps.map((t) => t - base);
  const decode = [...pts].sort((a, b) => a - b);
  let delay = 0;
  pts.forEach((t, k) => (delay = Math.max(delay, decode[k]! - t)));
  return pts.map((t, k) => ({
    timestamp: t + delay,
    compositionOffset: t + delay - decode[k]!,
  }));
}

/**
 * Repairs an AVCDecoderConfigurationRecord whose parameter sets repeat their NAL header byte
 * (Firefox 161 writes `67 67 64 …` for an SPS and `68 68 …` for a PPS). The repeated byte
 * makes strict players reject the MP4. A well-formed record is returned unchanged.
 */
export function repairAvcC(record: Uint8Array): Uint8Array {
  if (record.length < 7 || record[0] !== 1) return record;
  const profile = record[1];
  const out: number[] = [...record.subarray(0, 5)];
  let at = 5;
  let fixed = false;
  const copySets = (count: number, nalType: number): boolean => {
    for (let n = 0; n < count; n++) {
      if (at + 2 > record.length) return false;
      const len = (record[at]! << 8) | record[at + 1]!;
      const nal = record.subarray(at + 2, at + 2 + len);
      if (nal.length !== len) return false;
      at += 2 + len;
      const doubled =
        len >= 3 &&
        nal[0] === nal[1] &&
        (nal[0]! & 0x1f) === nalType &&
        (nalType !== 7 || nal[2] === profile) &&
        (nalType !== 8 || fixed);
      const body = doubled ? nal.subarray(1) : nal;
      if (doubled && nalType === 7) fixed = true;
      out.push(body.length >> 8, body.length & 0xff, ...body);
    }
    return true;
  };
  const spsCount = record[5]! & 0x1f;
  out.push(record[5]!);
  at = 6;
  if (!copySets(spsCount, 7) || at >= record.length) return record;
  const ppsCount = record[at]!;
  out.push(ppsCount);
  at += 1;
  if (!copySets(ppsCount, 8)) return record;
  out.push(...record.subarray(at));
  return fixed ? new Uint8Array(out) : record;
}

const bitrateFor = (w: number, h: number): number =>
  Math.round(Math.min(12_000_000, Math.max(2_000_000, w * h * 4)));

function withRepairedAvcC(
  meta: EncodedVideoChunkMetadata | undefined,
): EncodedVideoChunkMetadata | undefined {
  const d = meta?.decoderConfig?.description;
  if (!meta?.decoderConfig || !d) return meta;
  const bytes = ArrayBuffer.isView(d)
    ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
    : new Uint8Array(d);
  const repaired = repairAvcC(bytes);
  return repaired === bytes
    ? meta
    : { ...meta, decoderConfig: { ...meta.decoderConfig, description: repaired } };
}

/** Number of frames an export of `durationMs` at `fps` encodes (both ends included). */
export function exportFrameCount(durationMs: number, fps: number): number {
  return Math.max(1, Math.ceil((durationMs / 1000) * fps) + 1);
}
/** Engine time of export frame `i`: frames are rendered at exact instants, not in real time. */
export function exportFrameTime(i: number, durationMs: number, fps: number): number {
  return Math.min(durationMs, (i * 1000) / fps);
}

export async function exportVideo(req: ExportRequest): Promise<Blob> {
  const { engine, text, format, width, height, fps, signal, onProgress } = req;
  const info = engine.loaded;
  if (!info) throw new Error("Nothing to export: no animation is loaded.");
  const codec = await pickCodec(format, width, height, fps);
  if (!codec)
    throw new Error(
      `This browser cannot encode ${format.toUpperCase()} video at ${width}×${height}.`,
    );

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is not available for export.");

  let muxer: WebmMuxer<WebmTarget> | Mp4Muxer<Mp4Target>;
  let target: WebmTarget | Mp4Target;
  if (format === "webm") {
    target = new WebmTarget();
    muxer = new WebmMuxer({
      target,
      video: { codec: codec.startsWith("vp8") ? "V_VP8" : "V_VP9", width, height, frameRate: fps },
    });
  } else {
    target = new Mp4Target();
    muxer = new Mp4Muxer({
      target,
      video: { codec: "avc", width, height, frameRate: fps },
      fastStart: "in-memory",
    });
  }

  let failure: unknown;
  // H.264 chunks are held until the encoder is flushed, so their timing can be fixed up first
  const held: [EncodedVideoChunk, EncodedVideoChunkMetadata | undefined][] = [];
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      // an error thrown here would be lost, so it fails the export instead
      try {
        if (format === "mp4") held.push([chunk, meta]);
        else (muxer as WebmMuxer<WebmTarget>).addVideoChunk(chunk, meta);
      } catch (e) {
        failure ??= e;
      }
    },
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure({
    codec,
    width,
    height,
    framerate: fps,
    bitrate: bitrateFor(width, height),
    ...(format === "mp4" ? { avc: { format: "avc" as const } } : {}),
  });

  const frameUs = 1_000_000 / fps;
  const total = exportFrameCount(info.durationMs, fps);
  const framing = {
    width,
    height,
    bounds: info.bounds,
    background: info.background || "#0a111f",
    ...(req.hiddenMarkers ? { hiddenMarkers: req.hiddenMarkers } : {}),
  };
  const labelScale = labelScaler(req.labels ?? []);
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      if (failure) throw failure;
      const t = exportFrameTime(i, info.durationMs, fps);
      paintFrame(
        ctx,
        engine.frame(t),
        {
          ...framing,
          bounds: cameraFrameBounds(info.bounds, req.camera, t),
          heldNotes: heldNotes(req.summary, t),
          ...(labelScale ? { labelScale } : {}),
        },
        text,
      );
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameUs),
        duration: Math.round(frameUs),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
      if (i % 5 === 0 || i === total - 1) {
        onProgress?.(i + 1, total);
        await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
      }
    }
    await encoder.flush();
    if (failure) throw failure;
    if (format === "mp4") {
      const timing = h264Timing(held.map(([chunk]) => chunk.timestamp));
      held.forEach(([chunk, meta], k) =>
        (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(
          chunk,
          withRepairedAvcC(meta),
          timing[k]!.timestamp,
          timing[k]!.compositionOffset,
        ),
      );
    }
    muxer.finalize();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  return new Blob([target.buffer!], { type: format === "webm" ? "video/webm" : "video/mp4" });
}

/** Fallback for browsers without WebCodecs: records the canvas in real time (WebM). */
export async function recordRealtime(
  canvas: HTMLCanvasElement,
  durationMs: number,
  restart: () => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function")
    throw new Error("This browser can neither encode nor record video.");
  const stream = canvas.captureStream(30);
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  rec.start(250);
  restart();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, durationMs + 300);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  rec.stop();
  await done;
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  return new Blob(chunks, { type: type ?? "video/webm" });
}
