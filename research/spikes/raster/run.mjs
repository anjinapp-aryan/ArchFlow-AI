// P1.7 raster import feasibility spike (research only, never shipped).
//
// Ground truth: the generated draw.io corpus diagrams, rendered to 1280x720 PNG by ArchFlow's
// own painter (exact node rectangles known). Measured:
//   1. OCR label recall      - tesseract.js 7 (Apache-2.0) with eng LSTM data (Apache-2.0)
//   2. component detection   - uniform-colour region growing (no ML)
//   3. connector detection   - straight-segment ink sampling between detected components
//   4. arrow direction       - not attempted (reported as 0)
// Synthetic renders are the EASIEST possible raster input (clean, flat colours, no JPEG
// artefacts, known fonts). Real screenshots/photos will score lower.
//
// Run: node research/spikes/raster/run.mjs   (needs `npm run engine:build`, `npm run build`,
// `npm run demos` for the pipeline bundle, Chrome, and network for the OCR language data)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorker } from "tesseract.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const req = createRequire(join(root, "package.json"));
const puppeteer = req("puppeteer-core");
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const { importDiagram, toEngineDocument, serializeEngineDocument } = await import(
  pathToFileURL(join(root, "artifacts", "demos", ".pipeline.mjs")).href
);
const corpusDir = join(root, "fixtures", "diagrams");
const ids = ["01-linear", "02-branching", "03-parallel-consumers", "04-multiple-connectors", "05-bidirectional", "06-nested-groups", "07-labeled-connectors", "08-dashed-curved", "09-ambiguous-direction", "10-order-flow"];

const engineJs = readFileSync(join(root, "build", "engine", "ad_player_engine.js"), "utf8");
const hostJs = readFileSync(join(root, "packages", "engine-host", "dist", "engine-host.iife.js"), "utf8");
const chrome = process.env.CHROME_EXE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--force-color-profile=srgb"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
await page.addScriptTag({ content: engineJs });
await page.addScriptTag({ content: hostJs });

