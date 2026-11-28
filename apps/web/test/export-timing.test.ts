import { describe, expect, it } from "vitest";
import { h264Timing, repairAvcC } from "../src/export.ts";

const f = 33_333;

describe("h264Timing", () => {
  it("leaves chunks without B-frames unchanged (Chrome, Edge)", () => {
    const ts = [0, f, 2 * f, 3 * f, 4 * f];
    expect(h264Timing(ts)).toEqual(ts.map((t) => ({ timestamp: t, compositionOffset: 0 })));
  });

  it("orders B-frames from a stream that starts one frame late (Firefox)", () => {
    // decode order I0 P2 B1 P4 B3 P5, all reported one frame late
    const shown = [0, 2, 1, 4, 3, 5];
    const out = h264Timing(shown.map((i) => (i + 1) * f));
    const dts = out.map((o) => o.timestamp - o.compositionOffset);
    expect(dts[0]).toBe(0); // mp4-muxer requires the first decode time to be 0
    expect(out.every((o) => o.compositionOffset >= 0)).toBe(true);
    for (let k = 1; k < dts.length; k++) expect(dts[k]).toBeGreaterThan(dts[k - 1]!);
    // presentation order is kept and frame spacing is exact
    const pts = out.map((o) => o.timestamp);
    expect([...pts].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5].map((i) => (i + 1) * f));
  });

  it("handles no chunks", () => expect(h264Timing([])).toEqual([]));
});

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("repairAvcC", () => {
  // record written by Firefox 161 for a 1280x720 High-profile stream (header bytes doubled)
  const firefox =
    "0164001f0301001b676764001fac2cac05005ba10000030001000003003c0da08845380100056868ce3c30";

  it("removes the repeated NAL header byte from Firefox parameter sets", () => {
    const out = toHex(repairAvcC(hex(firefox)));
    expect(out).toBe(
      "0164001f0301001a6764001fac2cac05005ba10000030001000003003c0da0884538010004" + "68ce3c30",
    );
  });

  it("returns a well-formed record unchanged", () => {
    const good = hex(
      "0164001f0301001a6764001fac2cac05005ba10000030001000003003c0da088453801000468ce3c30",
    );
    expect(repairAvcC(good)).toBe(good);
  });

  it("leaves a short or unknown record alone", () => {
    const odd = hex("02640028");
    expect(repairAvcC(odd)).toBe(odd);
  });
});
