import { performance } from "node:perf_hooks";
import { runHippo, writeHippoMemory } from "./hippo-cli.js";
import { generateSyntheticMemories } from "../corpus/synthetic-memories.js";
import { withTempDir } from "../temp-dir.js";

export interface LatencyMeasurement {
  storeSize: number;
  medianLatencyMs: number;
  latenciesMs: number[];
  outputChars: number;
  outputApproxTokens: number;
}

const REPS = 5;

/**
 * hippo-memory's real `UserPromptSubmit` hook command, confirmed against its
 * own source (`dist/hooks.js`, `HIPPO_PINNED_INJECT_COMMAND` /
 * `HIPPO_PINNED_INJECT_MARKER`) rather than assumed from documentation —
 * this is the literal command it fires on every turn, not an approximation.
 */
const CONTEXT_ARGS = ["context", "--pinned-only", "--include-recent", "5", "--format", "additional-context"];

/**
 * Measures hippo-memory's real per-turn hook command at increasing store
 * sizes, mirroring the rAIminiscence latency-runner's methodology (same
 * store sizes, same REPS, same warm-up-then-measure shape, same isolated
 * temp-.hippo-per-size convention as recall-runner.ts).
 *
 * Important structural note surfaced by this measurement, not assumed going
 * in: `--pinned-only --include-recent 5` means hippo's real per-turn hook
 * only ever considers pinned memories plus the last 5 writes, regardless of
 * total store size — a structurally bounded query, unlike rAIminiscence's
 * v10 hook, which runs a full similarity search across the entire store on
 * every turn. This measurement reports both wall-clock latency AND output
 * size at each store size so that structural difference shows up in the
 * numbers rather than being asserted narratively.
 */
export async function runHippoLatencyBenchmark(storeSizes: number[]): Promise<LatencyMeasurement[]> {
  const results: LatencyMeasurement[] = [];

  for (const size of storeSizes) {
    await withHippoHookStore(size, async (callHook) => {
      // Warm-up, excluded from measurement — same rationale as the
      // rAIminiscence runner: measure steady-state, not process cold-start.
      callHook();

      const latenciesMs: number[] = [];
      let lastOutput = "";
      for (let i = 0; i < REPS; i++) {
        const start = performance.now();
        lastOutput = callHook();
        latenciesMs.push(performance.now() - start);
      }
      latenciesMs.sort((a, b) => a - b);
      const medianLatencyMs = latenciesMs[Math.floor(latenciesMs.length / 2)]!;

      results.push({
        storeSize: size,
        medianLatencyMs,
        latenciesMs,
        outputChars: lastOutput.length,
        outputApproxTokens: Math.round(lastOutput.length / 4),
      });
    });
  }

  return results;
}

/**
 * Seeds a fresh hippo-memory store of `size` synthetic memories, embeds
 * them, and hands `use` one call of hippo's real per-turn hook command on
 * it. Shared by the benchmark above and the interleaved hook comparison.
 */
export async function withHippoHookStore<T>(size: number, use: (callHook: () => string) => Promise<T>): Promise<T> {
  return withTempDir(`hippo-bench-latency-${size}-`, async (storageRoot) => {
    const initResult = runHippo(["init", "--no-hooks", "--no-schedule", "--no-learn"], storageRoot);
    if (initResult.status !== 0) throw new Error(`hippo init failed: ${initResult.stderr}`);

    for (const memory of generateSyntheticMemories(size)) {
      writeHippoMemory(memory, storageRoot);
    }

    const embedResult = runHippo(["embed"], storageRoot);
    if (embedResult.status !== 0) throw new Error(`hippo embed failed: ${embedResult.stderr}`);

    return use(() => {
      const result = runHippo(CONTEXT_ARGS, storageRoot);
      if (result.status !== 0) throw new Error(`hippo context failed: ${result.stderr}`);
      return result.stdout;
    });
  });
}
