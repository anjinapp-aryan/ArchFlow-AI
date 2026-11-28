#!/usr/bin/env node
// Headed cross-browser QA of the ArchFlow workspace (Chrome, Edge, Firefox) against the frozen
// release snapshot. Writes screenshots and results to artifacts/release/browser/.
// Usage: node scripts/browser-validation.mjs [chrome,edge,firefox]
/* global setTimeout, window, document, requestAnimationFrame, getComputedStyle, localStorage, Event, performance, matchMedia, innerHeight -- used inside page callbacks */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.env.ARCHFLOW_DIST ??= join(repo, "artifacts/release/dist-snapshot");
const { startServer } = await import("./serve-web.mjs");
const OUT = join(repo, "artifacts/release/browser");
const FIX = join(repo, "fixtures/diagrams");

const BROWSERS = {
  chrome: { browser: "chrome", exe: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  edge: {
    browser: "chrome",
    exe: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  },
  firefox: { browser: "firefox", exe: "C:\\Program Files\\Mozilla Firefox\\firefox.exe" },
};
const SAMPLE_IDS = [
  "bench-text",
  "bench-sentences",
  "bench-mermaid",
  "aws-alb",
  "sequence",
  "mermaid-syntax",
  "drawio-order",
  "drawio-real",
  "puml-component",
  "puml-sequence",
  "canonical",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer(8792);
const BASE = `http://127.0.0.1:${server.address().port}/`;
const want = (process.argv[2] ?? "chrome,edge,firefox").split(",");
const all = {};

for (const name of want) {
  const cfg = BROWSERS[name];
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const results = [];
  const logs = [];
  const rec = { browser: name, version: null, launchError: null, results, logs };
  all[name] = rec;
  const profile = join(OUT, "profiles", name);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({
      browser: cfg.browser,
      executablePath: cfg.exe,
      headless: false,
      userDataDir: profile,
      defaultViewport: { width: 1366, height: 768 },
      args:
        cfg.browser === "chrome"
          ? [
              "--no-first-run",
              "--no-default-browser-check",
              "--window-size=1500,1000",
              // keep frames running when another window covers the test window
              "--disable-backgrounding-occluded-windows",
              "--disable-renderer-backgrounding",
              "--disable-background-timer-throttling",
            ]
          : ["-width", "1500", "-height", "1000"],
      protocolTimeout: 120_000,
    });
    rec.version = await browser.version();
  } catch (e) {
    rec.launchError = String(e?.stack ?? e);
    console.log(`[${name}] launch failed: ${e}`);
    continue;
  }
  console.log(`[${name}] ${rec.version}`);
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ width: 1366, height: 768 });
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warn" || t === "warning") logs.push(`console.${t}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e?.message ?? e}`));
  page.on("requestfailed", (r) => logs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page
    .evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
      );
    })
    .catch((e) => logs.push(`evaluateOnNewDocument unsupported: ${e.message}`));

  const shot = async (n) => {
    try {
      await page.screenshot({ path: join(dir, `${n}.png`) });
    } catch (e) {
      logs.push(`screenshot ${n} failed: ${e.message}`);
    }
    return join("artifacts/release/browser", name, `${n}.png`);
  };
  const check = async (area, label, fn) => {
    const t0 = Date.now();
    let pass = false;
    let detail = "";
    try {
      const r = await fn();
      if (r && typeof r === "object")
        ({ pass, detail } = { pass: !!r.pass, detail: r.detail ?? "" });
      else pass = r !== false;
    } catch (e) {
      detail = `EXCEPTION ${e?.message ?? e}`;
    }
    results.push({ area, label, pass, detail, ms: Date.now() - t0 });
    console.log(
      `[${name}] ${pass ? "PASS" : "FAIL"} ${area} / ${label}${detail ? ` — ${detail}` : ""}`,
    );
    return pass;
  };
  const collectCsp = async () => {
    const v = await page.evaluate(() => window.__csp?.splice(0) ?? []).catch(() => []);
    for (const x of v) logs.push(`csp: ${x}`);
  };
  const ready = () =>
    page.waitForFunction(
      () =>
        !document.querySelector("#animate").disabled &&
        document.querySelector("#placeholder").hidden &&
        document.querySelector("#busy").hidden,
      { timeout: 30_000 },
    );
  const settle = async () => {
    await sleep(250);
    await ready();
    await sleep(150);
  };
  const st = () =>
    page.evaluate(async () => {
      // a frame, or 300 ms when the browser throttles frames (occluded window)
      await new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(r));
        setTimeout(r, 300);
      });
      const q = (s) => document.querySelector(s);
      return {
        t: Number(q("#seek").value),
        max: Number(q("#seek").max),
        time: q("#time").textContent,
        play: q("#play").getAttribute("aria-label"),
        body: document.body.className,
        chip: q("#view-chip").innerText.trim(),
        fit: q("#zoom-fit").textContent.trim(),
        auto: q("#auto-camera").checked,
        loop: q("#loop").checked,
        title: q("#doc-title").textContent,
        meta: q("#doc-meta").textContent,
        errors: document.querySelectorAll("#issues li.error").length,
        warnings: document.querySelectorAll("#issues li.warning").length,
        infos: document.querySelectorAll("#issues li.info").length,
        fs: !!document.fullscreenElement,
        active: document.activeElement?.id ?? "",
        welcome: !q("#welcome").hidden,
      };
    });
  const canvasInfo = () =>
    page.evaluate(() => {
      const c = document.querySelector("#canvas");
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const bg = [d[0], d[1], d[2]];
      let diff = 0;
      let n = 0;
      let h = 0;
      for (let i = 0; i < d.length; i += 4 * 7) {
        n++;
        if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30)
          diff++;
        h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
      }
      return { w: c.width, h: c.height, fg: diff / n, hash: h, bg };
    });
  const visible = (sel) =>
    page.$eval(sel, (e) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return (
        s.display !== "none" &&
        s.visibility !== "hidden" &&
        Number(s.opacity) > 0.05 &&
        r.width > 0 &&
        r.height > 0
      );
    });
  const center = async (sel) => {
    const r = await page.$eval(sel, (e) => {
      const b = e.getBoundingClientRect();
      return {
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        w: b.width,
        h: b.height,
        l: b.x,
        t: b.y,
      };
    });
    return r;
  };
  const fresh = async () => {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await page.goto(BASE, { waitUntil: "load" });
    await ready();
  };
  const blur = () => page.evaluate(() => document.activeElement?.blur?.());
  const setSource = (kindBtn, text) =>
    page.evaluate(
      (k, t) => {
        document.querySelector(k).click();
        const s = document.querySelector("#source");
        s.value = t;
        s.dispatchEvent(new Event("input", { bubbles: true }));
      },
      kindBtn,
      text,
    );

  try {
    // ---------------- welcome ----------------
    await page.goto(BASE, { waitUntil: "load" });
    await fresh();
    await check("welcome", "first visit shows #welcome", async () => {
      await sleep(300);
      const s = await st();
      await shot("01-welcome");
      return { pass: s.welcome, detail: `welcome=${s.welcome} focus=${s.active}` };
    });
    await check("welcome", "Describe focuses editor", async () => {
      await page.click("#start-describe");
      const s = await st();
      const pressed = await page.$eval("#tab-text", (e) => e.getAttribute("aria-pressed"));
      return {
        pass: s.active === "source" && !s.welcome && pressed === "true",
        detail: `focus=${s.active} welcome=${s.welcome} text=${pressed}`,
      };
    });
    await fresh();
    await check("welcome", "Import opens file chooser and draw.io animates", async () => {
      const [fc] = await Promise.all([
        page.waitForFileChooser({ timeout: 8000 }),
        page.click("#start-import"),
      ]);
      await fc.accept([join(FIX, "10-order-flow.drawio")]);
      await settle();
      await sleep(600);
      const s = await st();
      const c = await canvasInfo();
      await shot("02-import-drawio");
      return {
        pass: /draw\.io/.test(s.meta) && s.errors === 0 && c.fg > 0.005 && s.t > 0,
        detail: `meta="${s.meta}" errors=${s.errors} fg=${c.fg.toFixed(3)} t=${s.t}`,
      };
    });
    for (const [f, re] of [
      ["14-mermaid-syntax.mmd", /Mermaid/],
      ["16-plantuml-component.puml", /PlantUML/],
    ]) {
      await check("welcome", `#file upload ${f} animates`, async () => {
        const input = await page.$("#file");
        await input.uploadFile(join(FIX, f));
        await settle();
        await sleep(600);
        const s = await st();
        const c = await canvasInfo();
        await shot(`03-file-${f.split(".")[0]}`);
        return {
          pass: re.test(s.meta) && s.errors === 0 && c.fg > 0.005 && s.t > 0,
          detail: `meta="${s.meta}" errors=${s.errors} fg=${c.fg.toFixed(3)} t=${s.t}`,
        };
      });
    }
    await check("welcome", "#start-examples opens gallery", async () => {
      await fresh();
      await page.click("#start-examples");
      await sleep(200);
      const n = await page.$$eval("#gallery button[data-sample]", (b) => b.length);
      await shot("04-gallery");
      return {
        pass: n === SAMPLE_IDS.length && (await visible("#welcome-gallery")),
        detail: `buttons=${n}`,
      };
    });
    for (const id of SAMPLE_IDS) {
      await check("examples", `gallery loads ${id}`, async () => {
        if (!(await st()).welcome) await page.click("#open-examples");
        await page.waitForSelector(`#gallery button[data-sample="${id}"]`, {
          visible: true,
          timeout: 5000,
        });
        await page.click(`#gallery button[data-sample="${id}"]`);
        await settle();
        await sleep(500);
        const s = await st();
        const c = await canvasInfo();
        await shot(`05-example-${id}`);
        const titles = await page.$$eval("#issues li.error .issue-title", (x) =>
          x.map((e) => e.textContent),
        );
        return {
          pass: s.errors === 0 && c.fg > 0.005 && !s.welcome,
          detail: `title="${s.title}" errors=${s.errors}${titles.length ? ` [${titles}]` : ""} warn=${s.warnings} info=${s.infos} fg=${c.fg.toFixed(3)} t=${s.t}`,
        };
      });
    }
    await check("welcome", "second visit hides welcome", async () => {
      await page.reload({ waitUntil: "load" });
      await ready();
      await sleep(300);
      const s = await st();
      return { pass: !s.welcome, detail: `welcome=${s.welcome}` };
    });

    // ---------------- workspace ----------------
    await check("workspace", "tabs by click", async () => {
      const out = [];
      for (const t of ["scenario", "diagnostics", "diagram"]) {
        await page.click(`#side-tab-${t}`);
        out.push(
          await page.evaluate(
            (t) =>
              document.querySelector(`#side-tab-${t}`).getAttribute("aria-selected") === "true" &&
              !document.querySelector(`#pane-${t}`).hidden,
            t,
          ),
        );
      }
      return { pass: out.every(Boolean), detail: out.join(",") };
    });
    await check("workspace", "tabs by arrow keys / Home / End", async () => {
      await page.focus("#side-tab-diagram");
      const sel = () =>
        page.evaluate(
          () =>
            document.querySelector("[role=tab][aria-selected=true]").id +
            "@" +
            document.activeElement.id,
        );
      const seq = [];
      for (const k of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "End", "Home"]) {
        await page.keyboard.press(k);
        seq.push(await sel());
      }
      const exp = [
        "scenario",
        "diagnostics",
        "diagram",
        "diagnostics",
        "diagnostics",
        "diagram",
      ].map((x) => `side-tab-${x}@side-tab-${x}`);
      return { pass: JSON.stringify(seq) === JSON.stringify(exp), detail: seq.join(" ") };
    });
    await check("workspace", "sidebar collapse/expand button", async () => {
      await page.click("#toggle-sidebar");
      await sleep(400);
      const a = await st();
      const w1 = (await center("#sidebar")).w;
      await shot("10-sidebar-collapsed");
      await page.click("#toggle-sidebar");
      await sleep(400);
      const b = await st();
      return {
        pass: a.body.includes("side-collapsed") && !b.body.includes("side-collapsed"),
        detail: `collapsedWidth=${w1}`,
      };
    });
    await check("workspace", "[ key toggles sidebar", async () => {
      await page.focus("#canvas");
      await page.keyboard.press("[");
      const a = await st();
      await page.keyboard.press("[");
      const b = await st();
      return {
        pass: a.body.includes("side-collapsed") && !b.body.includes("side-collapsed"),
        detail: `${a.body} -> ${b.body}`,
      };
    });
    await check("workspace", "resizer mouse drag + persistence after reload", async () => {
      const r = await center("#resizer");
      const w0 = (await center("#sidebar")).w;
      await page.mouse.move(r.x, r.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(r.x + i * 10, r.y);
      await page.mouse.up();
      await sleep(200);
      const w1 = (await center("#sidebar")).w;
      const saved = await page.evaluate(() => localStorage.getItem("archflow.sidebarWidth"));
      await page.reload({ waitUntil: "load" });
      await ready();
      await sleep(200);
      const w2 = (await center("#sidebar")).w;
      return {
        pass: Math.abs(w1 - w0 - 100) <= 4 && Math.abs(w2 - w1) <= 2,
        detail: `before=${w0} afterDrag=${w1} saved=${saved} afterReload=${w2}`,
      };
    });
    await check("workspace", "resizer arrow keys", async () => {
      await page.focus("#resizer");
      const w0 = (await center("#sidebar")).w;
      await page.keyboard.press("ArrowLeft");
      await sleep(100);
      const w1 = (await center("#sidebar")).w;
      await page.keyboard.press("ArrowRight");
      await sleep(100);
      const w2 = (await center("#sidebar")).w;
      return {
        pass: Math.abs(w0 - w1 - 20) <= 2 && Math.abs(w2 - w0) <= 2,
        detail: `${w0} -> ${w1} -> ${w2}`,
      };
    });
    await check("workspace", "workspace theme cycle", async () => {
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await page.click("#workspace-theme");
        await sleep(150);
        seen.push(
          await page.evaluate(
            () =>
              (document.documentElement.dataset.theme ?? "system") +
              "/" +
              getComputedStyle(document.body).backgroundColor,
          ),
        );
        await shot(`11-ws-theme-${i}`);
      }
      return {
        pass:
          seen[0].startsWith("light") &&
          seen[1].startsWith("dark") &&
          seen[2].startsWith("system") &&
          seen[0].split("/")[1] !== seen[1].split("/")[1],
        detail: seen.join(" | "),
      };
    });
    // known state for the view checks
    await page.select("#examples", "drawio-real");
    await settle();
    await check("workspace", "zoom in / out / fit buttons", async () => {
      await page.click("#zoom-fit");
      const a = await st();
      await page.click("#zoom-in");
      await sleep(150);
      const b = await st();
      await shot("12-zoom-in");
      await page.click("#zoom-out");
      await sleep(150);
      const c = await st();
      await page.click("#zoom-in");
      await page.click("#zoom-fit");
      await sleep(150);
      const d = await st();
      return {
        pass:
          a.fit === "Fit" &&
          b.fit === "140%" &&
          /Manual view/.test(b.chip) &&
          c.fit === "Fit" &&
          d.fit === "Fit",
        detail: `${a.fit} -> ${b.fit} [chip "${b.chip}" auto=${b.auto}] -> ${c.fit} -> ${d.fit}`,
      };
    });
    await check("workspace", "wheel zoom", async () => {
      const c = await center("#canvas");
      await page.mouse.move(c.x, c.y);
      await page.mouse.wheel({ deltaY: -120 });
      await sleep(200);
      const a = await st();
      await page.mouse.wheel({ deltaY: 120 });
      await sleep(200);
      const b = await st();
      return { pass: a.fit !== "Fit" && b.fit === "Fit", detail: `${a.fit} -> ${b.fit}` };
    });
    await check("workspace", "drag pan (and drag does not toggle play)", async () => {
      await page.click("#zoom-in");
      await page.click("#zoom-in");
      await page.evaluate(() => {
        if (document.querySelector("#play").getAttribute("aria-label") === "Pause")
          document.querySelector("#play").click();
      });
      await sleep(200);
      const before = await canvasInfo();
      const p0 = (await st()).play;
      const c = await center("#canvas");
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + i * 15, c.y + i * 8);
      await page.mouse.up();
      await sleep(300);
      const after = await canvasInfo();
      const p1 = (await st()).play;
      await shot("13-panned");
      await page.click("#zoom-fit");
      return {
        pass: before.hash !== after.hash && p0 === p1,
        detail: `hashChanged=${before.hash !== after.hash} play ${p0}->${p1}`,
      };
    });
    await check("workspace", "camera chip: auto vs off vs manual", async () => {
      await page.click("#zoom-fit");
      if (!(await st()).auto) await page.click("label.switch");
      await sleep(150);
      const a = await st();
      await page.click("label.switch");
      await sleep(150);
      const b = await st();
      await shot("14-chip-auto-off");
      await page.click("label.switch");
      await sleep(150);
      const c = await st();
      await page.click("#zoom-in");
      await sleep(150);
      const d = await st();
      await page.click("#zoom-fit");
      return {
        pass:
          a.auto &&
          !b.auto &&
          /auto camera off/.test(b.chip) &&
          c.auto &&
          /Manual view/.test(d.chip),
        detail: `auto:"${a.chip}" | off:"${b.chip}" | on:"${c.chip}" | manual:"${d.chip}" (auto=${d.auto})`,
      };
    });
    await check("workspace", "view menu theme + dim", async () => {
      await page.click("#view-menu");
      await sleep(150);
      const open = await visible("#view-pop");
      const c0 = await canvasInfo();
      const bg0 = c0.bg;
      await page.select("#theme", "dark");
      await sleep(400);
      const c1 = await canvasInfo();
      const bg1 = c1.bg;
      await shot("15-view-dark");
      const h0 = (await canvasInfo()).hash;
      await page.click("#dim");
      await sleep(400);
      const dim = await page.$eval("#dim", (e) => e.checked);
      const h1 = (await canvasInfo()).hash;
      await page.keyboard.press("Escape");
      await sleep(150);
      const closed = await page.$eval("#view-pop", (e) => e.hidden);
      await page.click("#view-menu");
      await page.select("#theme", "default");
      await page.click("#dim");
      await page.keyboard.press("Escape");
      return {
        pass: open && c0.hash !== c1.hash && dim && closed,
        detail: `open=${open} themePixelsChanged=${c0.hash !== c1.hash} bg ${bg0}->${bg1} dimChecked=${dim} dimChangedPixels=${h0 !== h1} escCloses=${closed}`,
      };
    });

    // ---------------- playback ----------------
    await page.select("#examples", "bench-text");
    await settle();
    await blur();
    await check("playback", "play / pause button", async () => {
      await page.click("#start");
      await page.click("#play");
      await sleep(700);
      const a = await st();
      await page.click("#play");
      await sleep(200);
      const b = await st();
      await sleep(400);
      const c = await st();
      return {
        pass: a.play === "Pause" && a.t > 300 && b.play === "Play" && c.t === b.t,
        detail: `playing t=${a.t.toFixed(0)} label=${a.play}; paused label=${b.play} t=${b.t.toFixed(0)}->${c.t.toFixed(0)} dur=${a.max}`,
      };
    });
    await check("playback", "next / prev event", async () => {
      await page.click("#start");
      await page.click("#next");
      const a = await st();
      await page.click("#next");
      const b = await st();
      await page.click("#prev");
      const c = await st();
      return {
        pass: a.t > 0 && b.t > a.t && Math.abs(c.t - a.t) < 1,
        detail: `0 -> ${a.t} -> ${b.t} -> ${c.t}`,
      };
    });
    await check("playback", "frame step fwd / back", async () => {
      const a = await st();
      await page.click("#fwd");
      const b = await st();
      await page.click("#back");
      const c = await st();
      return {
        pass: Math.abs(b.t - a.t - 1000 / 30) < 0.5 && Math.abs(c.t - a.t) < 0.5,
        detail: `${a.t} -> ${b.t} -> ${c.t}`,
      };
    });
    await check("playback", "start / end buttons", async () => {
      await page.click("#end");
      const a = await st();
      await page.click("#start");
      const b = await st();
      return { pass: a.t === a.max && b.t === 0, detail: `end=${a.t}/${a.max} start=${b.t}` };
    });
    await check("playback", "seek by clicking timeline", async () => {
      const r = await center("#seek");
      await page.mouse.click(r.l + r.w * 0.5, r.y);
      await sleep(150);
      await blur();
      const a = await st();
      return {
        pass: Math.abs(a.t / a.max - 0.5) < 0.06,
        detail: `t=${a.t.toFixed(0)}/${a.max} (${(a.t / a.max).toFixed(3)})`,
      };
    });
    await check("playback", "seek by dragging timeline", async () => {
      const r = await center("#seek");
      await page.mouse.move(r.l + r.w * 0.2, r.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(r.l + r.w * (0.2 + i * 0.06), r.y);
      await page.mouse.up();
      await sleep(150);
      await blur();
      const a = await st();
      return {
        pass: Math.abs(a.t / a.max - 0.8) < 0.06 && a.play === "Play",
        detail: `t=${a.t.toFixed(0)}/${a.max} (${(a.t / a.max).toFixed(3)}) play=${a.play}`,
      };
    });
    const measure = async (speed) => {
      await page.select("#speed", speed);
      await page.click("#start");
      await page.click("#play");
      await sleep(300);
      const d = await page.evaluate(
        () =>
          new Promise((ok) => {
            const s = document.querySelector("#seek");
            const a = Number(s.value);
            const t0 = performance.now();
            setTimeout(() => ok({ dt: Number(s.value) - a, wall: performance.now() - t0 }), 1000);
          }),
      );
      await page.click("#play");
      return d;
    };
    await check("playback", "speed 1x vs 2x changes rate", async () => {
      const loop = (await st()).loop;
      if (loop) await page.click("label.toggle");
      const a = await measure("1");
      const b = await measure("2");
      const q = await measure("0.5");
      await page.select("#speed", "1");
      if (loop) await page.click("label.toggle");
      const r = b.dt / a.dt;
      return {
        pass: r > 1.8 && r < 2.2 && a.dt / a.wall > 0.9 && a.dt / a.wall < 1.1,
        detail: `1x: ${a.dt.toFixed(0)}ms/${a.wall.toFixed(0)}ms; 2x: ${b.dt.toFixed(0)}ms; 0.5x: ${q.dt.toFixed(0)}ms; ratio2/1=${r.toFixed(2)} dur=${(await st()).max}`,
      };
    });
    await check("playback", "loop on: wraps at end and keeps playing", async () => {
      if (!(await st()).loop) await page.click("label.toggle");
      const s0 = await st();
      await page.evaluate((m) => {
        const s = document.querySelector("#seek");
        s.value = String(m - 300);
        s.dispatchEvent(new Event("input", { bubbles: true }));
        s.blur();
      }, s0.max);
      await page.click("#play");
      await sleep(900);
      const a = await st();
      await page.click("#play");
      return {
        pass: a.loop && a.play === "Pause" && a.t < 1500,
        detail: `t=${a.t.toFixed(0)} play=${a.play}`,
      };
    });
    await check("playback", "loop off: stops at end", async () => {
      await page.click("label.toggle");
      const s0 = await st();
      await page.evaluate((m) => {
        const s = document.querySelector("#seek");
        s.value = String(m - 300);
        s.dispatchEvent(new Event("input", { bubbles: true }));
        s.blur();
      }, s0.max);
      await page.click("#play");
      await sleep(900);
      const a = await st();
      await page.click("label.toggle");
      return {
        pass: !a.loop && a.play === "Play" && a.t === a.max,
        detail: `loop=${a.loop} t=${a.t}/${a.max} play=${a.play}`,
      };
    });
    // keyboard shortcuts
    const key = async (k, mods = []) => {
      for (const m of mods) await page.keyboard.down(m);
      await page.keyboard.press(k);
      for (const m of mods.reverse()) await page.keyboard.up(m);
      await sleep(120);
      return st();
    };
    // Chrome/Edge refuse requestFullscreen ("not granted") while the window is not the foreground window
    await page.bringToFront();
    await page.focus("#canvas");
    await page.click("#start").then(() => page.focus("#canvas"));
    const ks = [
      [
        "Space play",
        async () => {
          const a = await key(" ");
          return { pass: a.play === "Pause", detail: a.play };
        },
      ],
      [
        "Space pause",
        async () => {
          const a = await key(" ");
          return { pass: a.play === "Play", detail: a.play };
        },
      ],
      [
        "Home",
        async () => {
          const a = await key("Home");
          return { pass: a.t === 0, detail: a.t };
        },
      ],
      [
        "ArrowRight +1s",
        async () => {
          const a = await key("ArrowRight");
          return { pass: Math.abs(a.t - 1000) < 1, detail: a.t };
        },
      ],
      [
        "ArrowLeft -1s",
        async () => {
          const a = await key("ArrowLeft");
          return { pass: a.t === 0, detail: a.t };
        },
      ],
      [
        "Shift+ArrowRight next event",
        async () => {
          const a = await key("ArrowRight", ["Shift"]);
          return { pass: a.t > 0, detail: a.t };
        },
      ],
      [
        "Shift+ArrowLeft prev event",
        async () => {
          await key("ArrowRight", ["Shift"]);
          const b = await st();
          const a = await key("ArrowLeft", ["Shift"]);
          return { pass: a.t < b.t, detail: `${b.t}->${a.t}` };
        },
      ],
      [
        ". frame fwd",
        async () => {
          const b = await st();
          const a = await key(".");
          return { pass: Math.abs(a.t - b.t - 33.33) < 0.5, detail: `${b.t}->${a.t}` };
        },
      ],
      [
        ", frame back",
        async () => {
          const b = await st();
          const a = await key(",");
          return { pass: Math.abs(b.t - a.t - 33.33) < 0.5, detail: `${b.t}->${a.t}` };
        },
      ],
      [
        "End",
        async () => {
          const a = await key("End");
          return { pass: a.t === a.max, detail: `${a.t}/${a.max}` };
        },
      ],
      [
        "+ zoom in",
        async () => {
          const a = await key("+");
          return { pass: a.fit === "140%", detail: a.fit };
        },
      ],
      [
        "- zoom out",
        async () => {
          const a = await key("-");
          return { pass: a.fit === "Fit", detail: a.fit };
        },
      ],
      [
        "0 fit",
        async () => {
          await key("+");
          await key("+");
          const a = await key("0");
          return { pass: a.fit === "Fit", detail: a.fit };
        },
      ],
      [
        "c auto camera toggle",
        async () => {
          const b = await st();
          const a = await key("c");
          const c = await key("c");
          return {
            pass: a.auto !== b.auto && c.auto === b.auto,
            detail: `${b.auto}->${a.auto}->${c.auto}`,
          };
        },
      ],
      [
        "l loop toggle",
        async () => {
          const b = await st();
          const a = await key("l");
          const c = await key("l");
          return {
            pass: a.loop !== b.loop && c.loop === b.loop,
            detail: `${b.loop}->${a.loop}->${c.loop}`,
          };
        },
      ],
      [
        "[ sidebar",
        async () => {
          const a = await key("[");
          const b = await key("[");
          return {
            pass: a.body.includes("side-collapsed") && !b.body.includes("side-collapsed"),
            detail: "",
          };
        },
      ],
      [
        "f fullscreen on/off",
        async () => {
          await key("f");
          await sleep(700);
          const a2 = await st();
          await shot("20-key-f-fullscreen");
          await key("f");
          await sleep(700);
          const b = await st();
          return { pass: a2.fs && !b.fs, detail: `fs after f=${a2.fs}, after 2nd f=${b.fs}` };
        },
      ],
      [
        "? opens shortcuts, Esc closes",
        async () => {
          await page.focus("#canvas");
          await key("?");
          const o = await page.$eval("#shortcuts-dialog", (d) => d.open);
          await shot("21-shortcuts");
          await key("Escape");
          const c = await page.$eval("#shortcuts-dialog", (d) => d.open);
          return { pass: o && !c, detail: `open=${o} afterEsc=${c}` };
        },
      ],
      [
        "Ctrl+Enter animates from editor",
        async () => {
          await setSource(
            "#tab-text",
            "Browser -> Edge Proxy -> Billing : POST /pay\nBilling ..> Ledger : Paid",
          );
          await page.focus("#source");
          await page.keyboard.down("Control");
          await page.keyboard.press("Enter");
          await page.keyboard.up("Control");
          await settle();
          const a = await st();
          return {
            pass: /Billing|Edge/.test(a.meta + a.title) || a.meta.startsWith("4 components"),
            detail: `title="${a.title}" meta="${a.meta}" errors=${a.errors}`,
          };
        },
      ],
    ];
    for (const [label, fn] of ks) {
      if (!label.startsWith("Ctrl")) await page.focus("#canvas");
      await check("shortcuts", label, fn);
    }

    // ---------------- presentation ----------------
    await page.select("#examples", "bench-text");
    await settle();
    await page.bringToFront();
    await page.bringToFront();
    await check(
      "presentation",
      "#present engages real fullscreen + floating transport",
      async () => {
        await page.click("#present");
        await sleep(900);
        const a = await st();
        const tv = await visible("#transport");
        await shot("30-present");
        return {
          pass: a.body.includes("presenting") && a.fs && tv,
          detail: `presenting=${a.body.includes("presenting")} fullscreenElement=${a.fs} transportVisible=${tv}`,
        };
      },
    );
    await page.bringToFront();
    await check("presentation", "idle after ~3 s hides controls", async () => {
      await sleep(3200);
      const a = await st();
      const op = await page.$eval("#transport", (e) => getComputedStyle(e).opacity);
      await shot("31-present-idle");
      return {
        pass: a.body.includes("idle") && Number(op) < 0.05,
        detail: `body="${a.body}" transportOpacity=${op}`,
      };
    });
    await page.bringToFront();
    await check("presentation", "mouse move shows controls", async () => {
      await page.mouse.move(400, 300);
      await page.mouse.move(420, 320);
      await sleep(500);
      const a = await st();
      const op = await page.$eval("#transport", (e) => getComputedStyle(e).opacity);
      return {
        pass: !a.body.includes("idle") && Number(op) > 0.5,
        detail: `body="${a.body}" opacity=${op}`,
      };
    });
    await page.bringToFront();
    await check("presentation", "Esc exits presentation AND fullscreen", async () => {
      await page.keyboard.press("Escape");
      await sleep(900);
      const a = await st();
      await shot("32-after-esc");
      return {
        pass: !a.body.includes("presenting") && !a.fs,
        detail: `body="${a.body}" fs=${a.fs}`,
      };
    });
    await page.bringToFront();
    await check("presentation", "#exit-present works", async () => {
      await page.click("#present");
      await sleep(900);
      const a = await st();
      await page.click("#exit-present");
      await sleep(900);
      const b = await st();
      return {
        pass: a.body.includes("presenting") && !b.body.includes("presenting") && !b.fs,
        detail: `in: fs=${a.fs}; out: body="${b.body}" fs=${b.fs}`,
      };
    });
    await page.bringToFront();
    await check("presentation", "P toggles presentation", async () => {
      await page.focus("#canvas");
      await page.keyboard.press("p");
      await sleep(900);
      const a = await st();
      await page.keyboard.press("p");
      await sleep(900);
      const b = await st();
      return {
        pass: a.body.includes("presenting") && !b.body.includes("presenting") && !b.fs,
        detail: `on: fs=${a.fs} presenting=${a.body.includes("presenting")}; off: fs=${b.fs} body="${b.body}"`,
      };
    });
    await page.bringToFront();
    await check("presentation", "reduced motion: Animate does not auto-play", async () => {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      const mq = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
      await page.click("#animate");
      await settle();
      await sleep(800);
      const a = await st();
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      return {
        pass: mq && a.play === "Play" && a.t === 0,
        detail: `matchMedia=${mq} play=${a.play} t=${a.t}`,
      };
    });

    // ---------------- diagnostics ----------------
    await check("diagnostics", "error: mermaid `pie title nope` + stale chip", async () => {
      await setSource("#tab-mermaid", "pie title nope");
      await page.click("#animate");
      await settle();
      await page.click("#side-tab-diagnostics");
      const a = await st();
      const badge = await page.$eval("#diag-badge", (e) => (e.hidden ? "hidden" : e.textContent));
      const first = await page.$$eval("#issues li", (l) =>
        l.map(
          (x) =>
            `${x.className}:${x.querySelector(".sev")?.textContent}:${x.querySelector(".issue-title")?.textContent}`,
        ),
      );
      await shot("40-diag-error");
      return {
        pass: a.errors > 0 && a.body.includes("stale") && /last valid/.test(a.chip),
        detail: `errors=${a.errors} body="${a.body}" chip="${a.chip}" badge=${badge} issues=${JSON.stringify(first)}`,
      };
    });
    await check("diagnostics", "Technical details expands", async () => {
      await page.click("#issues li details summary");
      const o = await page.$eval(
        "#issues li details",
        (d) => d.open && d.querySelector("code").getBoundingClientRect().height > 0,
      );
      const code = await page.$eval("#issues li details code", (c) => c.textContent);
      await shot("41-diag-details");
      return { pass: o, detail: `open=${o} code="${code.slice(0, 120)}"` };
    });
    await check("diagnostics", "fixing clears stale", async () => {
      await setSource("#tab-mermaid", "flowchart LR\n  A[Client] --> B[API]\n  B --> C[(DB)]");
      await page.click("#side-tab-diagram");
      await page.click("#animate");
      await settle();
      const a = await st();
      return {
        pass: a.errors === 0 && !a.body.includes("stale") && !/last valid/.test(a.chip),
        detail: `errors=${a.errors} body="${a.body}" chip="${a.chip}"`,
      };
    });
    await check("diagnostics", "aws-alb shows warnings/info", async () => {
      await page.select("#examples", "aws-alb");
      await settle();
      await page.click("#side-tab-diagnostics");
      const a = await st();
      const items = await page.$$eval("#issues li", (l) =>
        l.map((x) => `${x.className}:${x.querySelector(".issue-title")?.textContent}`),
      );
      const cnt = await page.$eval("#issue-count", (e) => e.textContent);
      await shot("42-diag-aws-alb");
      return {
        pass: a.errors === 0 && a.warnings + a.infos > 0,
        detail: `count="${cnt}" items=${JSON.stringify(items)}`,
      };
    });

    // ---------------- responsive ----------------
    for (const [w, h, side] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [1280, 720, 640],
      [1024, 768, 443],
    ]) {
      await check(
        "responsive",
        `${w}x${h}${side ? ` sidebar=${side}px (persisted)` : " default prefs"}`,
        async () => {
          await page.setViewport({ width: w, height: h });
          await page.evaluate((side) => {
            localStorage.clear();
            localStorage.setItem("archflow.welcomed", "1");
            if (side) localStorage.setItem("archflow.sidebarWidth", String(side));
          }, side ?? 0);
          await page.reload({ waitUntil: "load" });
          await ready();
          await sleep(400);
          const m = await page.evaluate(() => {
            const de = document.documentElement;
            const vw = de.clientWidth;
            const ids = [
              "toggle-sidebar",
              "open-examples",
              "open-shortcuts",
              "workspace-theme",
              "present",
              "open-export",
              "side-tab-diagram",
              "side-tab-scenario",
              "side-tab-diagnostics",
              "tab-text",
              "tab-mermaid",
              "tab-drawio",
              "tab-plantuml",
              "tab-json",
              "source",
              "animate",
              "examples",
              "zoom-out",
              "zoom-fit",
              "zoom-in",
              "view-menu",
              "fullscreen",
              "start",
              "prev",
              "back",
              "play",
              "fwd",
              "next",
              "end",
              "seek",
              "time",
              "speed",
              "loop",
            ];
            const bad = [];
            for (const id of ids) {
              const e = document.getElementById(id);
              let r = e.getBoundingClientRect();
              let t = e;
              if (id === "loop" || id === "speed") {
                t = e.closest("label");
                r = t.getBoundingClientRect();
              }
              if (r.width === 0 || r.height === 0) {
                bad.push(`${id}:zero-size`);
                continue;
              }
              if (r.left < -1 || r.right > vw + 1)
                bad.push(`${id}:outside-x(${r.left.toFixed(0)}..${r.right.toFixed(0)})`);
              if (r.width < 24 || r.height < 24)
                if (id !== "seek" && id !== "time")
                  bad.push(`${id}:small(${r.width.toFixed(0)}x${r.height.toFixed(0)})`);
              const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
              const cy = r.top + r.height / 2;
              if (cy >= 0 && cy < innerHeight) {
                const hit = document.elementFromPoint(cx, cy);
                if (
                  hit &&
                  !t.contains(hit) &&
                  !hit.contains(t) &&
                  !t.closest("label")?.contains(hit)
                )
                  bad.push(`${id}:covered-by(${hit.id || hit.className || hit.tagName})`);
              }
              const s = getComputedStyle(e);
              if (e.scrollWidth > e.clientWidth + 1 && s.overflowX === "hidden" && id !== "source")
                bad.push(`${id}:text-clipped`);
            }
            return {
              sw: de.scrollWidth,
              cw: de.clientWidth,
              bsw: document.body.scrollWidth,
              sh: de.scrollHeight,
              ch: de.clientHeight,
              bad,
            };
          });
          await shot(`50-responsive-${w}x${h}${side ? `-side${side}` : ""}`);
          if (h >= 800 || w < 800)
            await page
              .screenshot({
                path: join(dir, `50-responsive-${w}x${h}${side ? `-side${side}` : ""}-full.png`),
                fullPage: true,
              })
              .catch(() => {});
          const noH = m.sw <= m.cw && m.bsw <= m.cw;
          return {
            pass: noH && (w < 1280 || m.bad.length === 0),
            detail: `scrollW=${m.sw} bodyW=${m.bsw} clientW=${m.cw} scrollH=${m.sh}/${m.ch} issues=${JSON.stringify(m.bad)}`,
          };
        },
      );
    }
    await page.setViewport({ width: 1366, height: 768 });
    await collectCsp();
  } catch (e) {
    logs.push(`suite aborted: ${e?.stack ?? e}`);
    console.log(`[${name}] aborted: ${e}`);
  }
  await collectCsp();
  await browser.close().catch(() => {});
  writeFileSync(join(dir, "results.json"), JSON.stringify(rec, null, 2));
}

writeFileSync(join(OUT, "results.json"), JSON.stringify(all, null, 2));
const lines = [];
for (const [n, r] of Object.entries(all)) {
  lines.push(`## ${n} ${r.version ?? "(not launched)"}`);
  if (r.launchError) lines.push(`launch error: ${r.launchError.split("\n")[0]}`);
  for (const x of r.results)
    lines.push(`${x.pass ? "PASS" : "FAIL"} ${x.area} / ${x.label} ${x.detail}`);
  lines.push(`logs (${r.logs.length}):`, ...r.logs.map((l) => `  ${l}`));
}
writeFileSync(join(OUT, "summary.txt"), lines.join("\n") + "\n");
server.close();
console.log("done");
