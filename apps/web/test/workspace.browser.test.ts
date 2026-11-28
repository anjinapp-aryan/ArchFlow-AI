import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch } from "@archflow/qa";

/**
 * The workspace around the animation (production build): first-time experience, sidebar,
 * diagnostics, playback toolbar, manual vs automatic camera, presentation mode, export dialog,
 * responsive layout and accessibility basics. app.browser.test.ts covers the animation itself.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let server: Server;
let base = "";
let browser: Browser;
const problems: string[] = [];

beforeAll(async () => {
  const b = spawnSync(process.execPath, [resolve(repoRoot, "apps/web/build.mjs")], {
    encoding: "utf8",
  });
  if (b.status !== 0) throw new Error(`web build failed: ${b.stderr}`);
  const mod = (await import(resolve(repoRoot, "scripts/serve-web.mjs"))) as {
    startServer(p: number): Promise<Server>;
  };
  server = await mod.startServer(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
  browser = (await launch()).browser;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** A fresh visitor (empty storage) at the given window size, with the app ready. */
async function open(width = 1366, height = 768): Promise<Page> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warn") && !m.text().includes("willReadFrequently"))
      problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${(e as Error).message}`));
  await page.setViewport({ width, height });
  await page.goto(base, { waitUntil: "load" });
  await ready(page);
  return page;
}
const ready = (page: Page): Promise<unknown> =>
  page.waitForFunction(
    () =>
      !(document.querySelector("#animate") as HTMLButtonElement).disabled &&
      (document.querySelector("#placeholder") as HTMLElement).hidden,
    { timeout: 30_000 },
  );
const frame = (page: Page): Promise<unknown> =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const rect = (page: Page, sel: string) =>
  page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  });
const text = (page: Page, sel: string): Promise<string> =>
  page.$eval(sel, (e) => ((e as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim());
const dismissWelcome = async (page: Page): Promise<void> => {
  if (!(await page.$eval("#welcome", (e) => (e as HTMLElement).hidden)))
    await page.click("#welcome-close");
  // closing the welcome card hands focus to the canvas
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("canvas");
};
describe("workspace (production build)", () => {
  it("first visit: three ways to start, an example gallery, and it is remembered", async () => {
    const page = await open();
    expect(await page.$eval("#welcome", (e) => (e as HTMLElement).hidden)).toBe(false);
    for (const id of ["start-describe", "start-import", "start-examples"])
      expect(await page.$(`#${id}`), id).not.toBeNull();
    // the benchmark is already loaded behind the welcome card (the canvas is never empty)
    expect(await text(page, "#doc-title")).toBe("Order flow benchmark");
    await page.click("#start-examples");
    const cards = await page.$$eval("#gallery button", (b) =>
      b.map((x) => (x as HTMLElement).dataset["sample"]),
    );
    const options = await page.$$eval("#examples option", (o) =>
      (o as HTMLOptionElement[]).map((x) => x.value).filter(Boolean),
    );
    expect(cards).toEqual(options);
    await page.click('#gallery button[data-sample="aws-alb"]');
    await ready(page);
    await frame(page);
    expect(await page.$eval("#welcome", (e) => (e as HTMLElement).hidden)).toBe(true);
    expect(await page.$eval("#examples", (e) => (e as HTMLSelectElement).value)).toBe("aws-alb");
    expect(await text(page, "#doc-title")).toMatch(/load balancer|ALB/i);
    expect(await text(page, "#doc-meta")).toMatch(/\d+ components · \d+\.\d s · Description/);
    // a second visit goes straight to the workspace
    await page.reload({ waitUntil: "load" });
    await ready(page);
    expect(await page.$eval("#welcome", (e) => (e as HTMLElement).hidden)).toBe(true);
    // the header "Examples" button reopens the gallery
    await page.click("#open-examples");
    expect(await page.$eval("#welcome-gallery", (e) => (e as HTMLElement).hidden)).toBe(false);
    await page.keyboard.press("Escape");
    expect(await page.$eval("#welcome", (e) => (e as HTMLElement).hidden)).toBe(true);
    await page.browserContext().close();
  });

  it("describe: focuses the editor on the Describe format", async () => {
    const page = await open();
    await page.click("#start-describe");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("source");
    expect(await page.$eval("#tab-text", (e) => e.getAttribute("aria-pressed"))).toBe("true");
    await page.$eval(
      "#source",
      (e) => ((e as HTMLTextAreaElement).value = "Web -> API -> DB : SELECT\n"),
    );
    await page.keyboard.down("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Control");
    await page.waitForFunction(() =>
      document.querySelector("#doc-meta")?.textContent?.startsWith("3 components"),
    );
    await page.browserContext().close();
  });

  it("diagnostics: plain-language messages with severity words, codes in the details", async () => {
    const page = await open();
    await dismissWelcome(page);
    await page.select("#examples", "aws-alb");
    await ready(page);
    await page.click("#side-tab-diagnostics");
    const items = await page.$$eval("#issues li", (l) =>
      l.map((li) => ({
        level: li.className,
        sev: li.querySelector(".sev")?.textContent,
        title: li.querySelector(".issue-title")?.textContent,
        code: li.querySelector("details code")?.textContent,
        open: (li.querySelector("details") as HTMLDetailsElement).open,
      })),
    );
    expect(items.map((i) => i.title)).toContain("Health monitoring detected");
    expect(items.map((i) => i.title)).toContain("Request routed to one target");
    for (const i of items) {
      expect(i.sev).toMatch(/^(Error|Warning|Information)$/);
      expect(i.title).not.toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(i.code).toMatch(/^[a-z]+\.[a-z_]+/);
      expect(i.open).toBe(false); // technical details are collapsed
    }
    expect(await text(page, "#issue-count")).toMatch(/^Valid · \d+ warnings? · \d+ notes?$/);
    expect(await text(page, "#diag-badge")).toMatch(/^\d+$/);
    // an error: status, badge and the line under the editor say so
    await page.click("#side-tab-diagram");
    await page.click("#tab-mermaid");
    await page.$eval("#source", (e) => ((e as HTMLTextAreaElement).value = "pie title nope\n"));
    await page.click("#animate");
    await page.waitForSelector("#issues li.error");
    expect(await text(page, "#validity")).toContain(
      "Cannot animate: Unsupported Mermaid diagram type",
    );
    expect(await page.$eval("#diag-badge", (e) => e.className)).toContain("error");
    await page.click("#validity button");
    expect(await page.$eval("#side-tab-diagnostics", (e) => e.getAttribute("aria-selected"))).toBe(
      "true",
    );
    expect(await text(page, "#issue-count")).toMatch(/^Cannot animate · 1 error/);
    // the canvas keeps the last valid animation and says so; fixing the source clears it
    expect(await text(page, "#view-chip")).toMatch(/^Showing the last valid animation/);
    expect(await page.evaluate(() => document.body.classList.contains("stale"))).toBe(true);
    expect(await page.$eval("#source", (e) => e.getAttribute("aria-invalid"))).toBe("true");
    await page.select("#examples", "bench-text");
    await ready(page);
    expect(await page.evaluate(() => document.body.classList.contains("stale"))).toBe(false);
    expect(await page.$eval("#source", (e) => e.getAttribute("aria-invalid"))).toBe("false");
    await page.browserContext().close();
  });

  it("sidebar: tabs, keyboard resizing, collapsing gives the canvas the room", async () => {
    const page = await open(1366, 768);
    await dismissWelcome(page);
    const canvas0 = await rect(page, "#canvas");
    const side0 = await rect(page, "#sidebar");
    // arrow keys on the tablist move between tabs
    await page.focus("#side-tab-diagram");
    await page.keyboard.press("ArrowRight");
    expect(await page.$eval("#side-tab-scenario", (e) => e.getAttribute("aria-selected"))).toBe(
      "true",
    );
    expect(await page.$eval("#pane-scenario", (e) => (e as HTMLElement).hidden)).toBe(false);
    expect(await page.$eval("#pane-diagram", (e) => (e as HTMLElement).hidden)).toBe(true);
    // resize with the keyboard
    await page.focus("#resizer");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    const side1 = await rect(page, "#sidebar");
    expect(side1.w).toBeGreaterThan(side0.w + 50);
    expect(await page.$eval("#resizer", (e) => Number(e.getAttribute("aria-valuenow")))).toBe(
      Math.round(side1.w),
    );
    // collapse: the canvas takes the width
    await page.click("#toggle-sidebar");
    await frame(page);
    expect(await page.$eval("#toggle-sidebar", (e) => e.getAttribute("aria-expanded"))).toBe(
      "false",
    );
    const canvas1 = await rect(page, "#canvas");
    expect(canvas1.w).toBeGreaterThan(canvas0.w + 250);
    expect(canvas1.w).toBeGreaterThan(1366 - 20);
    // "[" brings it back, at the resized width (remembered)
    await page.focus("#canvas");
    await page.keyboard.press("[");
    await frame(page);
    expect((await rect(page, "#sidebar")).w).toBeCloseTo(side1.w, 0);
    await page.reload({ waitUntil: "load" });
    await ready(page);
    expect((await rect(page, "#sidebar")).w).toBeCloseTo(side1.w, 0);
    await page.browserContext().close();
  });

  it("playback toolbar: start, end, events, play state, loop key, accessible position", async () => {
    const page = await open();
    await dismissWelcome(page);
    // the time display is updated on the next animation frame
    const time = async (): Promise<number> => {
      await frame(page);
      return parseFloat(await text(page, "#time"));
    };
    await page.click("#end");
    await frame(page);
    const dur = parseFloat((await text(page, "#time")).split("/")[1]!);
    expect(await time()).toBe(dur);
    expect(await page.$eval("#play", (e) => e.getAttribute("aria-label"))).toBe("Play");
    await page.click("#start");
    expect(await time()).toBe(0);
    await page.click("#next");
    const t1 = await time();
    expect(t1).toBeGreaterThan(0);
    await page.click("#prev");
    expect(await time()).toBeLessThan(t1);
    await page.click("#play");
    await new Promise((r) => setTimeout(r, 300));
    expect(await page.$eval("#play", (e) => e.getAttribute("aria-label"))).toBe("Pause");
    await page.click("#play");
    expect(await page.$eval("#seek", (e) => e.getAttribute("aria-valuetext"))).toMatch(
      /^\d+\.\d of \d+\.\d seconds$/,
    );
    const loop = await page.$eval("#loop", (e) => (e as HTMLInputElement).checked);
    await page.focus("#canvas");
    await page.keyboard.press("l");
    expect(await page.$eval("#loop", (e) => (e as HTMLInputElement).checked)).toBe(!loop);
    // timeline marks: one per event time, failures marked
    expect(await page.$$eval("#ticks span", (s) => s.length)).toBeGreaterThan(5);
    expect(await page.$$eval("#ticks span.fail", (s) => s.length)).toBeGreaterThan(0);
    await page.browserContext().close();
  });

  it("manual view and automatic camera are distinct and visible", async () => {
    const page = await open();
    await dismissWelcome(page);
    // the automatic camera is the normal state: its switch is on, no chip is shown
    expect(await text(page, "#view-chip")).toBe("");
    await page.click("#zoom-in");
    expect(await text(page, "#view-chip")).toMatch(/^Manual view · 140%/);
    expect(await page.$eval("#auto-camera", (e) => (e as HTMLInputElement).checked)).toBe(false);
    await page.click("#zoom-fit");
    expect(await text(page, "#view-chip")).toBe("Whole diagram · auto camera off");
    await page.focus("#canvas");
    await page.keyboard.press("c");
    expect(await page.$eval("#auto-camera", (e) => (e as HTMLInputElement).checked)).toBe(true);
    // the automatic camera is the normal state: its switch is on, no chip is shown
    expect(await text(page, "#view-chip")).toBe("");
    // the camera chip and the toolbar never overlap
    const a = await rect(page, "#view-chip");
    const b = await rect(page, ".canvas-tools");
    expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
    await page.browserContext().close();
  });

  it("presentation mode: canvas fills the window, playback stays, Escape leaves", async () => {
    const page = await open(1920, 1080);
    await dismissWelcome(page);
    await page.click("#present");
    await frame(page);
    expect(await page.evaluate(() => document.body.classList.contains("presenting"))).toBe(true);
    const c = await rect(page, "#canvas");
    const vw = await page.evaluate(() => [innerWidth, innerHeight]);
    expect(c.w).toBeGreaterThanOrEqual(vw[0]! - 1);
    expect(c.h).toBeGreaterThanOrEqual(vw[1]! - 1);
    expect((await rect(page, "#sidebar")).w).toBe(0);
    expect(await page.$eval(".top", (e) => getComputedStyle(e).visibility)).toBe("hidden");
    // essential playback controls stay usable
    await page.click("#play");
    await new Promise((r) => setTimeout(r, 300));
    expect(await page.$eval("#play", (e) => e.getAttribute("aria-label"))).toBe("Pause");
    await page.keyboard.press("Space");
    await frame(page);
    expect(await page.$eval("#play", (e) => e.getAttribute("aria-label"))).toBe("Play");
    await page.keyboard.press("Escape");
    await frame(page);
    expect(await page.evaluate(() => document.body.classList.contains("presenting"))).toBe(false);
    expect((await rect(page, "#sidebar")).w).toBeGreaterThan(250);
    // P toggles it from the keyboard
    await page.focus("#canvas");
    await page.keyboard.press("p");
    expect(await page.evaluate(() => document.body.classList.contains("presenting"))).toBe(true);
    await page.keyboard.press("p");
    expect(await page.evaluate(() => document.body.classList.contains("presenting"))).toBe(false);
    await page.browserContext().close();
  });

  it("export dialog: settings, honest information, Escape closes it", async () => {
    const page = await open();
    await dismissWelcome(page);
    await page.click("#open-export");
    expect(await page.$eval("#export-dialog", (d) => (d as HTMLDialogElement).open)).toBe(true);
    expect(await page.$eval("#format", (e) => (e as HTMLSelectElement).value)).toBe("webm");
    const info = await text(page, "#export-info");
    expect(info).toMatch(/Duration \d+\.\d s · \d+ frames/);
    expect(info).toContain("Camera Automatic, as in playback");
    expect(info).toContain("File Order-flow-benchmark.webm");
    await page.select("#fps", "60");
    expect(await text(page, "#export-info")).toMatch(/· (\d+) frames/);
    await page.keyboard.press("Escape");
    expect(await page.$eval("#export-dialog", (d) => (d as HTMLDialogElement).open)).toBe(false);
    // with the automatic camera off, the dialog says the whole diagram is exported
    await page.click("#zoom-in");
    await page.click("#open-export");
    expect(await text(page, "#export-info")).toContain("Whole diagram (auto camera off");
    await page.browserContext().close();
  });

  it("workspace theme is independent of the animation theme", async () => {
    const page = await open();
    await dismissWelcome(page);
    const corner = (): Promise<number[]> =>
      page.$eval("#canvas", (c) => [
        ...(c as HTMLCanvasElement).getContext("2d")!.getImageData(2, 2, 1, 1).data.slice(0, 3),
      ]);
    const before = await corner();
    const bg0 = await page.$eval(".sidebar", (e) => getComputedStyle(e).backgroundColor);
    await page.click("#workspace-theme"); // system -> light
    expect(await page.evaluate(() => document.documentElement.dataset["theme"])).toBe("light");
    await page.click("#workspace-theme"); // light -> dark
    expect(await page.evaluate(() => document.documentElement.dataset["theme"])).toBe("dark");
    const bg1 = await page.$eval(".sidebar", (e) => getComputedStyle(e).backgroundColor);
    await page.click("#workspace-theme"); // back to system
    await page.click("#workspace-theme"); // light
    const bgLight = await page.$eval(".sidebar", (e) => getComputedStyle(e).backgroundColor);
    expect(bgLight).not.toBe(bg1);
    expect(bg0 === bg1 || bg0 === bgLight).toBe(true);
    await frame(page);
    expect(await corner()).toEqual(before);
    await page.browserContext().close();
  });

  for (const [w, h] of [
    [1920, 1080],
    [1600, 900],
    [1366, 768],
    [1280, 720],
  ] as const)
    it(`responsive ${w}x${h}: no overflow, controls on screen, canvas is the largest area`, async () => {
      const page = await open(w, h);
      await dismissWelcome(page);
      const r = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const H = document.documentElement.clientHeight;
        const off: string[] = [];
        for (const el of document.querySelectorAll(
          ".top button, .transport button, .transport select, .transport label, .canvas-tools button, .canvas-tools label, .side-tabs button, .pane-actions button, .pane-actions label",
        )) {
          const b = el.getBoundingClientRect();
          if (el.closest("[hidden]") || b.width === 0) continue;
          if (b.left < 0 || b.right > W + 0.5 || b.top < 0 || b.bottom > H + 0.5)
            off.push(el.id || el.className);
        }
        const c = document.querySelector("#canvas")!.getBoundingClientRect();
        return {
          scrollW: document.documentElement.scrollWidth,
          scrollH: document.documentElement.scrollHeight,
          W,
          H,
          off,
          canvasShare: (c.width * c.height) / (W * H),
        };
      });
      expect(r.scrollW).toBeLessThanOrEqual(r.W);
      expect(r.scrollH).toBeLessThanOrEqual(r.H);
      expect(r.off).toEqual([]);
      expect(r.canvasShare).toBeGreaterThan(0.55);
      // the toolbar and the chip do not collide; the transport is one row
      const a = await rect(page, "#view-chip");
      const t = await rect(page, ".canvas-tools");
      expect(a.right <= t.x || t.right <= a.x || a.bottom <= t.y || t.bottom <= a.y).toBe(true);
      expect((await rect(page, "#transport")).h).toBeLessThan(60);
      // all scenario controls reachable without scrolling the page
      await page.click("#side-tab-scenario");
      expect((await rect(page, "#apply")).bottom).toBeLessThanOrEqual(h);
      await page.browserContext().close();
    });

  it("accessibility basics: names, labels, focus, contrast", async () => {
    const page = await open();
    await dismissWelcome(page);
    const r = await page.evaluate(() => {
      const name = (e: Element): string =>
        (
          e.getAttribute("aria-label") ??
          (e.getAttribute("aria-labelledby")
            ? document.getElementById(e.getAttribute("aria-labelledby")!)?.textContent
            : null) ??
          e.textContent ??
          ""
        ).trim();
      const unnamed = [...document.querySelectorAll("button")]
        .filter((b) => !b.closest("[hidden]"))
        .filter((b) => !name(b))
        .map((b) => b.id || b.outerHTML.slice(0, 60));
      const unlabelled = [...document.querySelectorAll("select, input, textarea")]
        .filter((e) => (e as HTMLInputElement).type !== "file")
        .filter(
          (e) =>
            !e.getAttribute("aria-label") &&
            !(e as HTMLInputElement).labels?.length &&
            !e.getAttribute("aria-labelledby"),
        )
        .map((e) => e.id);
      // icon-only buttons explain themselves on hover
      const noTip = [...document.querySelectorAll(".icon-btn")]
        .filter((b) => !b.closest("[hidden]") && !b.getAttribute("title"))
        .map((b) => b.id);
      // text contrast of the main tokens (WCAG AA 4.5:1)
      const rgb = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: number[]): number => {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const ratio = (a: string, b: string): number => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
        return (x! + 0.05) / (y! + 0.05);
      };
      const css = getComputedStyle(document.querySelector(".sidebar")!);
      const probe = (v: string): string => {
        const d = document.createElement("span");
        d.style.color = `var(${v})`;
        document.body.append(d);
        const c = getComputedStyle(d).color;
        d.remove();
        return c;
      };
      const surface = css.backgroundColor;
      return {
        unnamed,
        unlabelled,
        noTip,
        contrast: {
          ink: ratio(probe("--ink"), surface),
          muted: ratio(probe("--muted"), surface),
          accentOnAccent: ratio(probe("--accent-ink"), probe("--accent")),
        },
      };
    });
    expect(r.unnamed).toEqual([]);
    expect(r.unlabelled).toEqual([]);
    expect(r.noTip).toEqual([]);
    expect(r.contrast.ink).toBeGreaterThan(7);
    expect(r.contrast.muted).toBeGreaterThan(4.5);
    expect(r.contrast.accentOnAccent).toBeGreaterThan(4.5);
    // keyboard: from the top of the page, Tab reaches the skip link first; focus is visible
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("skip");
    const outline = await page.$eval("#canvas", (c) => {
      (c as HTMLElement).focus();
      return getComputedStyle(c).outlineStyle;
    });
    expect(outline).not.toBe("none");
    await page.browserContext().close();
  });

  it("diagnostics lead to the diagram: highlight, frame, back to overview", async () => {
    const page = await open();
    await dismissWelcome(page);
    await page.select("#examples", "aws-alb");
    await ready(page);
    await page.click("#play"); // pause: compare still frames
    await frame(page);
    const shot = (): Promise<string> =>
      page.$eval("#canvas", (c) => (c as HTMLCanvasElement).toDataURL());
    const before = await shot();
    const chipBefore = await text(page, "#view-chip");
    await page.click("#side-tab-diagnostics");
    const show = await page.$$eval("#issues li", (l) =>
      l.findIndex(
        (li) =>
          li.querySelector(".issue-title")?.textContent === "Request routed to one target" &&
          li.querySelector('[data-action="show"]'),
      ),
    );
    expect(show).toBeGreaterThanOrEqual(0);
    const buttons = await page.$$("#issues li");
    await (await buttons[show]!.$('[data-action="show"]'))!.click();
    await frame(page);
    expect(await text(page, "#view-chip")).toMatch(/^Highlighted: (Auth|Web)/);
    expect(await page.$eval("#back-overview", (e) => (e as HTMLElement).hidden)).toBe(false);
    expect(await page.$eval("#auto-camera", (e) => (e as HTMLInputElement).checked)).toBe(false);
    expect(await shot()).not.toBe(before);
    // the highlight outline is really drawn (amber #ffc83d pixels around the components)
    const amber = await page.$eval("#canvas", (c) => {
      const d = (c as HTMLCanvasElement)
        .getContext("2d")!
        .getImageData(0, 0, (c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! > 235 && d[i + 1]! > 180 && d[i + 1]! < 215 && d[i + 2]! < 90) n++;
      return n;
    });
    expect(amber).toBeGreaterThan(500);
    // messages about the whole diagram say so instead of highlighting something wrong
    const nomap = await page.$$eval("#issues .issue-nomap", (l) => l.map((x) => x.textContent));
    for (const t of nomap) expect(t).toMatch(/whole diagram|not unique|No animation/);
    await page.click("#back-overview");
    await frame(page);
    expect(await text(page, "#view-chip")).toBe(chipBefore);
    expect(await page.$eval("#back-overview", (e) => (e as HTMLElement).hidden)).toBe(true);
    expect(await page.$eval("#auto-camera", (e) => (e as HTMLInputElement).checked)).toBe(true);
    expect(await shot()).toBe(before);
    await page.browserContext().close();
  });

  it("editor: line numbers, marked lines, go to line", async () => {
    const page = await open();
    await dismissWelcome(page);
    await page.click("#tab-text");
    await page.$eval(
      "#source",
      (e) => ((e as HTMLTextAreaElement).value = "A -> B\nthis line ??? is not a link\nB -> C\n"),
    );
    await page.click("#animate");
    await ready(page);
    expect(await page.$$eval("#gutter span", (s) => s.map((x) => x.textContent))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(await page.$$eval("#gutter span", (s) => s.map((x) => x.className))).toEqual([
      "",
      "warning",
      "",
      "",
    ]);
    expect(await page.$$eval("#bands .band", (b) => b.length)).toBe(1);
    await page.click("#side-tab-diagnostics");
    await page.click('#issues [data-action="line"]');
    expect(await page.$eval("#side-tab-diagram", (e) => e.getAttribute("aria-selected"))).toBe(
      "true",
    );
    const sel = await page.$eval("#source", (e) => {
      const t = e as HTMLTextAreaElement;
      return [document.activeElement === t, t.value.slice(t.selectionStart, t.selectionEnd)];
    });
    expect(sel).toEqual([true, "this line ??? is not a link"]);
    // editing moves lines: old marks are removed
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    expect(await page.$$eval("#bands .band", (b) => b.length)).toBe(0);
    // gutter and text stay aligned: line 3 is at the same height in both
    const align = await page.evaluate(() => {
      const g = document.querySelectorAll("#gutter span")[2]!.getBoundingClientRect();
      const t = document.querySelector("#source")!.getBoundingClientRect();
      return g.top - t.top;
    });
    expect(align).toBeCloseTo(10 + 2 * 19, 0);
    await page.browserContext().close();
  });

  it("focus and announcements: gallery returns focus, popover closes on Tab, zoom is quiet", async () => {
    const page = await open();
    await dismissWelcome(page);
    await page.focus("#open-examples");
    await page.keyboard.press("Enter");
    expect(await page.$eval("#welcome", (e) => (e as HTMLElement).hidden)).toBe(false);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("open-examples");
    // the view popover closes once focus leaves it
    await page.click("#view-menu");
    expect(await page.$eval("#view-pop", (e) => (e as HTMLElement).hidden)).toBe(false);
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    expect(await page.$eval("#view-pop", (e) => (e as HTMLElement).hidden)).toBe(true);
    // the visible chip is not a live region; only mode changes are announced
    expect(await page.$eval("#view-chip", (e) => e.getAttribute("aria-live"))).toBeNull();
    await page.focus("#canvas");
    await page.keyboard.press("+");
    await frame(page);
    const first = await text(page, "#view-announce");
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await frame(page);
    expect(first).toBe("Manual view");
    expect(await text(page, "#view-announce")).toBe("Manual view");
    expect(await text(page, "#view-chip")).toMatch(/^Manual view · \d+%/);
    await page.browserContext().close();
  });

  it("the local server answers a malformed URL with 400 and keeps running", async () => {
    const bad = await fetch(base + "%E0%A4%A");
    expect(bad.status).toBe(400);
    expect((await fetch(base)).status).toBe(200);
  });

  for (const [w, h, side] of [
    [390, 844, 0],
    [768, 1024, 0],
    [1024, 768, 443],
  ] as const)
    it(`small screens ${w}x${h}${side ? ` (saved sidebar ${side}px)` : ""}: no sideways scroll, header and transport fit`, async () => {
      const page = await open(w, h);
      if (side) {
        await page.evaluate((v) => localStorage.setItem("sidebarWidth", String(v)), side);
        await page.reload({ waitUntil: "load" });
        await ready(page);
      }
      // the welcome covers the window and the page is not scrolled behind it
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await dismissWelcome(page);
      const r = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const off: string[] = [];
        for (const el of document.querySelectorAll(
          ".top button, .transport button, .transport select, .transport label",
        )) {
          const b = el.getBoundingClientRect();
          if (el.closest("[hidden]") || b.width === 0) continue;
          if (b.left < 0 || b.right > W + 0.5 || b.width < 24) off.push(el.id || el.className);
        }
        return { scrollW: document.documentElement.scrollWidth, W, off };
      });
      expect(r.scrollW).toBeLessThanOrEqual(r.W);
      expect(r.off).toEqual([]);
      await page.browserContext().close();
    });

  it("presentation: the checked loop toggle stays visible", async () => {
    const page = await open();
    await dismissWelcome(page);
    await page.click("#present");
    await frame(page);
    const c = await page.$eval("#loop", (i) => {
      const l = i.closest("label")!;
      const s = getComputedStyle(l);
      return { checked: (i as HTMLInputElement).checked, bg: s.backgroundColor, fg: s.color };
    });
    expect(c.checked).toBe(true);
    // icon colour and background differ (they were both near-white before the fix)
    expect(c.bg).not.toBe(c.fg);
    expect(c.bg).not.toMatch(/^rgb\(2[3-5]\d, 2[3-5]\d, 2[3-5]\d\)$/);
    await page.keyboard.press("Escape");
    await page.browserContext().close();
  });

  it("no console errors or CSP violations on any of these screens", () => {
    expect(problems).toEqual([]);
  });
});
