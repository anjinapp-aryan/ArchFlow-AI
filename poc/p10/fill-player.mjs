// Fills the upstream-built player.html template (placeholders) with a diagram document.
// Mirrors src/Export/HtmlPlayer.cpp (MakePlayerHtml): '<' in JSON -> \u003c, title HTML-escaped.
import { readFileSync, writeFileSync } from "node:fs";
const [, , tpl, doc, out] = process.argv;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const d = JSON.parse(readFileSync(doc, "utf8"));
const json = JSON.stringify(d).replace(/</g, "\u003c");
let html = readFileSync(tpl, "utf8");
for (const [ph, v] of [["{{AD_TITLE}}", esc(d.meta?.name ?? "Animated diagram")], ["{{AD_PLAYER_OPTIONS}}", '{"autoplay":false,"loop":false}'], ["{{AD_DOCUMENT_JSON}}", json]]) {
  if (html.split(ph).length !== 2) throw new Error("placeholder not exactly once: " + ph);
  html = html.replace(ph, () => v);
}
writeFileSync(out, html);
console.log("wrote", out, html.length, "bytes");
