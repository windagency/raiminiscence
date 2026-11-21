import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { withHippoHookStore } from "./hippo-memory-runner/latency-runner.js";
import { pairedLatencySummary, type PairedLatencySummary } from "./paired-latency.js";
import { withShimStore, type ShimStore } from "./raiminiscence-runner/latency-runner.js";

/**
 * ADR-0040's acceptance check, on rAIminiscence's real built hook shim with
 * no MCP server running:
 *
 * - First prompt: a call that finds no warm process and starts one, against
 *   the same call with `RAIMINISCENCE_WARM_EMBED=off`, today's cold hook.
 *   Each timed call starts from no warm process and no spawn marker.
 * - Later prompts: once the hook's own warm process serves, the shim
 *   against hippo-memory's real per-turn hook, interleaved as in
 *   `hook-latency-interleaved.ts`.
 * - Output: the warm-served context equals the cold one.
 * - Concurrency, once: ten first calls at the same moment leave one warm process.
 *
 * The idle exit is not timed here: at 30 minutes per store it is covered by
 * `packages/raiminiscence-mcp/test/warm-process.test.ts` instead.
 *
 * usage: tsx benchmarks/warm-process-acceptance.ts
 */

const STORE_SIZES = [10, 50, 150, 300, 750, 1500];
const FIRST_PROMPT_PAIRS = 11;
const PAIRS = 21;
const WARM_UP_CALLS = 2;
const CONCURRENT_CALLS = 10;
/** ADR-0040: the most a first prompt may cost over today's no-server hook. */
const FIRST_PROMPT_BUDGET_MS = 20;

interface FirstPrompt {
  /** Median of spawning minus today's, pair by pair: what starting a warm process adds. */
  medianExtraMs: number;
  ci95Ms: [number, number];
  medianMs: { spawning: number; today: number };
  spawningMs: number[];
  todayMs: number[];
}

interface SizeResult {
  storeSize: number;
  firstPrompt: FirstPrompt;
  laterPrompts: PairedLatencySummary & { raiminiscenceMs: number[]; hippoMs: number[] };
  identicalOutput: boolean;
  /** One-minute load average before and after the size. */
  loadAverage: [number, number];
}

function time(call: () => string): number {
  const start = performance.now();
  call();
  return performance.now() - start;
}

async function measureFirstPrompt(store: ShimStore): Promise<FirstPrompt> {
  const spawningMs: number[] = [];
  const todayMs: number[] = [];
  const spawning = async () => {
    await store.resetWarmProcesses();
    spawningMs.push(time(() => store.callShim()));
    // Untimed, before the next call: the new warm process's model load would compete with it.
    await store.resetWarmProcesses();
  };
  const today = () => todayMs.push(time(() => store.callShim({ RAIMINISCENCE_WARM_EMBED: "off" })));
  for (let i = 0; i < FIRST_PROMPT_PAIRS; i++) {
    if (i % 2 === 0) {
      await spawning();
      today();
    } else {
      today();
      await spawning();
    }
  }
  const summary = pairedLatencySummary(spawningMs, todayMs);
  return {
    medianExtraMs: summary.medianDifferenceMs,
    ci95Ms: summary.ci95Ms,
    medianMs: { spawning: summary.medianMs.raiminiscence, today: summary.medianMs.hippo },
    spawningMs,
    todayMs,
  };
}

async function measureSize(storeSize: number): Promise<SizeResult> {
  return withShimStore(storeSize, async (store) => {
    const before = loadavg()[0]!;
    const firstPrompt = await measureFirstPrompt(store);
    const cold = store.callShim({ RAIMINISCENCE_WARM_EMBED: "off" });

    store.callShim();
    await store.awaitServedRecall();
    const identicalOutput = store.callShim() === cold;

    const laterPrompts = await withHippoHookStore(storeSize, async (callHippo) => {
      for (let i = 0; i < WARM_UP_CALLS; i++) {
        store.callShim();
        callHippo();
      }
      const raiminiscenceMs: number[] = [];
      const hippoMs: number[] = [];
      for (let i = 0; i < PAIRS; i++) {
        if (i % 2 === 0) {
          raiminiscenceMs.push(time(() => store.callShim()));
          hippoMs.push(time(callHippo));
        } else {
          hippoMs.push(time(callHippo));
          raiminiscenceMs.push(time(() => store.callShim()));
        }
      }
      return { ...pairedLatencySummary(raiminiscenceMs, hippoMs), raiminiscenceMs, hippoMs };
    });
    return { storeSize, firstPrompt, laterPrompts, identicalOutput, loadAverage: [before, loadavg()[0]!] };
  });
}

