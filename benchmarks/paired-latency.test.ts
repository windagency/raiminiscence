import { describe, expect, it } from "vitest";
import { pairedLatencySummary } from "./paired-latency.js";

describe("pairedLatencySummary", () => {
  it("reports each side's median and the median paired difference", () => {
    const summary = pairedLatencySummary([60, 70, 80], [150, 140, 160]);

    expect(summary.medianMs).toEqual({ raiminiscence: 70, hippo: 150 });
    expect(summary.medianDifferenceMs).toBe(-80);
    expect(summary.raiminiscenceFasterPairs).toBe(3);
    expect(summary.pairs).toBe(3);
  });

  it("brackets the median difference with a 95% bootstrap interval", () => {
    const raim = Array.from({ length: 21 }, (_, i) => 60 + (i % 7));
    const hippo = Array.from({ length: 21 }, (_, i) => 140 + (i % 5));
    const { medianDifferenceMs, ci95Ms } = pairedLatencySummary(raim, hippo);

    expect(ci95Ms[0]).toBeLessThanOrEqual(medianDifferenceMs);
    expect(ci95Ms[1]).toBeGreaterThanOrEqual(medianDifferenceMs);
    expect(ci95Ms[1]).toBeLessThan(0);
  });

  it("is reproducible for the same inputs", () => {
    const raim = [61, 75, 58, 90, 66, 70, 64];
    const hippo = [120, 66, 150, 140, 71, 130, 125];

    expect(pairedLatencySummary(raim, hippo)).toEqual(pairedLatencySummary(raim, hippo));
  });

  it("refuses samples of different lengths, since they are not paired", () => {
    expect(() => pairedLatencySummary([1, 2], [1])).toThrow(/paired/);
  });
});