const W = 1280;
const H = 720;
const rows = [];
const worker = await createWorker("eng");
for (const id of ids) {
  const truth = JSON.parse(readFileSync(join(corpusDir, `${id}.truth.json`), "utf8"));
  const imp = await importDiagram(readFileSync(join(corpusDir, `${id}.drawio`), "utf8"), "drawio");
  if (!imp.ok) throw new Error(id);
  const doc = { ...imp.document, scenario: { id: "s", durationMs: 1000, flows: [], events: [] } };
  const a = toEngineDocument(doc, { groups: "flatten" });
  if (!a.ok) throw new Error(id);
  const r = await page.evaluate(
    async (json, W, H) => {
      const Hh = globalThis.ArchFlowEngineHost;
      const text = new Hh.BrowserText(document.createElement("canvas").getContext("2d"));
      const host = await Hh.EngineHost.create(globalThis.AdPlayerEngine, text.measure);
      host.load(json);
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const b = host.loaded.bounds;
      Hh.paintFrame(ctx, host.frame(0), { width: W, height: H, bounds: b, background: "#0a111f" }, text);
      const k = Math.min(W / b[2], H / b[3]);
      const map = { k, ox: (W - b[2] * k) / 2 - b[0] * k, oy: (H - b[3] * k) / 2 - b[1] * k };
      // ---- component detection: uniform-colour region growing ----
      const d = ctx.getImageData(0, 0, W, H).data;
      const seen = new Uint8Array(W * H);
      const bg = [d[0], d[1], d[2]];
      const same = (i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) <= 12;
      const boxes = [];
      for (let p = 0; p < W * H; p++) {
        if (seen[p]) continue;
        const i0 = p * 4;
        const col = [d[i0], d[i0 + 1], d[i0 + 2]];
        if (same(i0, bg)) {
          seen[p] = 1;
          continue;
        }
        const stack = [p];
        seen[p] = 1;
        let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
        while (stack.length) {
          const q = stack.pop();
          n++;
          const x = q % W, y = (q / W) | 0;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          for (const nb of [q - 1, q + 1, q - W, q + W]) {
            if (nb < 0 || nb >= W * H || seen[nb]) continue;
            if (Math.abs((nb % W) - x) > 1) continue;
            if (same(nb * 4, col)) {
              seen[nb] = 1;
              stack.push(nb);
            }
          }
        }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        if (n >= 900 && bw >= 30 && bh >= 18 && n / (bw * bh) >= 0.55) boxes.push({ x: x0, y: y0, w: bw, h: bh });
      }
      // ---- connector detection: ink along the straight segment between box borders ----
      const ink = (x, y) => {
        const i = (Math.round(y) * W + Math.round(x)) * 4;
        return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40;
      };
      const inBox = (x, y, pad) => boxes.some((bx) => x >= bx.x - pad && x <= bx.x + bx.w + pad && y >= bx.y - pad && y <= bx.y + bx.h + pad);
      const links = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const A = boxes[i], B = boxes[j];
          const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
          let total = 0, hit = 0;
          for (let s = 0; s <= 200; s++) {
            const x = ax + ((bx - ax) * s) / 200, y = ay + ((by - ay) * s) / 200;
            if (inBox(x, y, 4)) continue;
            total++;
            let any = false;
            for (let dx = -2; dx <= 2 && !any; dx++) for (let dy = -2; dy <= 2 && !any; dy++) any = ink(x + dx, y + dy);
            if (any) hit++;
          }
          if (total >= 8 && hit / total >= 0.85) links.push([i, j]);
        }
      // OCR preprocessing (standard): invert to dark-on-light, grayscale, contrast, 2x upscale
      const o = document.createElement("canvas");
      o.width = W * 2;
      o.height = H * 2;
      const octx = o.getContext("2d");
      octx.filter = "invert(1) grayscale(1) contrast(1.6)";
      octx.imageSmoothingQuality = "high";
      octx.drawImage(c, 0, 0, W * 2, H * 2);
      return { png: c.toDataURL("image/png").split(",")[1], ocrPng: o.toDataURL("image/png").split(",")[1], boxes, links, map };
    },
    serializeEngineDocument(a.document),
    W,
    H,
  );
  const png = Buffer.from(r.png, "base64");
  writeFileSync(join(out, `${id}.png`), png);
  const ocrPng = Buffer.from(r.ocrPng, "base64");
  writeFileSync(join(out, `${id}.ocr.png`), ocrPng);
  const ocr = await worker.recognize(ocrPng);
  const words = ocr.data.text.toLowerCase();
  const { k, ox, oy } = r.map;
  const px = (n) => ({ x: n.x * k + ox, y: n.y * k + oy, w: n.w * k, h: n.h * k });
  const iou = (p, q) => {
    const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
    const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
    const inter = ix * iy;
    return inter / (p.w * p.h + q.w * q.h - inter);
  };
  // match truth nodes to detected boxes (best IoU >= 0.5)
  const match = new Map();
  for (const n of truth.nodes) {
    const t = px(n);
    let best = -1, bi = -1;
    r.boxes.forEach((b, i) => {
      const v = iou(t, b);
      if (v > best && ![...match.values()].includes(i)) [best, bi] = [v, i];
    });
    if (best >= 0.5) match.set(n.key, bi);
  }
  const labelHits = truth.nodes.filter((n) => n.label.toLowerCase().split(/\s+/).every((w) => words.includes(w))).length;
  const truthPairs = new Set(truth.edges.map((e) => [e.from, e.to].sort().join("|")));
  const boxToKey = new Map([...match].map(([key, i]) => [i, key]));
  const found = r.links.map(([i, j]) => [boxToKey.get(i), boxToKey.get(j)]);
  const foundPairs = new Set(found.filter(([p, q]) => p && q).map(([p, q]) => [p, q].sort().join("|")));
  const correctEdges = [...foundPairs].filter((p) => truthPairs.has(p)).length;
  const fullyRecovered = truth.edges.filter((e) => {
    const key = [e.from, e.to].sort().join("|");
    const lab = (n) => truth.nodes.find((x) => x.key === n).label.toLowerCase().split(/\s+/).every((w) => words.includes(w));
    return foundPairs.has(key) && lab(e.from) && lab(e.to);
  }).length;
  rows.push({
    id,
    nodes: truth.nodes.length,
    labelsRead: labelHits,
    detectedBoxes: r.boxes.length,
    boxesMatched: match.size,
    edges: truth.edges.length,
    linksFound: r.links.length,
    linksCorrect: correctEdges,
    edgesFullyRecovered: fullyRecovered,
    directionsRecovered: 0,
    ocrConfidence: Math.round(ocr.data.confidence),
  });
  console.log(JSON.stringify(rows.at(-1)));
}
await worker.terminate();
await browser.close();
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
const totals = {
  diagrams: rows.length,
  labelRecall: `${sum("labelsRead")}/${sum("nodes")}`,
  componentRecall: `${sum("boxesMatched")}/${sum("nodes")}`,
  componentPrecision: `${sum("boxesMatched")}/${sum("detectedBoxes")}`,
  connectorRecall: `${sum("linksCorrect")}/${sum("edges")}`,
  connectorPrecision: `${sum("linksCorrect")}/${sum("linksFound")}`,
  edgesWithBothLabelsAndLink: `${sum("edgesFullyRecovered")}/${sum("edges")}`,
  directions: `0/${sum("edges")}`,
};
writeFileSync(join(out, "results.json"), JSON.stringify({ totals, rows }, null, 2) + "\n");
console.log(JSON.stringify(totals, null, 2));