/** Warm processes left once ten first calls at the same moment have finished and one has had time to start. */
async function measureConcurrency(): Promise<number> {
  return withShimStore(STORE_SIZES[0]!, async (store) => {
    await Promise.all(Array.from({ length: CONCURRENT_CALLS }, () => store.callShimAsync()));
    await store.awaitServedRecall();
    return store.warmProcessCount();
  });
}

const ms = (value: number) => `${value.toFixed(1)} ms`;
const interval = ([low, high]: [number, number]) => `[${low.toFixed(1)}, ${high.toFixed(1)}]`;

function report(date: string, results: SizeResult[], warmProcesses: number): string {
  const firstRows = results.map(({ storeSize, firstPrompt: f }) =>
    [
      storeSize,
      ms(f.medianMs.today),
      ms(f.medianMs.spawning),
      `${ms(f.medianExtraMs)} ${interval(f.ci95Ms)}`,
      f.medianExtraMs <= FIRST_PROMPT_BUDGET_MS ? "yes" : "no",
    ].join(" | "),
  );
  const laterRows = results.map(({ storeSize, laterPrompts: s, identicalOutput, loadAverage }) =>
    [
      storeSize,
      ms(s.medianMs.raiminiscence),
      ms(s.medianMs.hippo),
      `${ms(s.medianDifferenceMs)} ${interval(s.ci95Ms)}`,
      `${s.raiminiscenceFasterPairs} of ${s.pairs}`,
      identicalOutput ? "yes" : "no",
      `${loadAverage[0].toFixed(1)} → ${loadAverage[1].toFixed(1)}`,
      s.medianMs.raiminiscence <= s.medianMs.hippo ? "yes" : "no",
    ].join(" | "),
  );
  return [
    `# Hook-started warm process, acceptance (${date})`,
    "",
    "ADR-0040's acceptance check. rAIminiscence's real built hook shim with no MCP server running, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.",
    "",
    "## First prompt",
    "",
    `A call that finds no warm process, so recalls locally and then starts one, against the same call with \`RAIMINISCENCE_WARM_EMBED=off\`, which is today's no-server hook. ${FIRST_PROMPT_PAIRS} pairs, the order flipped every pair; every spawning call starts with no warm process and no spawn marker, and the warm process it starts is stopped before the next call. The extra cost is spawning minus today's, pair by pair, with a 95% percentile-bootstrap interval, 10,000 resamples, seed 1. The bar: at most ${FIRST_PROMPT_BUDGET_MS} ms.`,
    "",
    "| Memories | Today's median | Spawning median | Extra cost [95% CI] | Meets the bar |",
    "|---|---|---|---|---|",
    ...firstRows.map((row) => `| ${row} |`),
    "",
    "## Later prompts",
    "",
    `After one call starts the warm process and it answers, ${WARM_UP_CALLS} untimed warm-up calls of each, then ${PAIRS} pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory: negative means rAIminiscence is faster. "Same output" means the warm-served context equals the cold one, character for character. The bar: rAIminiscence's median at or below hippo-memory's.`,
    "",
    "| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Same output | Load average | Meets the bar |",
    "|---|---|---|---|---|---|---|---|",
    ...laterRows.map((row) => `| ${row} |`),
    "",
    "## Concurrency",
    "",
    `${CONCURRENT_CALLS} first calls started at the same moment on a ${STORE_SIZES[0]}-Memory store left ${warmProcesses} warm process${warmProcesses === 1 ? "" : "es"} running. The bar: exactly one.`,
    "",
    "The idle exit is covered by `packages/raiminiscence-mcp/test/warm-process.test.ts`, not timed here. Single machine, single run. Raw per-call timings are in the JSON file alongside.",
    "",
  ].join("\n");
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const warmProcesses = await measureConcurrency();
  console.log(JSON.stringify({ concurrentCalls: CONCURRENT_CALLS, warmProcesses }));
  const results: SizeResult[] = [];
  for (const size of STORE_SIZES) {
    const result = await measureSize(size);
    console.log(
      JSON.stringify({
        storeSize: size,
        firstPromptExtraMs: result.firstPrompt.medianExtraMs,
        later: result.laterPrompts.medianMs,
        same: result.identicalOutput,
      }),
    );
    results.push(result);
  }
  const base = join(import.meta.dirname, "results", `${date}-warm-process-acceptance`);
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ date, firstPromptPairs: FIRST_PROMPT_PAIRS, pairs: PAIRS, warmUpCalls: WARM_UP_CALLS, warmProcesses, results }, null, 2) + "\n",
  );
  writeFileSync(`${base}.md`, report(date, results, warmProcesses));
  console.log(`Wrote ${base}.md`);
}

await main();
