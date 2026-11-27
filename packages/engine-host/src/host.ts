import type { EngineFactory, EngineModule, MeasureText } from "./engine-module.ts";

export interface LoadedDocument {
  durationMs: number;
  background: string;
  /** x, y, width, height of the content. */
  bounds: [number, number, number, number];
}
export type LoadResult = { ok: true; info: LoadedDocument } | { ok: false; error: string };

/** A copy of the engine's flat display list for one instant (see upstream FrameBuffer.hpp). */
export interface DisplayList {
  /** Float64 values; first two are format version and item count. */
  data: Float64Array;
  /** UTF-8 string blob referenced by text items. */
  strings: Uint8Array;
}

/**
 * Thin, deterministic wrapper around the engine WebAssembly module.
 *
 * - One document at a time (the engine keeps global state).
 * - Never evaluates anything: the document is passed as a JSON string.
 * - `frame(t)` returns copies, so callers may keep them across later calls
 *   (the engine reuses its buffers and WASM memory can move on growth).
 */
export class EngineHost {
  private info: LoadedDocument | undefined;
  private constructor(private readonly m: EngineModule) {}

  static async create(factory: EngineFactory, measureText: MeasureText): Promise<EngineHost> {
    const m = await factory({ adMeasureText: measureText });
    return new EngineHost(m);
  }

  load(documentJson: string): LoadResult {
    const m = this.m;
    const size = m.lengthBytesUTF8(documentJson) + 1;
    const ptr = m._malloc(size);
    m.stringToUTF8(documentJson, ptr, size);
    const ok = m._ad_player_load(ptr, size - 1);
    m._free(ptr);
    if (!ok) {
      this.info = undefined;
      return { ok: false, error: m.UTF8ToString(m._ad_player_error()) };
    }
    this.info = {
      durationMs: m._ad_player_duration(),
      background: m.UTF8ToString(m._ad_player_background()),
      bounds: [0, 1, 2, 3].map((i) => m._ad_player_bounds(i)) as [number, number, number, number],
    };
    return { ok: true, info: this.info };
  }

  /** Call when web fonts finish loading: the engine re-measures text and bounds may change. */
  fontsChanged(): void {
    if (!this.info) return;
    this.m._ad_player_fonts_changed();
    this.info = {
      ...this.info,
      bounds: [0, 1, 2, 3].map((i) => this.m._ad_player_bounds(i)) as [
        number,
        number,
        number,
        number,
      ],
    };
  }

  get loaded(): LoadedDocument | undefined {
    return this.info;
  }

  frame(tMs: number): DisplayList {
    if (!this.info) throw new Error("EngineHost.frame called before a successful load()");
    const m = this.m;
    const t = Math.min(Math.max(0, tMs), this.info.durationMs);
    const n = m._ad_player_build(t);
    const data = new Float64Array(m.HEAPF64.buffer, m._ad_player_frame(), n).slice();
    const sp = m._ad_player_strings();
    const strings = m.HEAPU8.slice(sp, sp + m._ad_player_strings_size());
    return { data, strings };
  }
}
