import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanonicalDocument } from "@archflow/canonical-model";
import { serializeEngineDocument, toEngineDocument } from "@archflow/renderer-adapter";
import {
  GOLDEN_CASES,
  launch,
  loadArtifacts,
  renderDisplayListBatch,
  type DisplayListJob,
  type EngineArtifacts,
} from "../src/index.ts";

/**
 * Temporal assertions on the engine's real output: one frame (1/60 s) before an event starts,
 * the animation is identical to the same animation without that event (nothing of it is drawn
 * early); halfway through the event, it is not (the event is visible while it runs).
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const FRAME = 1000 / 60;
let browser: Browser;
let art: EngineArtifacts;

beforeAll(async () => {
  art = loadArtifacts(root);
  browser = (await launch()).browser;
});
afterAll(async () => {
  await browser?.close();
});

const engineJson = (doc: unknown): string | undefined => {
  const r = toEngineDocument(doc);
  return r.ok ? serializeEngineDocument(r.document) : undefined;
};

describe.each(GOLDEN_CASES)("event boundaries: $id", (c) => {
  it("nothing of an event is drawn before it starts, and it is drawn while it runs", async () => {
    const doc = JSON.parse(
      readFileSync(join(root, "fixtures", "scenarios", c.file), "utf8"),
    ) as CanonicalDocument;
    const events = doc.scenario!.events.filter((e) => e.t >= FRAME);
    const jobs: DisplayListJob[] = [];
    const checked: { id: string; before: number; mid: number }[] = [];
    let skipped = 0;
    for (const ev of events) {
      const without = engineJson({
        ...doc,
        scenario: { ...doc.scenario!, events: doc.scenario!.events.filter((e) => e !== ev) },
      });
      if (without === undefined) {
        skipped++; // another event refers to this one (e.g. a response): cannot remove it alone
        continue;
      }
      const times = [ev.t - FRAME, ev.t + ev.durationMs / 2];
      jobs.push({ json: engineJson(doc)!, times }, { json: without, times });
      checked.push({ id: ev.id, before: times[0]!, mid: times[1]! });
    }
    const results = await renderDisplayListBatch(browser, art, jobs);
    const early: string[] = [];
    const invisible: string[] = [];
    checked.forEach((ev, i) => {
      const full = results[2 * i]!;
      const less = results[2 * i + 1]!;
      expect(full.ok && less.ok, ev.id).toBe(true);
      if (full.hashes[0] !== less.hashes[0])
        early.push(`${ev.id} drawn at ${ev.before.toFixed(0)} ms`);
      if (full.hashes[1] === less.hashes[1]) invisible.push(`${ev.id} not drawn at ${ev.mid} ms`);
    });
    console.log(`[qa] ${c.id}: ${checked.length} events checked, ${skipped} not removable alone`);
    expect(early).toEqual([]);
    expect(invisible).toEqual([]);
    expect(checked.length).toBeGreaterThan(skipped);
  }, 240_000);
});
