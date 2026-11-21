/** Resamples per bootstrap interval, matching the LoCoMo and LongMemEval analyses. */
export const RESAMPLES = 10_000;
/** Fixed, so a summary is reproducible from its inputs. */
export const SEED = 1;

export interface PairedLatencySummary {
  pairs: number;
  medianMs: { raiminiscence: number; hippo: number };
  /** Median of rAIminiscence minus hippo-memory, pair by pair. Negative means rAIminiscence is faster. */
  medianDifferenceMs: number;
  /** 95% percentile-bootstrap interval for `medianDifferenceMs`, resampling whole pairs. */
  ci95Ms: [number, number];
  raiminiscenceFasterPairs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** mulberry32: a small seeded generator, so the interval doesn't depend on Math.random. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compares two hooks timed call by call in alternation, so the i-th
 * rAIminiscence call and the i-th hippo-memory call ran under the same
 * machine load. Each pair's difference cancels that shared load.
 */
export function pairedLatencySummary(raiminiscenceMs: number[], hippoMs: number[]): PairedLatencySummary {
  if (raiminiscenceMs.length !== hippoMs.length || raiminiscenceMs.length === 0) {
    throw new Error("pairedLatencySummary needs two non-empty, paired samples of the same length");
  }
  const differences = raiminiscenceMs.map((ms, i) => ms - hippoMs[i]!);
  const random = seededRandom(SEED);
  const resampled = Array.from({ length: RESAMPLES }, () =>
    median(differences.map(() => differences[Math.floor(random() * differences.length)]!)),
  ).sort((a, b) => a - b);

  return {
    pairs: differences.length,
    medianMs: { raiminiscence: median(raiminiscenceMs), hippo: median(hippoMs) },
    medianDifferenceMs: median(differences),
    ci95Ms: [resampled[Math.floor(RESAMPLES * 0.025)]!, resampled[Math.ceil(RESAMPLES * 0.975) - 1]!],
    raiminiscenceFasterPairs: differences.filter((difference) => difference < 0).length,
  };
}
