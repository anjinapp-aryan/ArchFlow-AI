import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textToAnimation } from "@archflow/scenario-synthesizer";
import {
  DEFAULT_TIMEOUT_MS,
  convertToInstructions,
  handleInstructionsRequest,
  parseModelReply,
  readLlmConfig,
  renderInstructions,
  validateScenario,
  type LlmConfig,
} from "../src/index.ts";
import {
  FAKE_ENV,
  FAKE_KEYS,
  REDIS_INSTRUCTIONS,
  REDIS_SCENARIO,
  completion,
  scriptedFetch,
} from "./helpers.ts";

const PROMPT = "Explain how Redis cache works with Spring Boot.";
const config = (env: Record<string, string | undefined> = FAKE_ENV): LlmConfig => {
  const c = readLlmConfig(env);
  if (!c.ok) throw new Error(c.message);
  return c.config;
};
const noKeys = (value: unknown): void => {
  const text = JSON.stringify(value);
  for (const k of Object.values(FAKE_KEYS)) expect(text).not.toContain(k);
};

// CI must never reach a paid API: any un-mocked network call fails the test
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("unexpected real network call");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("configuration", () => {
  it("reads the failover order and skips providers without key or model", () => {
    const c = readLlmConfig({ ...FAKE_ENV, GROQ_API_KEY: "" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.config.routes.map((r) => r.id)).toEqual(["gemini", "nvidia"]);
    expect(c.config.skipped).toEqual(["groq (missing GROQ_API_KEY)"]);
    expect(c.config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(c.config.routes[0]!.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    );
  });

  it("supports a single provider and clamps the timeout", () => {
    const c = readLlmConfig({ ...FAKE_ENV, LLM_PROVIDER: "groq", ARCHFLOW_LLM_TIMEOUT_MS: "5" });
    expect(c.ok && c.config.routes.map((r) => r.id)).toEqual(["groq"]);
    expect(c.ok && c.config.timeoutMs).toBe(1000);
  });

  it("explains a missing configuration without echoing values", () => {
    const c = readLlmConfig({});
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.message).toMatch(/not configured.*GEMINI_API_KEY.*\.env\.local/);
    const bad = readLlmConfig({ ...FAKE_ENV, LLM_PROVIDER_ORDER: "gemini,openai" });
    expect(!bad.ok && bad.message).toMatch(/unsupported provider "openai"/);
    noKeys(bad);
  });
});

describe("scenario validation and instructions", () => {
  it("renders the example scenario as the expected instructions", () => {
    const v = validateScenario(REDIS_SCENARIO);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(renderInstructions(v.scenario)).toBe(REDIS_INSTRUCTIONS);
  });

  it("the instructions go through ArchFlow's own parser, validator and synthesizer", () => {
    const r = textToAnimation(REDIS_INSTRUCTIONS);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.document.diagram.name).toBe("Redis Cache with Spring Boot");
    expect(r.document.diagram.nodes.map((n) => [n.label, n.kind])).toEqual([
      ["Client", "client"],
      ["Spring Boot API", "service"],
      ["Redis", "cache"],
      ["PostgreSQL", "db"],
    ]);
    expect(r.document.diagram.edges.map((e) => e.label)).toEqual(
      REDIS_SCENARIO.steps.map((s) => s.label),
    );
    const packets = r.document.scenario!.events.filter((e) => e.type === "packet");
    expect(packets.length).toBeGreaterThan(4);
    expect(r.document.scenario!.flows[0]!.label).toContain("GET /api/products/101");
  });

  it("is closed and strict", () => {
    const bad = (x: unknown) => {
      const v = validateScenario(x);
      expect(v.ok).toBe(false);
      return v.ok ? [] : v.problems;
    };
    expect(bad("text")).toEqual(["the reply is not a JSON object"]);
    expect(bad({ ...REDIS_SCENARIO, extra: 1 })).toContain('reply has an unexpected field "extra"');
    expect(bad({ ...REDIS_SCENARIO, steps: [] })).toContain("steps is empty");
    expect(
      bad({ ...REDIS_SCENARIO, steps: [{ from: "A -> B", to: "C", label: "x" }] }).join(),
    ).toMatch(/reserved by the syntax/);
    expect(bad({ ...REDIS_SCENARIO, steps: [{ from: "A, B", to: "C" }] }).join()).toMatch(
      /reserved/,
    );
    expect(bad({ ...REDIS_SCENARIO, steps: [{ from: "A", to: "a" }] }).join()).toMatch(/itself/);
    expect(bad({ ...REDIS_SCENARIO, title: "x\nfail: A -> B" }).join()).toMatch(/line breaks/);
    expect(bad({ ...REDIS_SCENARIO, steps: [{ from: 1, to: "B" }] }).join()).toMatch(/string/);
    const many = Array.from({ length: 41 }, (_, i) => ({ from: `A${i}`, to: `B${i}`, label: "" }));
    expect(bad({ ...REDIS_SCENARIO, steps: many }).join()).toMatch(/more than 40 steps/);
  });

  it("drops sentence punctuation the parser would split on", () => {
    const v = validateScenario({
      title: "Flow.",
      request: "",
      steps: [{ from: "Web App", to: "API", label: "Sends it. Then waits!" }],
    });
    expect(v.ok && renderInstructions(v.scenario)).toBe(
      "title: Flow\n\nWeb App -> API : Sends it Then waits\n",
    );
  });

  it("takes the JSON object out of a fenced reply", () => {
    expect(parseModelReply("```json\n" + JSON.stringify(REDIS_SCENARIO) + "\n```")).toEqual(
      REDIS_SCENARIO,
    );
    expect(parseModelReply("no json here")).toBeUndefined();
    expect(parseModelReply("{ broken")).toBeUndefined();
  });
});

