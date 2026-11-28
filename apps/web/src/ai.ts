/**
 * "Convert to Instructions": one line -> editable architecture instructions, produced by the
 * LLM behind the local server's `POST /api/instructions`. The browser never holds provider
 * credentials; it only sends the user's line on an explicit click, to its own origin, and
 * treats the reply as untrusted data (shape checked here, then the normal parser, canonical
 * validator and renderer handle the instructions like any typed description).
 */

export const AI_ENDPOINT = "/api/instructions";
export const AI_TIMEOUT_MS = 90_000;
const MAX_INSTRUCTIONS = 8000;

export type AiResult =
  | { ok: true; instructions: string; title: string; provider: string; model: string }
  | { ok: false; message: string };

const NOT_AVAILABLE =
  "AI conversion is not available on this site: it needs the local server (npm run web:serve) " +
  "with an LLM provider in .env.local. You can still write the instructions by hand.";

const short = (s: unknown, max: number): string | undefined =>
  typeof s === "string" && s.length <= max ? s : undefined;

/** Interpret the endpoint's reply; anything unexpected becomes a clear message, never a crash. */
export function readAiResponse(status: number, data: unknown): AiResult {
  const body = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  if (body["ok"] === true) {
    const instructions = short(body["instructions"], MAX_INSTRUCTIONS);
    const scenario = body["scenario"] as { title?: unknown } | undefined;
    if (status === 200 && instructions?.trim())
      return {
        ok: true,
        instructions,
        title: short(scenario?.title, 200) ?? "",
        provider: short(body["provider"], 40) ?? "AI",
        model: short(body["model"], 120) ?? "",
      };
    return { ok: false, message: "The AI service sent an unexpected reply." };
  }
  const message = short(body["message"], 600);
  if (message && body["ok"] === false) return { ok: false, message };
  // static hosting (production) has no endpoint: 404/405 or an HTML page
  if (status === 404 || status === 405 || status === 501)
    return { ok: false, message: NOT_AVAILABLE };
  return { ok: false, message: `The AI service failed (HTTP ${status}).` };
}

export async function requestInstructions(
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetchImpl(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ prompt }),
      credentials: "omit",
      cache: "no-store",
      signal: ctrl.signal,
    });
    const data: unknown = await res.json().catch(() => undefined);
    return readAiResponse(res.status, data);
  } catch {
    return ctrl.signal.aborted
      ? { ok: false, message: "The AI service did not answer in time. Try again." }
      : { ok: false, message: NOT_AVAILABLE };
  } finally {
    clearTimeout(timer);
  }
}
