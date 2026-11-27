import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: "shell" });
import { pathToFileURL } from "node:url"; const p = await b.newPage(); await p.goto(pathToFileURL("out/bench-player.html".replace(/^/, process.cwd() + "/")).href);
console.log(JSON.stringify(await p.evaluate(async () => {
  const out = { ua: navigator.userAgent, VideoEncoder: typeof VideoEncoder, MediaRecorder: typeof MediaRecorder };
  for (const [n, c] of [["vp9", "vp09.00.10.08"], ["vp8", "vp8"], ["av1", "av01.0.04M.08"], ["h264", "avc1.42001f"]]) {
    try { out[n] = (await VideoEncoder.isConfigSupported({ codec: c, width: 1280, height: 560 })).supported; } catch (e) { out[n] = "err " + e.message; } }
  return out; })));
await b.close();
