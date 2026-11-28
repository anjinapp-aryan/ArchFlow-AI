import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PacketEvent } from "@archflow/canonical-model";
import { launch, loadArtifacts, renderDisplayLists, type EngineArtifacts } from "@archflow/qa";
import { serializeEngineDocument, toEngineDocument } from "@archflow/renderer-adapter";
import { textToAnimation } from "@archflow/scenario-synthesizer";
import { exportFrameCount, exportFrameTime } from "../src/export.ts";

/**
 * Evidence that every step of an ordered lifecycle really animates (not merely appears as a
 * connector): for each packet, the engine frame that an export at 30 fps renders nearest the
 * packet's midpoint is compared with the same frame of a document without that one step. The
 * frames must differ (the packet is drawn), and a packet's own label must be in the frame.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FPS = 30;
const REDIS_MISS = readFileSync(resolve(repoRoot, "fixtures/regression/redis-cache.txt"), "utf8");
let browser: Browser;
let art: EngineArtifacts;

beforeAll(async () => {
  art = loadArtifacts(repoRoot);
  browser = (await launch()).browser;
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

describe("Redis lifecycle in the engine and in export frames", () => {
  it("every step is drawn in the exported frames", async () => {
    const r = textToAnimation(REDIS_MISS);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const doc = r.document;
    const a = toEngineDocument(doc);
    if (!a.ok) throw new Error(JSON.stringify(a.errors));
    const full = serializeEngineDocument(a.document);
    const packets = doc.scenario!.events.filter((e): e is PacketEvent => e.type === "packet");
    expect(packets).toHaveLength(7);

    const duration = doc.scenario!.durationMs;
    const frames = Array.from({ length: exportFrameCount(duration, FPS) }, (_, i) =>
      exportFrameTime(i, duration, FPS),
    );
    // the exported frame closest to each packet's midpoint, and how many frames it spans
    const probe = packets.map((p) => {
      const inside = frames.filter((t) => t > p.t && t < p.t + p.durationMs);
      const mid = p.t + p.durationMs / 2;
      const t = inside.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x));
      return { p, t, inside: inside.length };
    });
    for (const x of probe) expect(x.inside, x.p.id).toBeGreaterThanOrEqual(20);

    const run = await renderDisplayLists(
      browser,
      art,
      full,
      probe.map((x) => x.t),
    );
    if (!run.ok) throw new Error(run.error);
    const rows: string[] = [];
    for (const [i, x] of probe.entries()) {
      const without = JSON.parse(full) as { scenario: { steps: { id: string }[] } };
      without.scenario.steps = without.scenario.steps.filter((s) => s.id !== x.p.id);
      const ablated = await renderDisplayLists(browser, art, JSON.stringify(without), [x.t]);
      if (!ablated.ok) throw new Error(ablated.error);
      const frame = run.frames[i]!;
      expect(frame.sha256, `${x.p.id} is not drawn at ${x.t} ms`).not.toBe(
        ablated.frames[0]!.sha256,
      );
      if (x.p.label) expect(frame.text).toContain(x.p.label);
      rows.push(
        `${String(x.p.t).padStart(5)}-${String(x.p.t + x.p.durationMs).padStart(5)} ms  ${x.p.from} -> ${x.p.to}  ${x.p.variant}/${x.p.shape}  ${x.p.label ?? "(connector label)"}  frames=${x.inside}  drawn@${Math.round(x.t)}ms`,
      );
    }
    console.log(`[lifecycle] 30 fps export, ${frames.length} frames\n${rows.join("\n")}`);
  }, 120_000);
});
