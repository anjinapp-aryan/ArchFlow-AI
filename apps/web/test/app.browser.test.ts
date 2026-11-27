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
});
