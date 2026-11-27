// P1.0 proof of concept: browser-side deterministic WebM export of the WASM-engine player.
// Steps the player to exact times via its documented postMessage API, grabs the <canvas>,
// encodes with WebCodecs (VP9) and muxes with webm-muxer (MIT). Run in headless Chrome here;
// the same page code runs in any WebCodecs-capable browser (no server).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
const [, , html, out, fpsArg, durArg] = process.argv;
const fps = Number(fpsArg ?? 30), durMs = Number(durArg ?? 16000);
const exe = process.env.CHROME_EXE;
const muxerSrc = readFileSync(new URL("./node_modules/webm-muxer/build/webm-muxer.js", import.meta.url), "utf8");
const b = await puppeteer.launch({ executablePath: exe, headless: "shell", args: ["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 560, deviceScaleFactor: 1 });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(html.startsWith("http") ? html : pathToFileURL(html).href); await new Promise((r) => setTimeout(r, 800));
await p.addScriptTag({ content: muxerSrc });
const t0 = Date.now();
const res = await p.evaluate(async (fps, durMs) => {
  const canvas = document.querySelector("canvas.ad-canvas");
  const W = canvas.width & ~1, H = canvas.height & ~1;
  const supp = await VideoEncoder.isConfigSupported({ codec: "vp09.00.10.08", width: W, height: H });
  if (!supp.supported) return { error: "VP9 not supported" };
  const muxer = new WebMMuxer.Muxer({ target: new WebMMuxer.ArrayBufferTarget(), video: { codec: "V_VP9", width: W, height: H, frameRate: fps } });
  let encErr = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encErr = String(e)) });
  enc.configure({ codec: "vp09.00.10.08", width: W, height: H, bitrate: 2_000_000, framerate: fps });
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const n = Math.round((durMs / 1000) * fps);
  const hashes = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.round((i * 1000) / fps);
    window.postMessage({ type: "ad-player", action: "seek", time: t }, "*");
    await raf(); await raf();
    if (i % 60 === 0) { const d = canvas.getContext("2d").getImageData(0, 0, W, H).data; let h = 2166136261; for (let k = 0; k < d.length; k += 97) h = Math.imul(h ^ d[k], 16777619); hashes.push(h >>> 0); }
    const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps) });
    enc.encode(f, { keyFrame: i % 30 === 0 }); f.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
  }
  await enc.flush(); muxer.finalize();
  const buf = muxer.target.buffer; let s = ""; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return { b64: btoa(s), frames: n + 1, W, H, hashes, encErr, heap: performance.memory ? performance.memory.usedJSHeapSize : null };
}, fps, durMs);
if (res.error || res.encErr) { console.error("FAIL", res); process.exit(1); }
writeFileSync(out, Buffer.from(res.b64, "base64"));
console.log(JSON.stringify({ out, frames: res.frames, size: `${res.W}x${res.H}`, bytes: Buffer.from(res.b64, "base64").length, ms: Date.now() - t0, hashes: res.hashes.join(","), heapMB: res.heap && Math.round(res.heap / 1e6), pageErrors: errs }));
await b.close();
