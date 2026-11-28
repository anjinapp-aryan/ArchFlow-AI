import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCanonical } from "@archflow/canonical-model";
import { launch } from "@archflow/qa";

/**
 * End-to-end test of the PRODUCTION build, served with its real `_headers` (CSP included).
 * Set ARCHFLOW_BASE_URL (e.g. the deployed workers.dev URL) to run the same checks against a
 * live deployment instead of a local build: `npm run smoke:live`.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const liveUrl = process.env.ARCHFLOW_BASE_URL;
let server: Server | undefined;
let base = "";
let browser: Browser;
let page: Page;
const problems: string[] = [];
let downloads = "";

beforeAll(async () => {
  if (liveUrl) {
    base = liveUrl.endsWith("/") ? liveUrl : `${liveUrl}/`;
  } else {
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
  }
  browser = (await launch()).browser;
  page = await browser.newPage();
  page.on("console", (m) => {
    // the readback warning is caused by this test's own getImageData sampling, not by the app
    if ((m.type() === "error" || m.type() === "warn") && !m.text().includes("willReadFrequently"))
      problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${(e as Error).message}`));
  downloads = mkdtempSync(join(tmpdir(), "archflow-dl-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => !document.querySelector("#placeholder:not([hidden])"), {
    timeout: 20_000,
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (downloads) rmSync(downloads, { recursive: true, force: true });
});

const canvasVariance = (): Promise<number> =>
  page.evaluate(() => {
    const c = document.querySelector("#canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97)
      seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  });

async function waitForFile(ext: string, timeoutMs = 90_000): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const f = readdirSync(downloads).find((x) => x.endsWith(ext));
    if (f) return join(downloads, f);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${ext} download`);
}

describe("web app (production build)", () => {
  it("is served with a strict CSP and security headers", async () => {
    const r = await fetch(base);
    expect(r.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'wasm-unsafe-eval'",
    );
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await r.text();
    expect(html).not.toMatch(/<script>(?!\s*<\/script>)/);
    const asset = /src="(assets\/app-[0-9a-f]+\.js)"/.exec(html)![1]!;
    expect((await fetch(base + asset)).headers.get("cache-control")).toContain("immutable");
  });

  it("starts with the benchmark loaded and draws it, without console errors or CSP violations", async () => {
    expect(await canvasVariance()).toBeGreaterThan(5);
    expect(problems).toEqual([]);
  });

  it("transport: play advances time, pause stops it, seek and event stepping move it", async () => {
    const time = () => page.$eval("#time", (e) => parseFloat(e.textContent ?? "0"));
    await page.click("#play");
    await new Promise((r) => setTimeout(r, 800));
    const t1 = await time();
    expect(t1).toBeGreaterThan(0.2);
    await page.click("#play");
    const t2 = await time();
    await new Promise((r) => setTimeout(r, 500));
    expect(await time()).toBe(t2);
    await page.click("#next");
    await new Promise((r) => setTimeout(r, 100));
    expect(await time()).toBeGreaterThan(t2);
    await page.keyboard.press("Home");
    await new Promise((r) => setTimeout(r, 100));
    expect(await time()).toBe(0);
  });

  it("every example loads without errors", async () => {
    const ids = await page.$$eval("#examples option", (o) =>
      (o as HTMLOptionElement[]).map((x) => x.value).filter(Boolean),
    );
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      await page.select("#examples", id);
      await page.waitForFunction(
        () => !(document.querySelector("#animate") as HTMLButtonElement).disabled,
      );
      await new Promise((r) => setTimeout(r, 300));
      const errors = await page.$$eval("#issues li.error", (l) => l.map((x) => x.textContent));
      expect(errors, id).toEqual([]);
      expect(await canvasVariance(), id).toBeGreaterThan(5);
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it("shows clear errors for bad input and keeps working", async () => {
    await page.click("#tab-mermaid");
    await page.$eval("#source", (e) => ((e as HTMLTextAreaElement).value = "pie title nope\n"));
    await page.click("#animate");
    await page.waitForSelector("#issues li.error");
    expect(await page.$eval("#issues", (e) => e.textContent)).toContain(
      "mermaid.unsupported_diagram",
    );
  });

  it("downloads the validated canonical JSON", async () => {
    await page.select("#examples", "bench-mermaid");
    await new Promise((r) => setTimeout(r, 500));
    await page.click("#download-json");
    const f = await waitForFile(".archflow.json");
    expect(parseCanonical(JSON.parse(readFileSync(f, "utf8"))).ok).toBe(true);
  });

  it("exports a WebM video rendered on the device", async () => {
    await page.select("#size", "1280x720");
    await page.click("#export");
    const f = await waitForFile(".webm");
    await page.waitForFunction(
      () => /Saved/.test(document.querySelector("#export-msg")?.textContent ?? ""),
      { timeout: 90_000 },
    );
    const bytes = readFileSync(f);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3"); // EBML header
    expect(bytes.length).toBeGreaterThan(20_000);
  }, 120_000);

  it("exports MP4 when the browser can encode H.264 (best effort)", async () => {
    const mp4 = await page.$eval(
      '#format option[value="mp4"]',
      (o) => !(o as HTMLOptionElement).disabled,
    );
    if (!mp4) return; // honestly skipped: no H.264 encoder in this browser build
    await page.select("#format", "mp4");
    await page.click("#export");
    const f = await waitForFile(".mp4");
    await page.waitForFunction(
      () => /Saved/.test(document.querySelector("#export-msg")?.textContent ?? ""),
      { timeout: 90_000 },
    );
    expect(readFileSync(f).subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 120_000);

  it("auto camera: on by default, frames differ from the overview, a manual zoom switches it off", async () => {
    // the order-flow example zooms (the AWS ALB example now plays on the overview: its single
    // routed request overlaps both health-check rounds, see camera.test.ts)
    await page.select("#examples", "bench-text");
    await page.waitForFunction(
      () => !(document.querySelector("#animate") as HTMLButtonElement).disabled,
    );
    await page.click("#play"); // pause
    expect(await page.$eval("#auto-camera", (e) => (e as HTMLInputElement).checked)).toBe(true);
    const shots = async (): Promise<string[]> => {
      const out: string[] = [];
      for (let t = 0; t <= 17000; t += 1000) {
        await page.$eval(
          "#seek",
          (e, v) => {
            (e as HTMLInputElement).value = String(v);
            e.dispatchEvent(new Event("input", { bubbles: true }));
          },
          t,
        );
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
        out.push(await page.$eval("#canvas", (c) => (c as HTMLCanvasElement).toDataURL()));
      }
      return out;
    };
    const withCamera = await shots();
    await page.click("#auto-camera");
    const without = await shots();
    expect(withCamera[0]).toBe(without[0]); // starts on the overview
    expect(withCamera.some((s, i) => s !== without[i])).toBe(true); // zooms somewhere
    await page.click("#auto-camera");
    await page.click("#zoom-in");
    expect(await page.$eval("#auto-camera", (e) => (e as HTMLInputElement).checked)).toBe(false);
    await page.click("#zoom-fit");
    await page.click("#auto-camera");
    expect(problems).toEqual([]);
  }, 120_000);

  it("themes and dimming restyle the animation and keep the position", async () => {
    await page.select("#examples", "aws-alb");
    await page.waitForFunction(
      () => !(document.querySelector("#animate") as HTMLButtonElement).disabled,
    );
    await page.click("#play"); // pause
    const corner = (): Promise<number[]> =>
      page.$eval("#canvas", (c) => {
        const d = (c as HTMLCanvasElement).getContext("2d")!.getImageData(2, 2, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      });
    const time = (): Promise<string> => page.$eval("#time", (e) => e.textContent ?? "");
    const before = await time();
    for (const [theme, bg] of [
      ["light", [0xf6, 0xf8, 0xfc]],
      ["blueprint", [0x0b, 0x3a, 0x6e]],
      ["high-contrast", [0, 0, 0]],
      ["default", [0x0a, 0x11, 0x1f]],
    ] as const) {
      await page.select("#theme", theme);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      expect(await corner(), theme).toEqual([...bg]);
      expect(await time()).toBe(before);
    }
    await page.click("#dim");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(await time()).toBe(before);
    await page.click("#dim");
    expect(await page.$$eval("#issues li.error", (l) => l.length)).toBe(0);
    expect(problems).toEqual([]);
  }, 120_000);

  it("zooms and pans large diagrams, and fits again", async () => {
    await page.select("#examples", "aws-alb");
    await page.waitForFunction(
      () => !(document.querySelector("#animate") as HTMLButtonElement).disabled,
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const fit = await page.$eval("#canvas", (c) => (c as HTMLCanvasElement).toDataURL());
    await page.click("#zoom-in");
    expect(await page.$eval("#zoom-fit", (b) => b.textContent?.trim())).toBe("140%");
    // the zoomed view is painted on the next animation frame
    await page.waitForFunction(
      (before) => (document.querySelector("#canvas") as HTMLCanvasElement).toDataURL() !== before,
      { timeout: 5000 },
      fit,
    );
    // drag pans without toggling playback
    const playing = await page.$eval("#play", (b) => b.getAttribute("aria-label"));
    const box = (await page.$("#canvas"))!.boundingBox();
    const b = (await box)!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 120, b.y + b.height / 2 - 40, { steps: 6 });
    await page.mouse.up();
    expect(await page.$eval("#play", (x) => x.getAttribute("aria-label"))).toBe(playing);
    await page.click("#zoom-fit");
    expect(await page.$eval("#zoom-fit", (x) => x.textContent?.trim())).toBe("Fit");
    expect(await page.$eval("#zoom-out", (x) => (x as HTMLButtonElement).disabled)).toBe(true);
  });
});
