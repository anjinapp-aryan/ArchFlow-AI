import type { Attempt } from "./client.ts";

/** Per-provider counters of one server process (no prompts, no replies, no credentials). */
export interface ProviderStat {
  provider: string;
  model: string;
  attempts: number;
  ok: number;
  timeouts: number;
  failures: number;
  /** Share of attempts that produced usable instructions, 0..1. */
  successRate: number;
  /** Latency of successful attempts. */
  avgOkMs: number | null;
  maxOkMs: number | null;
  lastMs: number | null;
  lastOutcome: string | null;
}

export interface ProviderStats {
  record(attempts: readonly Attempt[]): void;
  snapshot(): ProviderStat[];
}

export function createProviderStats(): ProviderStats {
  const by = new Map<
    string,
    {
      provider: string;
      model: string;
      attempts: number;
      ok: number;
      timeouts: number;
      okMs: number[];
      last?: Attempt;
    }
  >();
  return {
    record(attempts) {
      for (const a of attempts) {
        const k = `${a.provider}/${a.model}`;
        const s = by.get(k) ?? {
          provider: a.provider,
          model: a.model,
          attempts: 0,
          ok: 0,
          timeouts: 0,
          okMs: [],
        };
        s.attempts++;
        if (a.outcome === "ok") {
          s.ok++;
          s.okMs.push(a.ms);
          if (s.okMs.length > 200) s.okMs.shift();
        }
        if (a.outcome === "timeout") s.timeouts++;
        s.last = a;
        by.set(k, s);
      }
    },
    snapshot() {
      return [...by.values()].map((s) => ({
        provider: s.provider,
        model: s.model,
        attempts: s.attempts,
        ok: s.ok,
        timeouts: s.timeouts,
        failures: s.attempts - s.ok - s.timeouts,
        successRate: s.attempts ? s.ok / s.attempts : 0,
        avgOkMs: s.okMs.length
          ? Math.round(s.okMs.reduce((x, y) => x + y, 0) / s.okMs.length)
          : null,
        maxOkMs: s.okMs.length ? Math.max(...s.okMs) : null,
        lastMs: s.last?.ms ?? null,
        lastOutcome: s.last?.outcome ?? null,
      }));
    },
  };
}
