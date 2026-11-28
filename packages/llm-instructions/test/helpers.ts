import type { FetchLike } from "../src/index.ts";

/** Fake credentials: distinctive strings that must never appear in any response or message. */
export const FAKE_KEYS = {
  GEMINI_API_KEY: "test-gemini-key-DO-NOT-LEAK-1111",
  GROQ_API_KEY: "test-groq-key-DO-NOT-LEAK-2222",
  NVIDIA_API_KEY: "test-nvidia-key-DO-NOT-LEAK-3333",
};

export const FAKE_ENV = {
  LLM_PROVIDER: "failover",
  LLM_PROVIDER_ORDER: "gemini,groq,nvidia",
  GEMINI_MODEL: "gemini-test-model",
  GROQ_MODEL: "groq-test-model",
  NVIDIA_MODEL: "nvidia-test-model",
  ...FAKE_KEYS,
};

export const REDIS_SCENARIO = {
  title: "Redis Cache with Spring Boot",
  request: "GET /api/products/101",
  steps: [
    { from: "Client", to: "Spring Boot API", label: "HTTP request" },
    { from: "Spring Boot API", to: "Redis", label: "GET product:101" },
    { from: "Redis", to: "Spring Boot API", label: "cache miss" },
    { from: "Spring Boot API", to: "PostgreSQL", label: "SELECT product" },
    { from: "PostgreSQL", to: "Spring Boot API", label: "product data" },
    { from: "Spring Boot API", to: "Redis", label: "SET product:101 with TTL 300s" },
    { from: "Spring Boot API", to: "Client", label: "HTTP 200 response" },
  ],
};

export const REDIS_INSTRUCTIONS = `title: Redis Cache with Spring Boot
request: GET /api/products/101

Client -> Spring Boot API : HTTP request
Spring Boot API -> Redis : GET product:101
Redis -> Spring Boot API : cache miss
Spring Boot API -> PostgreSQL : SELECT product
PostgreSQL -> Spring Boot API : product data
Spring Boot API -> Redis : SET product:101 with TTL 300s
Spring Boot API -> Client : HTTP 200 response
`;

export const completion = (content: string) => ({
  choices: [{ index: 0, message: { role: "assistant", content } }],
});

export interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A scripted fetch: one reply per call, in order; records every call. */
export function scriptedFetch(
  replies: ({ status: number; body?: unknown } | "network-error" | "hang")[],
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    const r = replies[calls.length - 1] ?? { status: 500 };
    if (r === "network-error") return Promise.reject(new TypeError("fetch failed"));
    if (r === "hang")
      return new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  };
  return { fetch, calls };
}
