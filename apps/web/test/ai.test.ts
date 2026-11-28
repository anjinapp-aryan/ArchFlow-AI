import { describe, expect, it } from "vitest";
import {
  needsReplaceConfirmation,
  progressText,
  readAiResponse,
  requestInstructions,
} from "../src/ai.ts";

describe("reading the instructions endpoint's reply", () => {
  it("accepts a well-formed success", () => {
    const r = readAiResponse(200, {
      ok: true,
      instructions: "title: T\n\nA -> B : x\n",
      scenario: { title: "T", request: "", steps: [] },
      provider: "gemini",
      model: "m",
    });
    expect(r).toEqual({
      ok: true,
      instructions: "title: T\n\nA -> B : x\n",
      title: "T",
      provider: "gemini",
      model: "m",
      progress: "",
    });
  });

  it("passes the server's error message through", () => {
    expect(
      readAiResponse(503, { ok: false, code: "llm.not_configured", message: "not configured" }),
    ).toEqual({ ok: false, message: "not configured" });
  });

  it("explains that static hosting has no AI backend", () => {
    for (const s of [404, 405])
      expect(readAiResponse(s, undefined)).toMatchObject({
        ok: false,
        message: expect.stringMatching(/needs the local server/) as unknown,
      });
  });

  it("refuses odd replies", () => {
    expect(readAiResponse(200, { ok: true, instructions: 3 }).ok).toBe(false);
    expect(readAiResponse(200, { ok: true, instructions: "x".repeat(9000) }).ok).toBe(false);
    expect(readAiResponse(500, "boom")).toEqual({
      ok: false,
      message: "The AI service failed (HTTP 500).",
    });
  });

  it("posts JSON to its own origin without credentials", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = ((url: string, init: RequestInit) => {
      seen = { url, init };
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, message: "m" }), { status: 502 }),
      );
    }) as unknown as typeof fetch;
    expect(await requestInstructions("Explain Kafka", fake)).toEqual({ ok: false, message: "m" });
    expect(seen?.url).toBe("/api/instructions");
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.credentials).toBe("omit");
    expect(JSON.parse(String(seen?.init.body))).toEqual({ prompt: "Explain Kafka" });
  });

  it("turns a network failure into the not-available message", async () => {
    const fake = (() =>
      Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    expect((await requestInstructions("x y z", fake)).ok).toBe(false);
  });
});

describe("editor overwrite protection", () => {
  it("fills an empty editor directly", () => {
    expect(needsReplaceConfirmation("", "title: T\n")).toBe(false);
    expect(needsReplaceConfirmation("  \n\t", "title: T\n")).toBe(false);
  });
  it("asks before replacing anything the user wrote", () => {
    expect(needsReplaceConfirmation("User -> API", "title: T\n")).toBe(true);
    expect(needsReplaceConfirmation("graph LR\nA-->B", "title: T\n")).toBe(true);
  });
  it("does not ask when the editor already holds exactly this result", () => {
    expect(needsReplaceConfirmation("title: T\n\nA -> B\n", "title: T\n\nA -> B")).toBe(false);
  });
});

describe("conversion progress", () => {
  it("counts seconds and explains the fallback on long waits", () => {
    expect(progressText(200)).toBe("Converting…");
    expect(progressText(3400)).toBe("Converting… 3 s");
    expect(progressText(31_000)).toMatch(/^Converting… 31 s \(a slow provider falls back/);
  });
});
