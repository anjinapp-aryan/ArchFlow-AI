import type { DisplayList } from "./host.ts";
import type { MeasureText } from "./engine-module.ts";

/*
 * Canvas painter for the engine's display list.
 *
 * Ported from AnimatedDiagrams v2.2.0 `player/player.js` (drawItems and helpers), MIT licence,
 * Copyright (c) the AnimatedDiagrams authors (see licenses/AnimatedDiagrams-MIT.txt). The
 * decoder mirrors upstream `src/Engine/FrameBuffer.hpp`; keep in sync when the pinned engine
 * revision changes (the pixel-parity test compares this painter with the upstream player).
 * Changes from upstream: TypeScript, no globals, works on any 2D context (including
 * OffscreenCanvas for video export), framing is a parameter.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
]);
/** Text is measured and drawn with a 100 px font scaled to the real size. */
export const REF_PX = 100;

/** Browser text metrics, exactly as the upstream player measures them (the engine lays out with these). */
export class BrowserText {
  private readonly fontCache = new Map<string, string>();
  private readonly widths = new Map<string, number>();
  private readonly xHeights = new Map<string, number>();
  constructor(private readonly measureCtx: Ctx2D) {}

  fontCss(bold: boolean, family: string): string {
    const key = (bold ? "b" : "r") + family;
    let css = this.fontCache.get(key);
    if (!css) {
      let fam = FONT_STACK;
      if (family)
        fam =
          (GENERIC_FAMILIES.has(family) ? family : `"${family.replace(/["\\]/g, "")}"`) +
          ", " +
          FONT_STACK;
      css = `${bold ? "bold " : ""}${REF_PX}px ${fam}`;
      this.fontCache.set(key, css);
    }
    return css;
  }

  readonly measure: MeasureText = (text, bold, family) => {
    const css = this.fontCss(bold, family);
    const key = css + "\u001f" + text;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.measureCtx.font = css;
      w = this.measureCtx.measureText(text).width;
      this.widths.set(key, w);
    }
    return w;
  };

  xHeight(css: string): number {
    let h = this.xHeights.get(css);
    if (h === undefined) {
      this.measureCtx.font = css;
      h = this.measureCtx.measureText("x").actualBoundingBoxAscent || REF_PX * 0.52;
      this.xHeights.set(css, h);
    }
    return h;
  }

  clear(): void {
    this.widths.clear();
    this.xHeights.clear();
  }
}

interface Stroke {
  color: number;
  width: number;
  round: boolean;
  offset: number;
  dash: number[];
}

export interface Framing {
  /** Device pixels of the target. */
  width: number;
  height: number;
  /** World rectangle to fit: x, y, width, height (engine `bounds`). */
  bounds: [number, number, number, number];
  background: string;
}

const colorCache = new Map<number, string>();
function rgba(rgb: number, alpha: number): string {
  const key = rgb + alpha * 0x1000000;
  let s = colorCache.get(key);
  if (!s) {
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    s = alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
    colorCache.set(key, s);
  }
  return s;
}

const decoder = new TextDecoder();

/** Paint one display list, fitted and centred like the upstream player. */
export function paintFrame(
  ctx: Ctx2D,
  list: DisplayList,
  framing: Framing,
  text: BrowserText,
): void {
  const { width: cw, height: ch, bounds } = framing;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = framing.background;
  ctx.fillRect(0, 0, cw, ch);
  const k = Math.min(cw / bounds[2], ch / bounds[3]);
  ctx.setTransform(
    k,
    0,
    0,
    k,
    (cw - bounds[2] * k) / 2 - bounds[0] * k,
    (ch - bounds[3] * k) / 2 - bounds[1] * k,
  );
  if (list.data.length > 0) drawItems(ctx, list, k, text);
}

