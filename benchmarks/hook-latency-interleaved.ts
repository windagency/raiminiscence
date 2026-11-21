import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { withHippoHookStore } from "./hippo-memory-runner/latency-runner.js";
import { pairedLatencySummary, type PairedLatencySummary } from "./paired-latency.js";
import { withShimStore } from "./raiminiscence-runner/latency-runner.js";

/**
 * ADR-0039's acceptance check: rAIminiscence's real per-turn hook, with
 * its MCP server running, against hippo-memory's real per-turn hook, timed
 * call by call in alternation. `extended-compare.ts` times the two in
 * separate phases, so machine load that changes between phases lands on
 * one side only. Here the i-th call of each runs back to back, the order
 * flips every pair, and each pair's difference cancels the shared load.
 *
 * usage: tsx benchmarks/hook-latency-interleaved.ts
 */

const STORE_SIZES = [10, 50, 150, 300, 750, 1500];
const PAIRS = 21;
const WARM_UP_CALLS = 2;

interface SizeResult {
  storeSize: number;
  summary: PairedLatencySummary;
  raiminiscenceMs: number[];
  hippoMs: number[];
  /** One-minute load average before and after the timed pairs. */
  loadAverage: [number, number];
}

function time(call: () => string): number {
  const start = performance.now();
  call();
  return performance.now() - start;
}

async function measureSize(storeSize: number): Promise<SizeResult> {
  return withShimStore(storeSize, async ({ callShim, startServer }) => {
    await startServer();
    return withHippoHookStore(storeSize, async (callHippo) => {
      for (let i = 0; i < WARM_UP_CALLS; i++) {
        callShim();
        callHippo();
      }
      const before = loadavg()[0]!;
      const raiminiscenceMs: number[] = [];
      const hippoMs: number[] = [];
      for (let i = 0; i < PAIRS; i++) {
        if (i % 2 === 0) {
          raiminiscenceMs.push(time(callShim));
          hippoMs.push(time(callHippo));
        } else {
          hippoMs.push(time(callHippo));
          raiminiscenceMs.push(time(callShim));
        }
      }
      return { storeSize, summary: pairedLatencySummary(raiminiscenceMs, hippoMs), raiminiscenceMs, hippoMs, loadAverage: [before, loadavg()[0]!] };
    });
  });
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

function report(date: string, results: SizeResult[]): string {
  const rows = results.map(({ storeSize, summary: s, loadAverage }) =>
    [
      storeSize,
      ms(s.medianMs.raiminiscence),
      ms(s.medianMs.hippo),
      `${ms(s.medianDifferenceMs)} [${s.ci95Ms[0].toFixed(1)}, ${s.ci95Ms[1].toFixed(1)}]`,
      `${s.raiminiscenceFasterPairs} of ${s.pairs}`,
      `${loadAverage[0].toFixed(1)} → ${loadAverage[1].toFixed(1)}`,
      s.medianMs.raiminiscence <= s.medianMs.hippo ? "yes" : "no",
    ].join(" | "),
  );
  return [
    `# Per-turn hook latency, interleaved (${date})`,
    "",
    "ADR-0039's acceptance check. rAIminiscence's real built hook shim, with the real built MCP server running in the same project, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.",
    "",
    `Method: ${WARM_UP_CALLS} untimed warm-up calls of each, then ${PAIRS} pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Meets the bar" means rAIminiscence's median is at or below hippo-memory's.`,
    "",
    "| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Meets the bar |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "",
    "Single machine, single run. Raw per-call timings are in the JSON file alongside.",
    "",
  ].join("\n");
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const results: SizeResult[] = [];
  for (const size of STORE_SIZES) {
    const result = await measureSize(size);
    console.log(JSON.stringify({ storeSize: size, ...result.summary }));
    results.push(result);
  }
  const base = join(import.meta.dirname, "results", `${date}-hook-latency-interleaved`);
  writeFileSync(`${base}.json`, JSON.stringify({ date, pairs: PAIRS, warmUpCalls: WARM_UP_CALLS, results }, null, 2) + "\n");
  writeFileSync(`${base}.md`, report(date, results));
  console.log(`Wrote ${base}.md`);
}

await main();
