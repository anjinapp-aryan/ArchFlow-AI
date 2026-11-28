import type { ConfigResult } from "./config.ts";
import { convertToInstructions, redact, type FetchLike } from "./client.ts";
import type { InstructionScenario } from "./scenario.ts";

/**
 * Framework-free handler for `POST /api/instructions`, shared by the local server and usable
 * from any server runtime. Request: `{"prompt": "<one line>"}`. The response body is built from
 * an allow-list of fields: it never contains credentials, provider bodies or request headers.
 */

export const PROMPT_LIMITS = { min: 3, max: 300, maxBodyBytes: 4096 } as const;

export type InstructionsResponse =
  | {
      ok: true;
      scenario: InstructionScenario;
      instructions: string;
      provider: string;
      model: string;
    }
  | { ok: false; code: string; message: string };

export interface ApiResponse {
  status: number;
  body: InstructionsResponse;
}

const response = (status: number, code: string, message: string): ApiResponse => ({
  status,
  body: { ok: false, code, message },
});
const fail = (status: number, code: string, message: string) =>
  ({ ok: false, response: response(status, code, message) }) as const;

export function readPrompt(
  rawBody: string,
): { ok: true; prompt: string } | { ok: false; response: ApiResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail(400, "input.invalid", 'The request body must be JSON: {"prompt": "..."}.');
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return fail(400, "input.invalid", "The request body must be a JSON object.");
  const keys = Object.keys(parsed);
  if (keys.some((k) => k !== "prompt"))
    return fail(400, "input.invalid", 'Only the "prompt" field is accepted.');
  const p = (parsed as { prompt?: unknown }).prompt;
  if (typeof p !== "string")
    return fail(400, "input.invalid", "Type a one-line question about an architecture.");
  // one line: newlines and other control characters become spaces
  const prompt = p
    .replace(/\p{Cc}+/gu, " ")
    .replace(/ +/g, " ")
    .trim();
  if (prompt.length < PROMPT_LIMITS.min)
    return fail(400, "input.too_short", "Type a one-line question about an architecture.");
  if (prompt.length > PROMPT_LIMITS.max)
    return fail(
      400,
      "input.too_long",
      `Keep the question to one line of at most ${PROMPT_LIMITS.max} characters.`,
    );
  return { ok: true, prompt };
}

export async function handleInstructionsRequest(
  rawBody: string,
  deps: { config: ConfigResult; fetch?: FetchLike; signal?: AbortSignal },
): Promise<ApiResponse> {
  const input = readPrompt(rawBody);
  if (!input.ok) return input.response;
  if (!deps.config.ok) return response(503, "llm.not_configured", deps.config.message);
  const config = deps.config.config;
  const r = await convertToInstructions(input.prompt, config, {
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  if (!r.ok)
    return response(r.code === "llm.timeout" ? 504 : 502, r.code, redact(r.message, config));
  return {
    status: 200,
    body: {
      ok: true,
      scenario: r.scenario,
      instructions: r.instructions,
      provider: r.provider,
      model: r.model,
    },
  };
}
