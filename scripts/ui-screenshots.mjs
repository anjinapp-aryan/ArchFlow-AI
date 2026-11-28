#!/usr/bin/env node
// Screenshots of the web app's main screens at common laptop and desktop sizes, for visual
// review and the before/after comparison in docs/ui. Serves apps/web/dist (build it first with
// `npm run web:build`) with its real headers and drives it with headless Chrome.
//
//   node scripts/ui-screenshots.mjs --tag after [--out artifacts/ui/screens] [--sizes 1920x1080,1366x768]
//
// --tag before   only the screens the previous UI had (initial workspace, error state)
// --tag after    every screen of the current UI
// Writes <out>/<tag>/<size>/<NN-screen>.png and <out>/<tag>/report.json (console problems,
// horizontal overflow and clipped controls found on each screen).
/* global setTimeout, document, requestAnimationFrame, Event, getComputedStyle -- used inside page callbacks */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { findChrome } from "../packages/qa/src/chrome.ts";
import { startServer } from "./serve-web.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const tag = arg("tag", "after");
const out = resolve(root, arg("out", "artifacts/ui/screens"), tag);
const sizes = arg("sizes", "1920x1080,1600x900,1366x768,1280x720")
  .split(",")
  .map((s) => s.split("x").map(Number));

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--font-render-hinting=none"],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const ready = (page) =>
  page.waitForFunction(
    () => {
      const a = document.querySelector("#animate");
      return a && !a.disabled && document.querySelector("#placeholder")?.hidden;
    },
    { timeout: 30_000 },
  );
const seek = (page, t) =>
  page.$eval(
    "#seek",
    (e, v) => {
      e.value = String(v);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    },
    t,
  );
const pickExample = async (page, id) => {
  await page.select("#examples", id);
  await sleep(400);
  await ready(page);
};

/** Layout problems a reviewer would notice: page wider than the window, controls cut off. */
const layoutProblems = (page) =>
  page.evaluate(() => {
    const found = [];
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.clientHeight;
    if (document.documentElement.scrollWidth > W + 1)
      found.push(`horizontal overflow: ${document.documentElement.scrollWidth} > ${W}`);
    for (const el of document.querySelectorAll("button, select, input, [role=tab], label")) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden") continue;
      if (el.closest("[hidden], dialog:not([open])")) continue;
      // inside a scrollable panel, being below the fold is fine
      let p = el.parentElement;
      let scrolls = false;
      while (p) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) scrolls = true;
        p = p.parentElement;
      }
      if (r.right > W + 1 || r.left < -1)
        found.push(`off-screen x: ${el.id || el.textContent?.trim().slice(0, 30)}`);
      if (!scrolls && (r.bottom > H + 1 || r.top < -1))
        found.push(`off-screen y: ${el.id || el.textContent?.trim().slice(0, 30)}`);
    }
    return found;
  });

