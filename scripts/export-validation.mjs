#!/usr/bin/env node
// Release validation of the web app's video and JSON export in real installed browsers.
// Serves a frozen build (ARCHFLOW_DIST, default artifacts/release/dist-snapshot), drives Chrome
// and Edge (headed and headless) through the real export dialog, captures the downloads with
// CDP, then probes every file with ffprobe/ffmpeg. Every number in the results comes from a file
// this script generated and probed.
//
//   node scripts/export-validation.mjs [--runs chrome,edge,chrome-headless] [--probe-only]
//
// Writes artifacts/release/export/<run>/... (videos, JSON, frames, screenshots),
// artifacts/release/export/results.json and artifacts/release/export/SUMMARY.md.
// The optional artifacts/release/export/visual-notes.json ({ "<key>": "note" }) holds the
// qualitative frame checks made by a person and is copied into the summary.
/* global document, performance, VideoEncoder, Event, MutationObserver, setTimeout, window -- used inside page callbacks */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.env.ARCHFLOW_DIST ??= join(root, "artifacts/release/dist-snapshot");
const { startServer } = await import("./serve-web.mjs");
const { default: puppeteer } = await import("puppeteer-core");

const OUT = join(root, "artifacts/release/export");
const FF_DIR =
  process.env.FFMPEG_DIR ??
  "C:/Users/Anjinappa N/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build-shared/bin";
const FFPROBE = join(FF_DIR, "ffprobe.exe");
const FFMPEG = join(FF_DIR, "ffmpeg.exe");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const probeOnly = process.argv.includes("--probe-only");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- what each browser run exports --------------------------------------------------------------
const FULL = [
  { key: "aws-alb_1280x720_30", example: "aws-alb", size: "1280x720", fps: 30, memory: false },
  { key: "aws-alb_1920x1080_30", example: "aws-alb", size: "1920x1080", fps: 30, memory: true },
  { key: "bench-text_1280x720_30", example: "bench-text", size: "1280x720", fps: 30 },
  {
    key: "bench-text_1920x1080_30",
    example: "bench-text",
    size: "1920x1080",
    fps: 30,
    memory: true,
  },
  { key: "bench-text_1280x720_60", example: "bench-text", size: "1280x720", fps: 60 },
  {
    key: "bench-text_1280x720_30_nocam",
    example: "bench-text",
    size: "1280x720",
    fps: 30,
    autoCamera: false,
  },
];
const RUNS = {
  chrome: { exe: CHROME, headless: false, exports: FULL, extras: true },
  edge: {
    exe: EDGE,
    headless: false,
    exports: [FULL[0], FULL[3], FULL[5]],
    extras: true,
  },
  "chrome-headless": {
    exe: CHROME,
    headless: true,
    exports: [FULL[0], FULL[2], FULL[3]],
    extras: false,
  },
};
const runNames = arg("runs", "chrome,edge,chrome-headless").split(",");

const resultsPath = join(OUT, "results.json");
const results =
  existsSync(resultsPath) && probeOnly
    ? JSON.parse(readFileSync(resultsPath, "utf8"))
    : {
        generatedAt: new Date().toISOString(),
        dist: process.env.ARCHFLOW_DIST,
        distManifest: JSON.parse(
          readFileSync(join(process.env.ARCHFLOW_DIST, "build-manifest.json"), "utf8"),
        ),
        ffprobe: execFileSync(FFPROBE, ["-version"]).toString().split("\n")[0].trim(),
        runs: {},
      };

