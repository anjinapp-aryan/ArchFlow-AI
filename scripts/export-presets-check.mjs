#!/usr/bin/env node
// Measures the large export presets (4K landscape, 1080x1920 vertical) in installed browsers:
// render time, file size, decoded frame count and JS heap, so the presets are offered only
// with measured evidence. Serves apps/web/dist (run `npm run web:build` first).
//
//   node scripts/export-presets-check.mjs [--headed]
//
// Writes artifacts/release/export/presets/results.json and the downloaded videos.
/* global document, setTimeout -- used inside page callbacks */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "./serve-web.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "artifacts", "release", "export", "presets");
const headed = process.argv.includes("--headed");
const BROWSERS = {
  chrome: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  edge: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
};
const FFPROBE =
  process.env.FFPROBE ??
  `${process.env.LOCALAPPDATA}/Microsoft/WinGet/Packages/Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build-shared/bin/ffprobe.exe`;
const CASES = [
  ["aws-alb", "3840x2160", "webm"],
  ["aws-alb", "3840x2160", "mp4"],
  ["bench-text", "3840x2160", "webm"],
  ["aws-alb", "1080x1920", "webm"],
  ["aws-alb", "1080x1920", "mp4"],
  ["bench-text", "1080x1920", "webm"],
];

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
for (const [name, exe] of Object.entries(BROWSERS)) {
  if (!existsSync(exe)) continue;
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: exe, headless: !headed });
  const version = await browser.version();
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
  await cdp.send("Performance.enable");
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#placeholder")?.hidden, {
    timeout: 30_000,
  });
  if (await page.$eval("#welcome", (e) => !e.hidden)) await page.click("#welcome-close");
  for (const [example, size, format] of CASES) {
    await page.select("#examples", example);
    await page.waitForFunction(() => !document.querySelector("#animate").disabled);
    await sleep(300);
    if (!(await page.$eval("#export-dialog", (d) => d.open))) await page.click("#open-export");
    await page.select("#size", size);
    await sleep(300); // format support is re-checked for the new size
    const option = await page.$eval(`#format option[value="${format}"]`, (o) => ({
      disabled: o.disabled,
      text: o.textContent,
    }));
    const row = { browser: name, version, example, size, format, option };
    if (option.disabled) {
      results.push({ ...row, exported: false });
      console.log(`[presets] ${name} ${example} ${size} ${format}: not offered (${option.text})`);
      continue;
    }
    await page.select("#format", format);
    const before = readdirSync(dir);
    const heap = async () =>
      (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize")
        .value;
    const heap0 = await heap();
    let peak = heap0;
    const t0 = Date.now();
    await page.click("#export");
    let msg = "";
    while (Date.now() - t0 < 600_000) {
      msg = await page.$eval("#export-msg", (e) => e.textContent ?? "");
      if (/^(Saved|Export failed)/.test(msg)) break;
      peak = Math.max(peak, await heap());
      await sleep(250);
    }
    const wall = (Date.now() - t0) / 1000;
    let file;
    for (let i = 0; i < 40 && !file; i++) {
      file = readdirSync(dir).find(
        (f) => !before.includes(f) && f.endsWith(`.${format}`) && !f.endsWith(".crdownload"),
      );
      if (!file) await sleep(250);
    }
    let probe;
    if (file) {
      const j = JSON.parse(
        execFileSync(FFPROBE, [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-of",
          "json",
          join(dir, file),
        ]).toString(),
      ).streams[0];
      probe = {
        codec: j.codec_name,
        width: j.width,
        height: j.height,
        frames: Number(j.nb_read_frames),
        bytes: statSync(join(dir, file)).size,
      };
      const renamed = `${example}_${size}.${format}`;
      execFileSync(process.platform === "win32" ? "cmd" : "mv", [
        ...(process.platform === "win32" ? ["/c", "move", "/y"] : []),
        join(dir, file),
        join(dir, renamed),
      ]);
    }
    const expected = Number(
      /· (\d+) frames/.exec(await page.$eval("#export-info", (e) => e.textContent ?? ""))?.[1],
    );
    results.push({
      ...row,
      exported: !!file,
      message: msg,
      wallSeconds: wall,
      expectedFrames: expected,
      probe,
      heapMB: { before: heap0 / 1e6, peak: peak / 1e6, after: (await heap()) / 1e6 },
    });
    console.log(
      `[presets] ${name} ${example} ${size} ${format}: ${msg.slice(0, 90)} | frames ${probe?.frames}/${expected}`,
    );
  }
  await browser.close();
}
server.close();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(`[presets] ${results.length} cases -> ${join(out, "results.json")}`);
