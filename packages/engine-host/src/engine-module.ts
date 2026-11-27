/**
 * Minimal typing of the Emscripten module exported by the pinned engine build
 * (research/upstream/AnimatedDiagrams/player/Player.cpp, `ad_player_*` exports).
 * Only what ArchFlow uses is declared.
 */
export interface EngineModule {
  HEAPU8: Uint8Array;
  HEAPF64: Float64Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  lengthBytesUTF8(s: string): number;
  stringToUTF8(s: string, ptr: number, max: number): void;
  UTF8ToString(ptr: number): string;
  _ad_player_load(ptr: number, size: number): number;
  _ad_player_error(): number;
  _ad_player_duration(): number;
  _ad_player_background(): number;
  /** i: 0 = x, 1 = y, 2 = width, 3 = height of the content bounds. */
  _ad_player_bounds(i: number): number;
  _ad_player_fonts_changed(): void;
  /** Build the display list for time t (ms); returns the number of doubles. */
  _ad_player_build(t: number): number;
  _ad_player_frame(): number;
  _ad_player_strings(): number;
  _ad_player_strings_size(): number;
}

/** Text measurement callback the engine asks for (width of `text` at a 100 px font). */
export type MeasureText = (text: string, bold: boolean, family: string) => number;

/** The `AdPlayerEngine` factory (Emscripten MODULARIZE) defined by ad_player_engine.js. */
export type EngineFactory = (options: { adMeasureText: MeasureText }) => Promise<EngineModule>;
