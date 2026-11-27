/**
 * Fill the upstream player template (built from source) with an engine document.
 * Mirrors upstream `src/Export/HtmlPlayer.cpp` (MakePlayerHtml): every `<` inside the JSON
 * becomes `\u003c` so the document can never close its <script> element; the title is
 * HTML-escaped. Each placeholder must occur exactly once.
 */
const TITLE = "{{AD_TITLE}}";
const OPTIONS = "{{AD_PLAYER_OPTIONS}}";
const DOCUMENT = "{{AD_DOCUMENT_JSON}}";

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export interface PlayerOptions {
  autoplay: boolean;
  loop: boolean;
}

export function fillPlayerTemplate(
  template: string,
  documentJson: string,
  title: string,
  options: PlayerOptions = { autoplay: false, loop: false },
): string {
  const values: [string, string][] = [
    [TITLE, escapeHtml(title || "Animated diagram")],
    [OPTIONS, JSON.stringify({ autoplay: options.autoplay, loop: options.loop })],
    [DOCUMENT, documentJson.replace(/</g, "\u003c")],
  ];
  let html = template;
  for (const [placeholder, value] of values) {
    const first = html.indexOf(placeholder);
    if (first < 0 || html.indexOf(placeholder, first + 1) >= 0)
      throw new Error(`not an HTML player template: ${placeholder} must occur exactly once`);
    html = html.slice(0, first) + value + html.slice(first + placeholder.length);
  }
  return html;
}
