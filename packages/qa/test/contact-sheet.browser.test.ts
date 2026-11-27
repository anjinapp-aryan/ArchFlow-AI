import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GOLDEN_CASES,
  contactSheetLayout,
  formatInstant,
  goldenSheetSource,
  launch,
  pixelDir,
  renderContactSheet,
} from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let browser: Browser;
let envId = "";

beforeAll(async () => {
  const l = await launch();
  browser = l.browser;
  envId = l.envId;
});
afterAll(async () => {
  await browser?.close();
});

const hashDir = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((f) => [
        f,
        createHash("sha256")
          .update(readFileSync(join(dir, f)))
          .digest("hex"),
      ]),
  );

/** PNG width/height from the IHDR chunk. */
const pngSize = (b: Buffer): { w: number; h: number } => ({
  w: b.readUInt32BE(16),
  h: b.readUInt32BE(20),
});

describe("golden contact sheet", () => {
  it("tiles every recorded aws-alb frame, labelled, reproducibly, without touching the goldens", async (ctx) => {
    const dir = pixelDir(root, "aws-alb", envId);
    let src;
    try {
      src = goldenSheetSource(root, "aws-alb", envId);
    } catch (e) {
      ctx.skip(`no aws-alb pixel goldens for ${envId}: ${(e as Error).message}`);
      return;
    }
    const before = hashDir(dir);
    const expectedTimes = GOLDEN_CASES.find((c) => c.id === "aws-alb")!.times;
    expect(src.spec.frames.map((f) => f.t)).toEqual([...expectedTimes]);
    expect(src.spec.title).toContain("aws-alb");
    expect(src.spec.title).toContain("—"); // scenario (diagram) name follows the case id

    const a = await renderContactSheet(browser, src.spec);
    const b = await renderContactSheet(browser, src.spec);
    expect(createHash("sha256").update(b).digest("hex")).toBe(
      createHash("sha256").update(a).digest("hex"),
    );
    const layout = contactSheetLayout(src.spec);
    expect(pngSize(a)).toEqual({ w: layout.width, h: layout.height });
    expect(hashDir(dir)).toEqual(before);
  });

  it("selects only the requested instants and refuses unknown ones", (ctx) => {
    try {
      const src = goldenSheetSource(root, "aws-alb", envId, [0, 7300]);
      expect(src.spec.frames.map((f) => f.t)).toEqual([0, 7300]);
    } catch (e) {
      ctx.skip(`no aws-alb pixel goldens for ${envId}: ${(e as Error).message}`);
      return;
    }
    expect(() => goldenSheetSource(root, "aws-alb", envId, [1234])).toThrow(/no golden frame/);
    expect(() => goldenSheetSource(root, "nope", envId)).toThrow(/unknown golden case/);
    expect(() => goldenSheetSource(root, "aws-alb", "no-such-env")).toThrow(/no pixel goldens/);
  });

  it("lays cells out on a grid without overlap and labels them with the instant", () => {
    const frames = [0, 700, 1500, 2100, 2700].map((t) => ({
      t,
      png: Buffer.alloc(0),
      width: 1280,
      height: 560,
    }));
    const l = contactSheetLayout({ title: "x", subtitle: "y", frames, columns: 2, cellWidth: 400 });
    expect(l.cells).toHaveLength(5);
    for (let i = 0; i < l.cells.length; i++)
      for (let j = i + 1; j < l.cells.length; j++) {
        const p = l.cells[i]!;
        const q = l.cells[j]!;
        const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.labelY <= q.y || q.labelY <= p.y;
        expect(apart, `${i}/${j}`).toBe(true);
      }
    for (const c of l.cells) {
      expect(c.x + c.w).toBeLessThanOrEqual(l.width);
      expect(c.labelY).toBeLessThanOrEqual(l.height);
      expect(c.h).toBe(175); // 1280x560 scaled to 400 wide
    }
    expect(formatInstant(7300)).toBe("t = 7.3 s  (7300 ms)");
  });
});
