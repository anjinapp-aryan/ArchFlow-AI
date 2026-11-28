import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch } from "@archflow/qa";
import type { FetchLike } from "@archflow/llm-instructions";
import {
  FAKE_ENV,
  FAKE_KEYS,
  REDIS_INSTRUCTIONS,
  REDIS_SCENARIO,
  completion,
} from "../../../packages/llm-instructions/test/helpers.ts";

/**
 * "Convert to Instructions" end to end on the production build served by the local server,
 * with the LLM provider replaced by a mock: no paid API is ever called. Also checks that the
 * endpoint is same-origin only and that nothing secret reaches the browser.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROMPT = "Explain how Redis cache works with Spring Boot.";
let server: Server;
let base = "";
let browser: Browser;
let page: Page;
const providerCalls: string[] = [];
const problems: string[] = [];

const mockProvider: FetchLike = (url) => {
  providerCalls.push(url);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(completion(JSON.stringify(REDIS_SCENARIO))),
  });
};

beforeAll(async () => {
  const b = spawnSync(process.execPath, [resolve(repoRoot, "apps/web/build.mjs")], {
    encoding: "utf8",
  });
  if (b.status !== 0) throw new Error(`web build failed: ${b.stderr}`);
  const mod = (await import(resolve(repoRoot, "scripts/serve-web.mjs"))) as {
    startServer(p: number, o: unknown): Promise<Server>;
  };
  server = await mod.startServer(0, { llm: { env: FAKE_ENV, fetch: mockProvider, quiet: true } });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
  browser = (await launch()).browser;
  page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warn") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${(e as Error).message}`));
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => !document.querySelector("#placeholder:not([hidden])"), {
    timeout: 20_000,
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}api/instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });

describe("instructions endpoint", () => {
  it("returns the scenario and instructions, never a key", async () => {
    const r = await post(JSON.stringify({ prompt: PROMPT }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    const text = await r.text();
    for (const k of Object.values(FAKE_KEYS)) expect(text).not.toContain(k);
    const body = JSON.parse(text) as { scenario: unknown; instructions: string };
    expect(body.scenario).toEqual(REDIS_SCENARIO);
    expect(body.instructions).toBe(REDIS_INSTRUCTIONS);
  });

  it("refuses other origins, hosts, methods and content types", async () => {
    const callsBefore = providerCalls.length;
    const prompt = JSON.stringify({ prompt: PROMPT });
    expect((await post(prompt, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post(prompt, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await fetch(`${base}api/instructions`)).status).toBe(405);
    expect((await post("x".repeat(5000))).status).toBe(413);
    // DNS rebinding: a foreign Host header (undici refuses to override Host, use node:http)
    const { request } = await import("node:http");
    const status = await new Promise<number>((ok, ko) => {
      const req = request(
        `${base}api/instructions`,
        {
          method: "POST",
          headers: { Host: "attacker.example", "Content-Type": "application/json" },
        },
        (res) => {
          res.resume();
          ok(res.statusCode ?? 0);
        },
      );
      req.on("error", ko);
      req.end(prompt);
    });
    expect(status).toBe(403);
    expect(providerCalls.length).toBe(callsBefore);
  });

  it("ships no provider code, endpoint or key in the browser bundle", () => {
    const dist = resolve(repoRoot, "apps/web/dist");
    const files = [
      "index.html",
      ...readdirSync(join(dist, "assets"))
        .filter((f) => f.startsWith("app-"))
        .map((f) => `assets/${f}`),
    ];
    for (const f of files) {
      const text = readFileSync(join(dist, f), "utf8");
      for (const needle of [
        ...Object.values(FAKE_KEYS),
        "chat/completions",
        "generativelanguage.googleapis.com",
        "api.groq.com",
        "integrate.api.nvidia.com",
        "GEMINI_API_KEY",
        "Bearer ",
      ])
        expect(text, `${f} contains ${needle}`).not.toContain(needle);
    }
  });
});

describe("Convert to Instructions in the app", () => {
  it("fills editable instructions and generates the animated diagram", async () => {
    await page.evaluate(() => (document.querySelector("#welcome-close") as HTMLElement)?.click());
    expect(await page.$eval("#ai-generate", (b) => (b as HTMLButtonElement).disabled)).toBe(true);
    // an empty editor is filled directly
    await page.$eval("#source", (t) => {
      (t as HTMLTextAreaElement).value = "";
      t.dispatchEvent(new Event("input"));
    });
    await page.type("#ai-prompt", PROMPT);
    await page.click("#ai-convert");
    await page.waitForFunction(
      () => document.querySelector("#ai-status")?.classList.contains("ok"),
      { timeout: 15_000 },
    );
    expect(await page.$eval("#source", (t) => (t as HTMLTextAreaElement).value)).toBe(
      REDIS_INSTRUCTIONS,
    );
    expect(await page.$eval("#tab-text", (b) => b.getAttribute("aria-pressed"))).toBe("true");

    // the user edits the instructions, then generates
    await page.$eval("#source", (t) => {
      const ta = t as HTMLTextAreaElement;
      ta.value = ta.value.replace("TTL 300s", "TTL 600s");
      ta.dispatchEvent(new Event("input"));
    });
    await page.click("#ai-generate");
    await page.waitForFunction(
      () => document.querySelector("#doc-title")?.textContent === "Redis Cache with Spring Boot",
      { timeout: 20_000 },
    );
    expect(await page.$eval("#validity", (v) => v.className)).not.toContain("error");
    expect(problems).toEqual([]);
  });

  it("never overwrites existing instructions without Replace", async () => {
    const edited = await page.$eval("#source", (t) => (t as HTMLTextAreaElement).value);
    expect(edited).toContain("TTL 600s");
    const pendingShown = () =>
      page.waitForFunction(() => !(document.querySelector("#ai-pending") as HTMLElement).hidden, {
        timeout: 15_000,
      });
    const source = () => page.$eval("#source", (t) => (t as HTMLTextAreaElement).value);

    // Cancel keeps the user's text and discards the result
    await page.click("#ai-convert");
    await pendingShown();
    expect(await source()).toBe(edited);
    expect(await page.$eval("#ai-preview", (p) => p.textContent)).toBe(REDIS_INSTRUCTIONS);
    await page.click("#ai-cancel");
    expect(await page.$eval("#ai-pending", (p) => (p as HTMLElement).hidden)).toBe(true);
    expect(await source()).toBe(edited);
    expect(await page.$eval("#ai-status", (p) => p.textContent)).toMatch(/Kept your instructions/);

    // the result is kept until accepted; Replace then puts it in the editor
    await page.click("#ai-convert");
    await pendingShown();
    expect(await source()).toBe(edited);
    await page.click("#ai-replace");
    expect(await source()).toBe(REDIS_INSTRUCTIONS);
    expect(await page.$eval("#ai-pending", (p) => (p as HTMLElement).hidden)).toBe(true);
    expect(await page.$eval("#ai-status", (p) => p.className)).toContain("ok");
    expect(problems).toEqual([]);
  });

  it("reports provider statistics without credentials", async () => {
    const r = await fetch(`${base}api/instructions/stats`);
    expect(r.status).toBe(200);
    const text = await r.text();
    for (const k of Object.values(FAKE_KEYS)) expect(text).not.toContain(k);
    const body = JSON.parse(text) as {
      order: string[];
      providers: { provider: string; ok: number; successRate: number }[];
    };
    expect(body.order).toEqual([
      "gemini/gemini-test-model",
      "groq/groq-test-model",
      "nvidia/nvidia-test-model",
    ]);
    const gemini = body.providers.find((p) => p.provider === "gemini")!;
    expect(gemini.ok).toBe(providerCalls.length);
    expect(gemini.successRate).toBe(1);
  });
});
