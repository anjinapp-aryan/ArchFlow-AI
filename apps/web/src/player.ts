import {
  BrowserText,
  EngineHost,
  paintFrame,
  portMarkerKeys,
  REF_PX,
  type EngineFactory,
} from "@archflow/engine-host";
import type { CanonicalDocument } from "@archflow/canonical-model";
import {
  planCamera,
  type Bounds,
  type CameraOptions,
  type CameraPlan,
  type TitleMeasurer,
} from "@archflow/renderer-adapter";
import { aspectKey, cameraFrameBounds } from "./framing.ts";

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
  readonly measureTitle: TitleMeasurer = (label, fontPx, family = "") =>
    (this.text.measure(label, true, family) * fontPx) / REF_PX;

  /** Port markers of the loaded document, hidden when painting (also used by video export). */
  hiddenMarkers: ReadonlySet<string> = new Set();

  load(engineJson: string): { ok: true } | { ok: false; error: string } {
    this.pause();
    const r = this.engine.load(engineJson);
    if (!r.ok) {
      this.durationMs = 0;
      return r;
    }
    this.durationMs = r.info.durationMs;
    this.hiddenMarkers = portMarkerKeys(engineJson);
    this.cameraDoc = undefined;
    this.plan = undefined;
    this.resetView();
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

  // --- automatic camera (shared with video export through cameraFrameBounds) ------------------
  private cameraDoc: CanonicalDocument | undefined;
  private plan: { key: string; plan: CameraPlan } | undefined;
  private auto = true;
  cameraOptions: Partial<CameraOptions> = {};
  /** Called when the automatic camera is switched on or off (also by a manual zoom or pan). */
  onCameraChange: ((on: boolean) => void) | undefined;

  /** The canonical document of the loaded animation: the camera plans from it. */
  setCameraDocument(doc: CanonicalDocument): void {
    this.cameraDoc = doc;
    this.plan = undefined;
    this.requestRender();
  }

  get autoCamera(): boolean {
    return this.auto;
  }
  set autoCamera(on: boolean) {
    if (on === this.auto) return;
    this.auto = on;
    if (on) this.zoom = 1;
    this.onCameraChange?.(on);
    this.requestRender();
  }

  /** Camera plan for a viewport of this size (cached per aspect ratio and content bounds). */
  cameraPlanFor(width: number, height: number): CameraPlan | undefined {
    const info = this.engine.loaded;
    if (!info || !this.cameraDoc) return undefined;
    const key = `${aspectKey(width, height)}|${info.bounds.join(",")}|${JSON.stringify(this.cameraOptions)}`;
    if (this.plan?.key !== key)
      this.plan = {
        key,
        plan: planCamera(
          this.cameraDoc,
          info.bounds,
          width / Math.max(1, height),
          info.durationMs,
          this.cameraOptions,
        ),
      };
    return this.plan.plan;
  }

  /** True when the automatic camera frames this animation (on, and the diagram is large enough). */
  get cameraActive(): boolean {
    const p = this.cameraPlanFor(this.canvas.clientWidth || 16, this.canvas.clientHeight || 9);
    return this.auto && this.zoom <= 1 && p?.enabled === true;
  }

  /** World rectangle shown now: manual zoom, the automatic camera, or the whole diagram. */
  private currentBounds(b: Bounds): Bounds {
    if (this.zoom > 1 || !this.auto) return this.viewBounds(b);
    const p = this.cameraPlanFor(this.canvas.clientWidth || 16, this.canvas.clientHeight || 9);
    return cameraFrameBounds(b, p, this.t);
  }

  // --- view: manual zoom and pan (playback only) ----------------------------------------------
  private zoom = 1;
  private cx = 0;
  private cy = 0;
  static readonly MAX_ZOOM = 8;

  get zoomLevel(): number {
    return this.zoom;
  }

  /** World rectangle shown: the whole diagram at zoom 1, a part of it when zoomed in. */
  private viewBounds(b: [number, number, number, number]): [number, number, number, number] {
    if (this.zoom <= 1) return b;
    const w = b[2] / this.zoom;
    const h = b[3] / this.zoom;
    this.cx = Math.min(b[0] + b[2] - w / 2, Math.max(b[0] + w / 2, this.cx));
    this.cy = Math.min(b[1] + b[3] - h / 2, Math.max(b[1] + h / 2, this.cy));
    return [this.cx - w / 2, this.cy - h / 2, w, h];
  }

  /** Canvas CSS pixel -> world point, for the current view. */
  private toWorld(px: number, py: number): { x: number; y: number } | undefined {
    const info = this.engine.loaded;
    if (!info) return undefined;
    const [bx, by, bw, bh] = this.currentBounds(info.bounds);
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const k = Math.min(cw / bw, ch / bh);
    return { x: bx + (px - (cw - bw * k) / 2) / k, y: by + (py - (ch - bh * k) / 2) / k };
  }

  resetView(): void {
    this.zoom = 1;
    const info = this.engine.loaded;
    if (info) {
      this.cx = info.bounds[0] + info.bounds[2] / 2;
      this.cy = info.bounds[1] + info.bounds[3] / 2;
    }
    this.requestRender();
  }

  /** Zoom by `factor`, keeping the point under the cursor (CSS px; default: centre) fixed. */
  zoomBy(factor: number, px?: number, py?: number): void {
    const info = this.engine.loaded;
    if (!info) return;
    const sx = px ?? this.canvas.clientWidth / 2;
    const sy = py ?? this.canvas.clientHeight / 2;
    this.takeOverFromCamera(info.bounds);
    const before = this.toWorld(sx, sy)!;
    this.zoom = Math.min(Player.MAX_ZOOM, Math.max(1, this.zoom * factor));
    const after = this.toWorld(sx, sy)!;
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.requestRender();
  }

  /** Pan by a drag of (dx, dy) CSS pixels. */
  panBy(dx: number, dy: number): void {
    const info = this.engine.loaded;
    if (info) this.takeOverFromCamera(info.bounds);
    const a = this.toWorld(0, 0);
    const b = this.toWorld(dx, dy);
    if (!a || !b || this.zoom <= 1) return;
    this.cx -= b.x - a.x;
    this.cy -= b.y - a.y;
    this.requestRender();
  }

  /** A manual zoom or pan switches the automatic camera off, starting from what it showed. */
  private takeOverFromCamera(b: Bounds): void {
    if (!this.cameraActive) return;
    const [x, y, w, h] = this.currentBounds(b);
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.zoom = Math.min(Player.MAX_ZOOM, Math.max(1, Math.min(b[2] / w, b[3] / h)));
    this.autoCamera = false;
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
      {
        width: w,
        height: h,
        bounds: this.currentBounds(info.bounds),
        background: info.background || "#0a111f",
        hiddenMarkers: this.hiddenMarkers,
      },
      this.text,
    );
  }
}