function drawItems(ctx: Ctx2D, list: DisplayList, deviceScale: number, text: BrowserText): void {
  const data = list.data;
  const strings = list.strings;
  let pos = 0;

  const readPath = (): Path2D => {
    const n = data[pos++]!;
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      switch (data[pos++]) {
        case 0:
          path.moveTo(data[pos]!, data[pos + 1]!);
          pos += 2;
          break;
        case 1:
          path.lineTo(data[pos]!, data[pos + 1]!);
          pos += 2;
          break;
        case 2:
          path.quadraticCurveTo(data[pos]!, data[pos + 1]!, data[pos + 2]!, data[pos + 3]!);
          pos += 4;
          break;
        case 3:
          path.bezierCurveTo(
            data[pos]!,
            data[pos + 1]!,
            data[pos + 2]!,
            data[pos + 3]!,
            data[pos + 4]!,
            data[pos + 5]!,
          );
          pos += 6;
          break;
        default:
          path.closePath();
          break;
      }
    }
    return path;
  };
  const readStroke = (): Stroke => {
    const s: Stroke = {
      color: data[pos++]!,
      width: data[pos++]!,
      round: data[pos++] !== 0,
      offset: data[pos++]!,
      dash: [],
    };
    const n = data[pos++]!;
    for (let i = 0; i < n; i++) s.dash.push(data[pos++]!);
    return s;
  };
  const readString = (): string => {
    const off = data[pos++]!;
    const len = data[pos++]!;
    return len > 0 ? decoder.decode(strings.subarray(off, off + len)) : "";
  };
  // Qt pen semantics: width 0 is a 1 device pixel line, dashes are in pen widths of the base
  // stroke (wider glow passes stretch them).
  const setPen = (s: Stroke, alpha: number, extra: number): void => {
    const base = s.width;
    const w = base + extra;
    ctx.strokeStyle = rgba(s.color, alpha);
    ctx.lineWidth = w > 0 ? w : 1 / deviceScale;
    ctx.lineCap = s.round ? "round" : "butt";
    ctx.lineJoin = "round";
    if (s.dash.length && base > 0) {
      const f = w / base;
      ctx.setLineDash(s.dash.map((d) => Math.max(0.01 * base, d) * f));
      ctx.lineDashOffset = s.offset * f;
    } else ctx.setLineDash([]);
  };
  const strokeSoft = (path: Path2D, color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    ctx.stroke(path);
  };
  const paintPath = (path: Path2D, effect: number, fill: number, stroke: Stroke | null): void => {
    if (effect === 1) {
      ctx.save();
      ctx.translate(0, 3);
      strokeSoft(path, "rgba(0,0,0,0.063)", 7);
      strokeSoft(path, "rgba(0,0,0,0.063)", 4);
      strokeSoft(path, "rgba(0,0,0,0.063)", 1.5);
      if (fill >= 0) {
        ctx.fillStyle = "rgba(0,0,0,0.157)";
        ctx.fill(path, "evenodd");
      }
      ctx.restore();
    } else if (effect === 2) {
      if (stroke) {
        setPen(stroke, 0.12, 8);
        ctx.stroke(path);
        setPen(stroke, 0.22, 4);
        ctx.stroke(path);
      } else if (fill >= 0) {
        strokeSoft(path, rgba(fill, 0.18), 8);
        strokeSoft(path, rgba(fill, 0.18), 4);
      }
    }
    if (fill >= 0) {
      ctx.fillStyle = rgba(fill, 1);
      ctx.fill(path, "evenodd");
    }
    if (stroke) {
      setPen(stroke, 1, 0);
      ctx.stroke(path);
    }
  };
  const roundedRect = (x: number, y: number, w: number, h: number, r: number): Path2D => {
    const p = new Path2D();
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r <= 0) {
      p.rect(x, y, w, h);
      return p;
    }
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.arcTo(x + w, y, x + w, y + r, r);
    p.lineTo(x + w, y + h - r);
    p.arcTo(x + w, y + h, x + w - r, y + h, r);
    p.lineTo(x + r, y + h);
    p.arcTo(x, y + h, x, y + h - r, r);
    p.lineTo(x, y + r);
    p.arcTo(x, y, x + r, y, r);
    p.closePath();
    return p;
  };
  const drawText = (fill: number): void => {
    let x = data[pos++]!;
    let y = data[pos++]!;
    const str = readString();
    const size = data[pos++]!;
    const bold = data[pos++] !== 0;
    const family = readString();
    const align = data[pos++]!;
    const valign = data[pos++]!;
    let halo: { color: number; width: number } | null = null;
    if (data[pos++] !== 0) halo = { color: data[pos++]!, width: data[pos++]! };
    if (!str || size <= 0) return;
    const css = text.fontCss(bold, family);
    const k = size / REF_PX;
    const w = text.measure(str, bold, family) * k;
    if (align === 1) x -= w / 2;
    else if (align === 2) x -= w;
    if (valign === 1) y += (text.xHeight(css) * k) / 2;
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.font = css;
    if (halo) {
      ctx.strokeStyle = rgba(halo.color, 1);
      ctx.lineWidth = halo.width / k;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash([]);
      ctx.strokeText(str, 0, 0);
    }
    ctx.fillStyle = rgba(fill >= 0 ? fill : 0xffffff, 1);
    ctx.fillText(str, 0, 0);
  };

  const count = data[1]!;
  pos = 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (let i = 0; i < count; i++) {
    const tag = data[pos++]!;
    const opacity = data[pos++]!;
    const effect = data[pos++]!;
    const flags = data[pos++]!;
    const fill = flags & 1 ? data[pos++]! : -1;
    const stroke = flags & 2 ? readStroke() : null;
    ctx.save();
    if (flags & 4) {
      const ox = data[pos]!;
      const oy = data[pos + 1]!;
      const rot = data[pos + 2]!;
      const sc = data[pos + 3]!;
      const tx = data[pos + 4]!;
      const ty = data[pos + 5]!;
      pos += 6;
      ctx.translate(ox + tx, oy + ty);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(sc, sc);
      ctx.translate(-ox, -oy);
    }
    if (flags & 8) ctx.clip(readPath());
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
    let p: Path2D;
    switch (tag) {
      case 1:
        p = roundedRect(data[pos]!, data[pos + 1]!, data[pos + 2]!, data[pos + 3]!, data[pos + 4]!);
        pos += 5;
        paintPath(p, effect, fill, stroke);
        break;
      case 2:
        p = new Path2D();
        p.ellipse(
          data[pos]!,
          data[pos + 1]!,
          Math.abs(data[pos + 2]!),
          Math.abs(data[pos + 3]!),
          0,
          0,
          2 * Math.PI,
        );
        pos += 4;
        paintPath(p, effect, fill, stroke);
        break;
      case 3:
        paintPath(readPath(), effect, fill, stroke);
        break;
      case 4: {
        const a0 = (data[pos + 3]! * Math.PI) / 180;
        const sweep = (data[pos + 4]! * Math.PI) / 180;
        p = new Path2D();
        p.arc(data[pos]!, data[pos + 1]!, Math.abs(data[pos + 2]!), a0, a0 + sweep, sweep < 0);
        pos += 5;
        paintPath(p, effect, -1, stroke);
        break;
      }
      case 5:
        drawText(fill);
        break;
      default:
        ctx.restore();
        throw new Error(`unknown display list item ${tag}`);
    }
    ctx.restore();
  }
}