// --- browser helpers ---------------------------------------------------------------------------
async function launch(name, cfg) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const profile = join(tmpdir(), `archflow-export-${name}-${Date.now()}`);
  const browser = await puppeteer.launch({
    executablePath: cfg.exe,
    headless: cfg.headless,
    userDataDir: profile,
    defaultViewport: null,
    protocolTimeout: 600_000,
    args: [
      "--window-size=1600,1000",
      "--force-color-profile=srgb",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const cdp = await browser.target().createCDPSession();
  const downloads = new Map(); // guid -> { name, state, t0, t1 }
  cdp.on("Browser.downloadWillBegin", (e) =>
    downloads.set(e.guid, {
      guid: e.guid,
      name: e.suggestedFilename,
      url: e.url,
      state: "begin",
      t0: Date.now(),
    }),
  );
  cdp.on("Browser.downloadProgress", (e) => {
    const d = downloads.get(e.guid);
    if (d) {
      d.state = e.state;
      if (e.state !== "inProgress") d.t1 = Date.now();
    }
  });
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allowAndName",
    downloadPath: dir,
    eventsEnabled: true,
  });
  const [page] = await browser.pages();
  const pcdp = await page.createCDPSession();
  await pcdp.send("Performance.enable");
  const consoleProblems = [];
  page.on(
    "console",
    (m) =>
      (m.type() === "error" || m.type() === "warn") &&
      consoleProblems.push(`${m.type()}: ${m.text()}`),
  );
  page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message}`));
  return {
    browser,
    page,
    pcdp,
    downloads,
    dir,
    profile,
    consoleProblems,
    version: await browser.version(),
  };
}

/** Waits for the next finished download after `count` and renames it to `label`. */
async function nextDownload(s, count, label, timeout = 120_000) {
  const t = Date.now();
  for (;;) {
    const list = [...s.downloads.values()];
    if (list.length > count && list[count].state === "completed") {
      const d = list[count];
      const file = join(s.dir, label);
      renameSync(join(s.dir, d.guid), file);
      return { file, suggested: d.name, url: d.url };
    }
    if (list.length > count && list[count].state === "canceled")
      throw new Error(`download canceled: ${label}`);
    if (Date.now() - t > timeout) throw new Error(`no download for ${label}`);
    await sleep(100);
  }
}

async function waitLoaded(page, marker) {
  await page.waitForFunction(
    (m) => {
      const a = document.getElementById("animate");
      const p = document.getElementById("placeholder");
      const src = document.getElementById("source").value;
      const time = document.getElementById("time").textContent;
      return a && !a.disabled && p && p.hidden && src.includes(m) && !/\/ 0\.0 s/.test(time);
    },
    { timeout: 60_000 },
    marker,
  );
  await sleep(500);
}

const TITLES = {
  "aws-alb": "AWS Application Load Balancer routing",
  "bench-text": "Order flow benchmark",
};

async function loadExample(page, id) {
  await closeDialog(page);
  await page.select("#examples", id);
  await waitLoaded(page, TITLES[id]);
}

async function closeDialog(page) {
  if (await page.$eval("#export-dialog", (d) => d.open)) {
    await page.click("#export-close");
    await page.waitForFunction(() => !document.getElementById("export-dialog").open);
  }
}

async function openDialog(page) {
  if (!(await page.$eval("#export-dialog", (d) => d.open))) await page.click("#open-export");
  await page.waitForFunction(() => document.getElementById("export-dialog").open);
}

async function setAutoCamera(page, on) {
  await closeDialog(page);
  const cur = await page.$eval("#auto-camera", (i) => i.checked);
  if (cur !== on) await page.click(".switch");
  await sleep(200);
  return page.$eval("#auto-camera", (i) => i.checked);
}

async function selectOptions(page, { format, size, fps }) {
  await openDialog(page);
  await page.select("#size", size);
  await page.select("#fps", String(fps));
  await sleep(600); // refreshFormats awaits isConfigSupported per option
  const options = await page.$$eval("#format option", (os) =>
    os.map((o) => ({ value: o.value, text: o.textContent.trim(), disabled: o.disabled })),
  );
  let selected = format;
  if (format) {
    await page.select("#format", format);
    await sleep(200);
    selected = await page.$eval("#format", (s) => s.value);
  }
  const info = await page.$eval("#export-info", (d) => d.innerText);
  return { options, selected, info };
}

const metrics = async (pcdp) =>
  Object.fromEntries(
    (await pcdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );

/** Runs one export through the dialog; returns message, timing, memory and download. */
async function runExport(s, job, format = "webm") {
  const { page, pcdp } = s;
  const sel = await selectOptions(page, { format, size: job.size, fps: job.fps });
  const time = await page.$eval("#time", (e) => e.textContent.trim());
  const expectedFrames = Number(/·\s*(\d+)\s*frames/.exec(sel.info)?.[1]);
  const camera = /Camera\s*\n?\s*(.+)/.exec(sel.info)?.[1]?.trim();
  const before = s.downloads.size;
  const mem = { before: (await metrics(pcdp)).JSHeapUsedSize, peak: 0, samples: 0 };
  const rtt = [];
  const t0 = Date.now();
  await page.click("#export");
  let msg;
  for (;;) {
    const a = Date.now();
    msg = await page.$eval("#export-msg", (e) => e.textContent.trim());
    rtt.push(Date.now() - a);
    const m = await metrics(pcdp);
    mem.peak = Math.max(mem.peak, m.JSHeapUsedSize);
    mem.samples++;
    if (/^(Saved|Export failed|Export cancelled)/.test(msg)) break;
    if (Date.now() - t0 > 600_000) throw new Error(`export timeout ${job.key}`);
    await sleep(100);
  }
  const wall = (Date.now() - t0) / 1000;
  const ok = msg.startsWith("Saved");
  let download;
  if (ok) {
    download = await nextDownload(s, before, `${job.key}${format === "mp4" ? "" : ""}.${format}`);
  }
  await sleep(1500);
  mem.after = (await metrics(pcdp)).JSHeapUsedSize;
  const renderSeconds = Number(/ in ([\d.]+) s\.?/.exec(msg)?.[1]);
  return {
    key: job.key,
    example: job.example,
    format,
    size: job.size,
    fps: job.fps,
    autoCamera: job.autoCamera !== false,
    timeText: time,
    animationSeconds: Number(/\/\s*([\d.]+)\s*s/.exec(time)?.[1]),
    dialogInfo: sel.info,
    formatOptions: sel.options,
    selectedFormat: sel.selected,
    expectedFrames,
    camera,
    message: msg,
    ok,
    renderSeconds: Number.isFinite(renderSeconds) ? renderSeconds : null,
    wallSeconds: wall,
    file: download ? download.file : null,
    suggestedName: download?.suggested ?? null,
    downloadUrl: download?.url ?? null,
    memory: { ...mem, unit: "bytes JSHeapUsedSize" },
    responsiveness: {
      evalRoundTripMs: {
        max: Math.max(...rtt),
        mean: +(rtt.reduce((x, y) => x + y, 0) / rtt.length).toFixed(1),
        n: rtt.length,
      },
    },
  };
}

/** Starts a 1920x1080 export and clicks #cancel at ~30 %; measures the response in the page. */
async function cancelTest(s) {
  const { page } = s;
  await loadExample(page, "bench-text");
  await selectOptions(page, { format: "webm", size: "1920x1080", fps: 30 });
  const before = s.downloads.size;
  await page.evaluate(() => {
    window.__cancel = {};
    const c = document.getElementById("cancel");
    c.addEventListener("click", () => (window.__cancel.click = performance.now()), {
      capture: true,
    });
    new MutationObserver(() => {
      const t = document.getElementById("export-msg").textContent;
      if (t.startsWith("Export cancelled") && !window.__cancel.msg)
        window.__cancel.msg = performance.now();
      if (t.startsWith("Saved")) window.__cancel.saved = true;
    }).observe(document.getElementById("export-msg"), {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await page.click("#export");
  await page.waitForFunction(() => document.getElementById("progress").value >= 0.3, {
    timeout: 120_000,
    polling: 50,
  });
  const cancelVisible = await page.$eval(
    "#cancel",
    (c) => !c.hidden && c.getBoundingClientRect().width > 0,
  );
  const progressAtClick = await page.$eval("#progress", (p) => p.value);
  const tClick = Date.now();
  await page.click("#cancel");
  await page.waitForFunction(() => window.__cancel.msg || window.__cancel.saved, {
    timeout: 60_000,
  });
  const node = Date.now() - tClick;
  const r = await page.evaluate(() => window.__cancel);
  await sleep(2000);
  return {
    cancelVisible,
    progressAtClick: +progressAtClick.toFixed(3),
    cancelledMessage: await page.$eval("#export-msg", (e) => e.textContent.trim()),
    inPageClickToMessageMs: r.msg && r.click ? +(r.msg - r.click).toFixed(1) : null,
    puppeteerClickToMessageMs: node,
    savedAnyway: !!r.saved,
    downloadsAfterCancel: s.downloads.size - before,
    exportButtonReenabled: await page.$eval("#export", (b) => !b.disabled),
  };
}

/** After a successful export: click the "Download again" link and compare. */
async function downloadAgain(s, first) {
  const { page } = s;
  await openDialog(page);
  const msgBefore = await page.$eval("#export-msg", (e) => e.textContent.trim());
  const href = await page.$eval("#export-msg a", (a) => a.href).catch(() => null);
  if (!href) return { href: null, note: "no Download again link" };
  const before = s.downloads.size;
  await page.evaluate(() => {
    window.__again = { progressShown: false, msgChanges: 0 };
    new MutationObserver(() => window.__again.msgChanges++).observe(
      document.getElementById("export-msg"),
      {
        childList: true,
        subtree: true,
        characterData: true,
      },
    );
    new MutationObserver(() => {
      if (!document.getElementById("progress").hidden) window.__again.progressShown = true;
    }).observe(document.getElementById("progress"), { attributes: true });
  });
  const t = Date.now();
  await page.click("#export-msg a");
  const d = await nextDownload(s, before, `download-again_${first.key}.webm`);
  const ms = Date.now() - t;
  await sleep(500);
  return {
    href,
    hrefIsBlob: href.startsWith("blob:"),
    downloadUrl: d.url,
    file: d.file,
    secondsToArrive: ms / 1000,
    messageUnchanged: (await page.$eval("#export-msg", (e) => e.textContent.trim())) === msgBefore,
    observed: await page.evaluate(() => window.__again),
    original: first.file,
  };
}

async function jsonCheck(s, example) {
  const { page } = s;
  await loadExample(page, example);
  const docMeta = await page.$eval("#doc-meta", (e) => e.textContent.trim());
  const timeBefore = await page.$eval("#time", (e) => e.textContent.trim());
  await openDialog(page);
  const before = s.downloads.size;
  await page.click("#download-json");
  const d = await nextDownload(s, before, `${example}.archflow.json`);
  const text = readFileSync(d.file, "utf8");
  const doc = JSON.parse(text);
  await closeDialog(page);
  // re-import through the JSON tab
  await page.click("#tab-json");
  await page.$eval(
    "#source",
    (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    text,
  );
  await page.click("#animate");
  await page.waitForFunction(
    () => {
      const p = document.getElementById("placeholder");
      return p.hidden && !document.getElementById("animate").disabled;
    },
    { timeout: 60_000 },
  );
  await sleep(1500);
  const errors = await page.$$eval("#issues li.error", (ls) => ls.map((l) => l.textContent.trim()));
  const warnings = await page.$$eval("#issues li:not(.error)", (ls) =>
    ls.map((l) => l.textContent.trim()),
  );
  const timeAfter = await page.$eval("#time", (e) => e.textContent.trim());
  const docMetaAfter = await page.$eval("#doc-meta", (e) => e.textContent.trim());
  const sc = doc.scenario ?? {};
  return {
    file: d.file,
    suggestedName: d.suggested,
    bytes: statSync(d.file).size,
    schema: doc.schema ?? doc.$schema ?? null,
    topKeys: Object.keys(doc),
    nodes: doc.diagram?.nodes?.length,
    edges: doc.diagram?.edges?.length,
    events: Array.isArray(sc.events) ? sc.events.length : null,
    scenarioDurationMs: sc.durationMs ?? null,
    docMetaBefore: docMeta,
    timeBefore,
    reimport: {
      errors,
      warnings,
      timeAfter,
      docMetaAfter,
      sameDuration: timeAfter.split("/")[1]?.trim() === timeBefore.split("/")[1]?.trim(),
    },
  };
}

async function encoderProbe(page) {
  return page.evaluate(async () => {
    const bitrateFor = (w, h) => Math.round(Math.min(12_000_000, Math.max(2_000_000, w * h * 4)));
    const out = [];
    const codecs = [
      "vp09.00.10.08",
      "vp09.00.40.08",
      "vp09.00.50.08",
      "avc1.640028",
      "avc1.640033",
      "avc1.42001f",
      "avc1.4d0028",
    ];
    const sizes = [
      [3840, 2160],
      [1080, 1920],
      [1920, 1080],
    ];
    for (const [width, height] of sizes)
      for (const codec of codecs)
        for (const hardwareAcceleration of [
          "no-preference",
          "prefer-hardware",
          "prefer-software",
        ]) {
          const cfg = {
            codec,
            width,
            height,
            framerate: 30,
            bitrate: bitrateFor(width, height),
            hardwareAcceleration,
          };
          if (codec.startsWith("avc1")) cfg.avc = { format: "avc" };
          let supported;
          try {
            supported = (await VideoEncoder.isConfigSupported(cfg)).supported;
          } catch (e) {
            supported = `throws: ${e.name}: ${e.message}`;
          }
          out.push({
            codec,
            width,
            height,
            fps: 30,
            hardwareAcceleration,
            bitrate: cfg.bitrate,
            supported,
          });
        }
    return out;
  });
}

async function canvasAtEnd(s, example, label) {
  const { page } = s;
  await loadExample(page, example);
  await page.click("#end");
  await sleep(1500);
  const time = await page.$eval("#time", (e) => e.textContent.trim());
  const file = join(s.dir, `${label}_app-canvas-end.png`);
  await (await page.$("#canvas")).screenshot({ path: file });
  return { file, time };
}

async function browserRun(name) {
  const cfg = RUNS[name];
  const s = await launch(name, cfg);
  const run = {
    browser: name,
    version: s.version,
    headless: cfg.headless,
    exports: [],
    mp4: [],
    notes: [],
  };
  results.runs[name] = run;
  const { page } = s;
  try {
    await page.goto(base, { waitUntil: "load" });
    await page.waitForSelector("#welcome-close", { visible: true, timeout: 30_000 });
    run.welcomeShown = true;
    await page.click("#welcome-close");
    await sleep(300);
    run.webCodecs = await page.evaluate(() => typeof VideoEncoder === "function");
    let lastExample;
    for (const job of cfg.exports) {
      if (job.example !== lastExample || job.autoCamera === false) {
        await loadExample(page, job.example);
        lastExample = job.example;
      }
      run.autoCameraState = await setAutoCamera(page, job.autoCamera !== false);
      const r = await runExport(s, job);
      r.autoCameraChecked = run.autoCameraState;
      run.exports.push(r);
      console.log(`[${name}] ${job.key}: ${r.message}`);
      if (job.autoCamera === false) {
        await setAutoCamera(page, true);
        lastExample = undefined;
      }
      if (job.key === "aws-alb_1280x720_30" && cfg.extras)
        run.downloadAgain = await downloadAgain(s, r);
    }
    // MP4 at each preset size
    await loadExample(page, "aws-alb");
    for (const size of ["1280x720", "1920x1080", "1080x1080"]) {
      const sel = await selectOptions(page, { size, fps: 30 });
      const mp4 = sel.options.find((o) => o.value === "mp4");
      const entry = { size, fps: 30, optionText: mp4.text, optionDisabled: mp4.disabled };
      if (!mp4.disabled && size !== "1080x1080") {
        const r = await runExport(
          s,
          { key: `aws-alb_${size}_30_mp4`, example: "aws-alb", size, fps: 30 },
          "mp4",
        );
        entry.export = r;
        run.exports.push(r);
        console.log(`[${name}] mp4 ${size}: ${r.message}`);
      } else if (mp4.disabled) {
        // try to force it: page.select on a disabled option must not produce an MP4
        await page.select("#format", "mp4");
        entry.valueAfterSelectingDisabled = await page.$eval("#format", (x) => x.value);
      }
      run.mp4.push(entry);
    }
    if (cfg.extras) {
      run.json = {
        "aws-alb": await jsonCheck(s, "aws-alb"),
        "bench-text": await jsonCheck(s, "bench-text"),
      };
      run.cancel = await cancelTest(s);
      run.appCanvasEnd = {
        "aws-alb": await canvasAtEnd(s, "aws-alb", "aws-alb"),
        "bench-text": await canvasAtEnd(s, "bench-text", "bench-text"),
      };
    }
    run.encoderProbe = await encoderProbe(page);
  } catch (e) {
    run.notes.push(`run aborted: ${e.stack ?? e}`);
    console.error(`[${name}]`, e);
    await page.screenshot({ path: join(s.dir, "failure.png") }).catch(() => {});
  } finally {
    run.consoleProblems = s.consoleProblems;
    await s.browser.close();
    rmSync(s.profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

// --- probing -------------------------------------------------------------------------------------
const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

function probe(file) {
  const j = JSON.parse(
    execFileSync(FFPROBE, [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]).toString(),
  );
  const v = j.streams.find((x) => x.codec_type === "video");
  const decode = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "null", "-"]);
  const head = readFileSync(file).subarray(0, 12);
  return {
    bytes: statSync(file).size,
    sha256: sha256(file),
    container: j.format.format_name,
    formatDuration: Number(j.format.duration),
    codec: v?.codec_name,
    profile: v?.profile,
    pixFmt: v?.pix_fmt,
    width: v?.width,
    height: v?.height,
    rFrameRate: v?.r_frame_rate,
    avgFrameRate: v?.avg_frame_rate,
    streamDuration: v?.duration ? Number(v.duration) : null,
    framesRead: Number(v?.nb_read_frames),
    audioStreams: j.streams.filter((x) => x.codec_type === "audio").length,
    streamCount: j.streams.length,
    ftyp:
      head.subarray(4, 8).toString("latin1") === "ftyp"
        ? head.subarray(8, 12).toString("latin1")
        : null,
    ebmlMagic: head.subarray(0, 4).toString("hex") === "1a45dfa3",
    decodeClean: decode.status === 0 && decode.stderr.toString().trim() === "",
    decodeStderr: decode.stderr.toString().trim().slice(0, 2000),
  };
}

function frameAt(file, out, args) {
  const r = spawnSync(FFMPEG, ["-v", "error", "-y", ...args.pre, "-i", file, ...args.post, out]);
  return r.status === 0 && existsSync(out) ? out : `failed: ${r.stderr.toString().slice(0, 300)}`;
}

function probeAll() {
  for (const run of Object.values(results.runs)) {
    for (const e of run.exports) {
      if (!e.file || !existsSync(e.file)) continue;
      e.probe = probe(e.file);
      const base = e.file.replace(/\.(webm|mp4)$/, "");
      e.frames = {
        first: frameAt(e.file, `${base}_first.png`, { pre: [], post: ["-frames:v", "1"] }),
        last: frameAt(e.file, `${base}_last.png`, {
          pre: ["-sseof", "-1"],
          post: ["-update", "1"],
        }),
      };
      if (e.example === "bench-text") {
        const d = e.probe.formatDuration;
        for (const f of [0.25, 0.5, 0.75]) {
          const ts = +(d * f).toFixed(2);
          e.frames[`t${ts}`] = frameAt(e.file, `${base}_t${ts}.png`, {
            pre: ["-ss", String(ts)],
            post: ["-frames:v", "1"],
          });
        }
      }
      e.check = {
        framesMatch: e.probe.framesRead === e.expectedFrames,
        durationDeltaS: +(e.probe.formatDuration - e.animationSeconds).toFixed(3),
        sizeMatch: `${e.probe.width}x${e.probe.height}` === e.size,
      };
    }
    if (
      run.downloadAgain?.file &&
      existsSync(run.downloadAgain.file) &&
      run.downloadAgain.original
    ) {
      const a = run.downloadAgain;
      a.bytes = statSync(a.file).size;
      a.sha256 = sha256(a.file);
      a.originalBytes = statSync(a.original).size;
      a.originalSha256 = sha256(a.original);
      a.identical = a.sha256 === a.originalSha256;
    }
  }
}

// --- summary -------------------------------------------------------------------------------------
function summary() {
  const notesPath = join(OUT, "visual-notes.json");
  const notes = existsSync(notesPath) ? JSON.parse(readFileSync(notesPath, "utf8")) : {};
  const rel = (f) =>
    typeof f === "string"
      ? f
          .replace(root + "\\", "")
          .replace(root + "/", "")
          .replace(/\\/g, "/")
      : f;
  const L = [];
  L.push("# Export validation", "");
  L.push(
    `Generated ${results.generatedAt} by \`scripts/export-validation.mjs\` against \`${rel(results.dist)}\`. Probed with ${results.ffprobe}.`,
    "",
  );
  L.push("## Exports", "");
  L.push(
    "| Browser | Example | Format | Size | fps | Cam | Anim s | File s | Frames exp/act | Codec | Audio | Bytes | Render s | Decode clean |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const run of Object.values(results.runs))
    for (const e of run.exports) {
      const p = e.probe ?? {};
      L.push(
        `| ${run.browser} | ${e.example} | ${e.format} | ${e.size} | ${e.fps} | ${e.autoCamera ? "auto" : "off"} | ${e.animationSeconds} | ${p.formatDuration ?? "-"} | ${e.expectedFrames}/${p.framesRead ?? "-"} | ${p.codec ?? "-"}${p.ftyp ? ` (ftyp ${p.ftyp})` : ""} | ${p.audioStreams ?? "-"} | ${p.bytes ?? "-"} | ${e.renderSeconds ?? "-"} | ${p.decodeClean ?? (e.ok ? "-" : e.message)} |`,
      );
    }
  L.push("", "## MP4 option", "");
  for (const run of Object.values(results.runs))
    for (const m of run.mp4)
      L.push(
        `- ${run.browser} ${m.size}@${m.fps}: "${m.optionText}" disabled=${m.optionDisabled}${m.export ? ` → ${m.export.message}` : ""}${m.valueAfterSelectingDisabled ? `; value after selecting it: ${m.valueAfterSelectingDisabled}` : ""}`,
      );
  L.push("", "## JSON download and re-import", "");
  for (const run of Object.values(results.runs))
    for (const [k, j] of Object.entries(run.json ?? {}))
      L.push(
        `- ${run.browser} ${k}: schema=${j.schema}, nodes=${j.nodes}, edges=${j.edges}, events=${j.events}, doc-meta "${j.docMetaBefore}", re-import errors=${j.reimport.errors.length}, time ${j.timeBefore} → ${j.reimport.timeAfter} (same=${j.reimport.sameDuration})`,
      );
  L.push("", "## Download again", "");
  for (const run of Object.values(results.runs))
    if (run.downloadAgain) {
      const a = run.downloadAgain;
      L.push(
        `- ${run.browser}: blob href=${a.hrefIsBlob}, identical=${a.identical} (${a.bytes} vs ${a.originalBytes} bytes), arrived in ${a.secondsToArrive} s, message unchanged=${a.messageUnchanged}, progress shown=${a.observed?.progressShown}, message mutations=${a.observed?.msgChanges}`,
      );
    }
  L.push("", "## Cancel / responsiveness / memory (1920x1080)", "");
  for (const run of Object.values(results.runs)) {
    if (run.cancel) L.push(`- ${run.browser} cancel: ${JSON.stringify(run.cancel)}`);
    for (const e of run.exports.filter((x) => x.size === "1920x1080"))
      L.push(
        `- ${run.browser} ${e.key} ${e.format}: heap before ${e.memory.before}, peak ${e.memory.peak}, after ${e.memory.after} (${e.memory.samples} samples); eval round trip max ${e.responsiveness.evalRoundTripMs.max} ms, mean ${e.responsiveness.evalRoundTripMs.mean} ms`,
      );
  }
  L.push("", "## isConfigSupported (not in the UI)", "");
  L.push("| Browser | Codec | Size | HW pref | Supported |", "|---|---|---|---|---|");
  for (const run of Object.values(results.runs))
    for (const p of run.encoderProbe ?? [])
      if (p.width !== 1920)
        L.push(
          `| ${run.browser} | ${p.codec} | ${p.width}x${p.height} | ${p.hardwareAcceleration} | ${p.supported} |`,
        );
  L.push("", "## Visual checks", "");
  for (const [k, v] of Object.entries(notes)) L.push(`- **${k}**: ${v}`);
  if (!Object.keys(notes).length) L.push("- none recorded yet");
  L.push("", "## Console problems", "");
  for (const run of Object.values(results.runs))
    L.push(
      `- ${run.browser} (${run.version}): ${run.consoleProblems?.length ? run.consoleProblems.join(" | ") : "none"}${run.notes.length ? `; notes: ${run.notes.join(" | ")}` : ""}`,
    );
  writeFileSync(join(OUT, "SUMMARY.md"), L.join("\n") + "\n");
}

// --- main ----------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
let server;
let base;
if (!probeOnly) {
  server = await startServer(Number(arg("port", 0)));
  base = `http://127.0.0.1:${server.address().port}/`;
  for (const name of runNames) await browserRun(name);
  server.close();
}
probeAll();
writeFileSync(resultsPath, JSON.stringify(results, null, 2) + "\n");
summary();
console.log(`wrote ${resultsPath} and SUMMARY.md`);