const SCREENS = {
  before: [
    ["01-initial", async () => {}],
    [
      "02-error",
      async (page) => {
        await page.click("#tab-mermaid");
        await page.$eval("#source", (e) => (e.value = "pie title nope\n"));
        await page.click("#animate");
        await page.waitForSelector("#issues li.error");
      },
    ],
  ],
  after: [
    ["01-first-visit", async () => {}],
    [
      "02-workspace",
      async (page) => {
        await page.click("#welcome-close");
        await seek(page, 2300);
        await frame(page);
      },
    ],
    [
      "03-examples",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#open-examples");
        await sleep(200);
      },
    ],
    [
      "04-scenario",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#side-tab-scenario");
        await page.select(
          "#fail-pair",
          (await page.$$eval("#fail-pair option", (o) => o[2]?.value)) ?? "",
        );
        await seek(page, 3000);
        await frame(page);
      },
    ],
    [
      "05-diagnostics",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#side-tab-diagnostics");
        await page.$$eval("#issues details", (d) => d[0] && (d[0].open = true));
        await frame(page);
      },
    ],
    [
      "06-playing-auto-camera",
      async (page) => {
        await page.click("#welcome-close");
        await pickExample(page, "bench-text");
        await page.click("#play");
        await seek(page, 5200);
        await frame(page);
      },
    ],
    [
      "07-manual-zoom",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#zoom-in");
        await page.click("#zoom-in");
        await seek(page, 2300);
        await frame(page);
      },
    ],
    [
      "08-view-options",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#view-menu");
        await sleep(150);
      },
    ],
    [
      "09-presentation",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#present");
        await seek(page, 2300);
        await sleep(300);
        await frame(page);
      },
    ],
    [
      "10-export-dialog",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#open-export");
        await sleep(200);
      },
    ],
    [
      "11-export-done",
      async (page) => {
        await page.click("#welcome-close");
        await pickExample(page, "puml-sequence");
        await page.click("#open-export");
        await page.click("#export");
        await page.waitForFunction(
          () => /Saved/.test(document.querySelector("#export-msg")?.textContent ?? ""),
          { timeout: 120_000 },
        );
      },
    ],
    [
      "12-error",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#tab-mermaid");
        await page.$eval("#source", (e) => (e.value = "pie title nope\n"));
        await page.click("#animate");
        await page.waitForSelector("#issues li.error");
        await sleep(150);
      },
    ],
    [
      "13-sidebar-collapsed",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#toggle-sidebar");
        await seek(page, 2300);
        await sleep(250);
        await frame(page);
      },
    ],
    [
      "15-diagnostic-highlight",
      async (page) => {
        await page.click("#welcome-close");
        await pickExample(page, "aws-alb");
        await page.click("#play");
        await page.click("#side-tab-diagnostics");
        const items = await page.$$("#issues li");
        for (const li of items) {
          const t = await li.$eval(".issue-title", (e) => e.textContent);
          const b = await li.$('[data-action="show"]');
          if (t === "Request routed to one target" && b) {
            await b.click();
            break;
          }
        }
        await frame(page);
      },
    ],
    [
      "16-editor-error-line",
      async (page) => {
        await page.click("#welcome-close");
        await page.$eval(
          "#source",
          (e) =>
            (e.value =
              "title: Checkout\nUser -> Web -> API : POST /orders\nthis line ??? is not a link\nAPI -> DB : INSERT\nAPI ..> Queue : OrderCreated\n"),
        );
        await page.click("#animate");
        await ready(page);
        await page.click("#side-tab-diagnostics");
        await page.click('#issues [data-action="line"]');
        await frame(page);
      },
    ],
    [
      "14-light-workspace",
      async (page) => {
        await page.click("#welcome-close");
        await page.click("#workspace-theme"); // system (dark here) -> light
        await seek(page, 2300);
        await frame(page);
      },
    ],
  ],
};

const report = {};
const only = arg("only", "");
for (const [w, h] of sizes) {
  const dir = join(out, `${w}x${h}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, act] of SCREENS[tag]) {
    if (only && !name.includes(only)) continue;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const problems = [];
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warn") && !m.text().includes("willReadFrequently"))
        problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await page.setViewport({ width: w, height: h });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await page.goto(base, { waitUntil: "load" });
    await ready(page);
    try {
      await act(page);
    } catch (e) {
      problems.push(`step failed: ${e.message}`);
    }
    await sleep(120);
    await page.screenshot({ path: join(dir, `${name}.png`) });
    report[`${w}x${h}/${name}`] = [...problems, ...(await layoutProblems(page))];
    await ctx.close();
    console.log(`[ui] ${w}x${h} ${name} ${report[`${w}x${h}/${name}`].length ? "PROBLEMS" : "ok"}`);
  }
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
await browser.close();
server.close();
const bad = Object.entries(report).filter(([, p]) => p.length);
for (const [k, p] of bad) console.log(`[ui] ${k}:\n  ${p.join("\n  ")}`);
console.log(`[ui] ${Object.keys(report).length} screens -> ${out}`);