describe("provider client (mocked)", () => {
  it("calls the first provider's OpenAI-compatible endpoint with bounded output", async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, body: completion(JSON.stringify(REDIS_SCENARIO)) },
    ]);
    const r = await convertToInstructions(PROMPT, config(), { fetch });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.instructions).toBe(REDIS_INSTRUCTIONS);
    expect([r.provider, r.model]).toEqual(["gemini", "gemini-test-model"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(calls[0]!.headers["Authorization"]).toBe(`Bearer ${FAKE_KEYS.GEMINI_API_KEY}`);
    expect(calls[0]!.body["model"]).toBe("gemini-test-model");
    expect(calls[0]!.body["max_tokens"]).toBe(4000);
    expect(JSON.stringify(calls[0]!.body["messages"])).toContain(PROMPT);
    noKeys(calls[0]!.body);
    noKeys(r);
  });

  it("fails over in order on rate limits, network errors and unusable replies", async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 429, body: { error: { message: `quota for ${FAKE_KEYS.GEMINI_API_KEY}` } } },
      { status: 200, body: completion("I cannot help with that.") },
      { status: 200, body: completion(JSON.stringify(REDIS_SCENARIO)) },
    ]);
    const r = await convertToInstructions(PROMPT, config(), { fetch });
    expect(r.ok && r.provider).toBe("nvidia");
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "generativelanguage.googleapis.com",
      "api.groq.com",
      "integrate.api.nvidia.com",
    ]);
    expect(calls[1]!.headers["Authorization"]).toBe(`Bearer ${FAKE_KEYS.GROQ_API_KEY}`);
    expect(r.attempts.map((a) => a.outcome)).toEqual(["rate_limited", "bad_reply", "ok"]);
    noKeys(r);
  });

  it("reports every provider failing, without provider bodies or keys", async () => {
    const { fetch } = scriptedFetch([
      { status: 401, body: { error: `invalid key ${FAKE_KEYS.GEMINI_API_KEY}` } },
      "network-error",
      { status: 500, body: { error: FAKE_KEYS.NVIDIA_API_KEY } },
    ]);
    const r = await convertToInstructions(PROMPT, config(), { fetch });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("llm.unavailable");
    expect(r.message).toContain("gemini: credentials rejected (HTTP 401)");
    expect(r.message).toContain("groq: unreachable");
    expect(r.message).toContain("nvidia: HTTP error (HTTP 500)");
    noKeys(r);
  });

  it("times out each attempt", async () => {
    const { fetch } = scriptedFetch(["hang"]);
    const c = config({ ...FAKE_ENV, LLM_PROVIDER: "gemini", ARCHFLOW_LLM_TIMEOUT_MS: "1000" });
    const t0 = Date.now();
    const r = await convertToInstructions(PROMPT, c, { fetch });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(!r.ok && r.code).toBe("llm.timeout");
    expect(!r.ok && r.message).toMatch(/did not answer within 1 s/);
  });
});

describe("HTTP handler (mocked)", () => {
  const ok = () =>
    scriptedFetch([{ status: 200, body: completion(JSON.stringify(REDIS_SCENARIO)) }]);

  it("returns the structured scenario and the editable instructions, nothing else", async () => {
    const { fetch } = ok();
    const r = await handleInstructionsRequest(JSON.stringify({ prompt: PROMPT }), {
      config: readLlmConfig(FAKE_ENV),
      fetch,
    });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(
      ["instructions", "model", "ok", "provider", "scenario"].sort(),
    );
    expect(r.body.ok && r.body.scenario).toEqual(REDIS_SCENARIO);
    expect(r.body.ok && r.body.instructions).toBe(REDIS_INSTRUCTIONS);
    noKeys(r);
  });

  it("rejects bad input before any provider call", async () => {
    const { fetch, calls } = ok();
    const deps = { config: readLlmConfig(FAKE_ENV), fetch };
    for (const [body, code] of [
      ["not json", "input.invalid"],
      ["[]", "input.invalid"],
      [JSON.stringify({ prompt: PROMPT, apiKey: "x" }), "input.invalid"],
      [JSON.stringify({ prompt: 5 }), "input.invalid"],
      [JSON.stringify({ prompt: " a " }), "input.too_short"],
      [JSON.stringify({ prompt: "x".repeat(301) }), "input.too_long"],
    ] as const) {
      const r = await handleInstructionsRequest(body, deps);
      expect([r.status, !r.body.ok && r.body.code]).toEqual([400, code]);
    }
    expect(calls).toHaveLength(0);
  });

  it("answers 503 with a clear message when no provider is configured", async () => {
    const r = await handleInstructionsRequest(JSON.stringify({ prompt: PROMPT }), {
      config: readLlmConfig({}),
    });
    expect(r.status).toBe(503);
    expect(!r.body.ok && r.body.code).toBe("llm.not_configured");
  });

  it("maps provider failures to 502 and timeouts to 504", async () => {
    const failing = scriptedFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const r = await handleInstructionsRequest(JSON.stringify({ prompt: PROMPT }), {
      config: readLlmConfig(FAKE_ENV),
      fetch: failing.fetch,
    });
    expect(r.status).toBe(502);
    const hanging = scriptedFetch(["hang"]);
    const t = await handleInstructionsRequest(JSON.stringify({ prompt: PROMPT }), {
      config: readLlmConfig({ ...FAKE_ENV, LLM_PROVIDER: "groq", ARCHFLOW_LLM_TIMEOUT_MS: "1000" }),
      fetch: hanging.fetch,
    });
    expect(t.status).toBe(504);
  });
});
