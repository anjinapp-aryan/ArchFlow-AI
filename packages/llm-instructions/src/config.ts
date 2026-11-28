/**
 * LLM provider configuration, read from environment variables on the server only.
 *
 * Every supported provider exposes an OpenAI-compatible Chat Completions endpoint (the same
 * presets ArchAgenticRAG uses), so one client covers all of them. Keys never leave this
 * package except as the Authorization header of the outgoing provider request; nothing here is
 * ever sent to the browser.
 */

export type ProviderId = "gemini" | "groq" | "nvidia";

interface ProviderPreset {
  baseUrl: string;
  keyVar: string;
  modelVar: string;
  /** Extra request fields the provider accepts (reasoning kept low: it costs latency and tokens). */
  extra: Record<string, unknown>;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyVar: "GEMINI_API_KEY",
    modelVar: "GEMINI_MODEL",
    extra: { reasoning_effort: "low" },
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1/",
    keyVar: "GROQ_API_KEY",
    modelVar: "GROQ_MODEL",
    extra: { reasoning_effort: "low" },
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1/",
    keyVar: "NVIDIA_API_KEY",
    modelVar: "NVIDIA_MODEL",
    extra: {},
  },
};

const isProviderId = (s: string): s is ProviderId => Object.hasOwn(PROVIDERS, s);

export interface ProviderRoute {
  id: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  extra: Record<string, unknown>;
}

export interface LlmConfig {
  routes: ProviderRoute[];
  /** Per provider attempt. */
  timeoutMs: number;
  /** Providers named in the order but left out, with the reason (variable names only). */
  skipped: string[];
}

export type ConfigResult = { ok: true; config: LlmConfig } | { ok: false; message: string };

export const DEFAULT_ORDER: ProviderId[] = ["gemini", "groq", "nvidia"];
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * LLM_PROVIDER: "failover" (default; providers from LLM_PROVIDER_ORDER) or one provider id.
 * LLM_PROVIDER_ORDER: comma-separated provider ids, tried in order (default gemini,groq,nvidia).
 * <PROVIDER>_API_KEY / <PROVIDER>_MODEL: credentials and model per provider; a provider
 * missing either is skipped.
 * ARCHFLOW_LLM_TIMEOUT_MS: per-attempt timeout, 1000-120000 (default 30000).
 */
export function readLlmConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const mode = (env["LLM_PROVIDER"] ?? "").trim().toLowerCase() || "failover";
  let names: string[];
  if (mode === "failover") {
    const order = env["LLM_PROVIDER_ORDER"]?.trim();
    names = order
      ? order
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : [...DEFAULT_ORDER];
  } else names = [mode];

  const unknown = names.filter((n) => !isProviderId(n));
  if (unknown.length)
    return {
      ok: false,
      message:
        `AI conversion is misconfigured: unsupported provider "${unknown.join('", "')}" in ` +
        `${mode === "failover" ? "LLM_PROVIDER_ORDER" : "LLM_PROVIDER"} ` +
        `(supported: failover, ${Object.keys(PROVIDERS).join(", ")}).`,
    };

  const routes: ProviderRoute[] = [];
  const skipped: string[] = [];
  for (const n of new Set(names.filter(isProviderId))) {
    const p = PROVIDERS[n];
    const apiKey = env[p.keyVar]?.trim() ?? "";
    const model = env[p.modelVar]?.trim() ?? "";
    const missing = [apiKey ? "" : p.keyVar, model ? "" : p.modelVar].filter(Boolean);
    if (missing.length) {
      skipped.push(`${n} (missing ${missing.join(" and ")})`);
      continue;
    }
    routes.push({ id: n, baseUrl: p.baseUrl, model, apiKey, extra: p.extra });
  }
  if (!routes.length)
    return {
      ok: false,
      message:
        "AI conversion is not configured on this server. Set GEMINI_API_KEY and GEMINI_MODEL " +
        "(or another provider listed in LLM_PROVIDER_ORDER) in .env.local, then restart " +
        `npm run web:serve.${skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""}`,
    };

  const t = Number(env["ARCHFLOW_LLM_TIMEOUT_MS"]);
  const timeoutMs =
    Number.isFinite(t) && t > 0 ? Math.min(120_000, Math.max(1000, t)) : DEFAULT_TIMEOUT_MS;
  return { ok: true, config: { routes, timeoutMs, skipped } };
}
