/**
 * Deterministic text-width estimate (pixels at ~14 px regular sans-serif).
 *
 * Shared by the importers' auto-layout and the renderer adapter's title fitting, so both agree.
 * It deliberately does not measure real glyphs: layout must be identical on every machine.
 */
export function estimateTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x2e80) w += 14;
    else if (ch === " ") w += 4;
    else if (/[MW@%]/.test(ch)) w += 12;
    else if (/[A-Z]/.test(ch)) w += 9;
    else if (/[il.,:;'|!]/.test(ch)) w += 4;
    else w += 7.5;
  }
  return w;
}

/** The engine draws node titles in BOLD 15 px; ×1.12 converts the estimate with a safety margin. */
export const TITLE_FONT_PX = 15;
export const titleWidth = (label: string, fontPx = TITLE_FONT_PX): number =>
  estimateTextWidth(label) * 1.12 * (fontPx / TITLE_FONT_PX);

/**
 * Horizontal room the engine leaves for a node title (pinned AnimatedDiagrams v2.2.0,
 * Engine/Scene.cpp): boxes start the title after the icon column (x + 41 px) and need right
 * padding; ellipse (user), diamond (decision) and cloud shapes centre it inside a narrowing outline.
 */
export function titleRoom(kind: string | undefined, w: number): number {
  if (kind === "user") return w * 0.8 - 28 * 0.8;
  if (kind === "decision") return (w - 28) / 1.7;
  if (kind === "cloud") return (w - 44) / 1.3;
  return w - 50;
}
