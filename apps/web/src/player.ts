import {
  BrowserText,
  EngineHost,
  paintFrame,
  REF_PX,
  type EngineFactory,
} from "@archflow/engine-host";
import type { TitleMeasurer } from "@archflow/renderer-adapter";

/**
 * Interactive player: our own clock drives the WASM engine and our painter draws each frame,
 * so play / pause / seek / step / speed are exact and export can render frames without
 * waiting for the screen.
 */
export class Player {
  private t = 0;
  private playing = false;
  private lastTs = 0;
  private raf = 0;
  speed = 1;
  loop = true;
  durationMs = 0;
  onChange: (() => void) | undefined;

  private constructor(
    readonly engine: EngineHost,
    readonly text: BrowserText,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const redraw = (): void => this.requestRender();
    new ResizeObserver(redraw).observe(canvas);
    window.addEventListener("resize", redraw);
    document.fonts?.addEventListener?.("loadingdone", () => {
      this.text.clear();
      this.engine.fontsChanged();
      this.requestRender();
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<Player> {
    const factory = (globalThis as unknown as { AdPlayerEngine?: EngineFactory }).AdPlayerEngine;
    if (typeof factory !== "function") throw new Error("The animation engine failed to load.");
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) throw new Error("Canvas 2D is not available in this browser.");
    const text = new BrowserText(measure);
    const engine = await EngineHost.create(factory, text.measure);
    return new Player(engine, text, canvas);
  }

  /** Bold title width at `fontPx`, measured exactly as the painter draws titles. */
  readonly measureTitle: TitleMeasurer = (label, fontPx) =>
    (this.text.measure(label, true, "") * fontPx) / REF_PX;

  load(engineJson: string): { ok: true } | { ok: false; error: string } {
    this.pause();
    const r = this.engine.load(engineJson);
    if (!r.ok) {
      this.durationMs = 0;
      return r;
    }
    this.durationMs = r.info.durationMs;
    this.t = 0;
    this.requestRender();
    return { ok: true };
  }

  get time(): number {
    return this.t;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.engine.loaded) return;
    if (this.t >= this.durationMs) this.t = 0;
    this.playing = true;
    this.lastTs = 0;
    this.requestRender();
  }
  pause(): void {
    this.playing = false;
    this.requestRender();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
  seek(ms: number): void {
    this.t = Math.min(this.durationMs, Math.max(0, ms));
    this.lastTs = 0;
    this.requestRender();
  }
  step(deltaMs: number): void {
    this.pause();
    this.seek(this.t + deltaMs);
  }

  private requestRender(): void {
    if (!this.raf) this.raf = requestAnimationFrame((ts) => this.frame(ts));
  }

  private frame(ts: number): void {
    this.raf = 0;
    if (this.playing) {
      const dt = this.lastTs ? Math.min(250, ts - this.lastTs) : 0;
      this.lastTs = ts;
      this.t += dt * this.speed;
      if (this.t >= this.durationMs) {
        if (this.loop) this.t = this.durationMs > 0 ? this.t % this.durationMs : 0;
        else {
          this.t = this.durationMs;
          this.playing = false;
        }
      }
    }
    this.render();
    this.onChange?.();
    if (this.playing) this.requestRender();
  }

  render(): void {
    const info = this.engine.loaded;
    const ctx = this.canvas.getContext("2d");
    if (!info || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    paintFrame(
      ctx,
      this.engine.frame(this.t),
      { width: w, height: h, bounds: info.bounds, background: info.background || "#0a111f" },
      this.text,
    );
  }
}
