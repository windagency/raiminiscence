import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { consolidate } from "../../packages/raiminiscence-mcp/src/core/consolidate.js";
import { recall, remember } from "../../packages/raiminiscence-mcp/src/core/engine.js";
import { settleOpportunisticConsolidation } from "../../packages/raiminiscence-mcp/src/core/opportunistic-consolidation.js";
import { ensureSharedMemoryWorktree } from "../../packages/raiminiscence-mcp/src/core/shared-memory/setup.js";
import { resolveEmbeddingProvider } from "./embedding-provider.js";
import { generateSyntheticMemories } from "../corpus/synthetic-memories.js";
import { withTempDir } from "../temp-dir.js";

const SAMPLE_PROMPT = "How does authentication work in this codebase?";
const embeddingProvider = resolveEmbeddingProvider();

/**
 * v14 (ADR-0021) benchmark addendum: `remember`/`recall` never isolated
 * opportunistic consolidation's own cost or its contention with the *next*
 * tool call from the recall-latency numbers above — this file adds both,
 * per the interview that produced ADR-0021 (scope explicitly widened to
 * include consolidation contention, not just the recall scan itself).
 */
async function seedStore(storageRoot: string, size: number): Promise<void> {
  for (const memory of generateSyntheticMemories(size)) {
    await remember({
      content: memory.content,
      kind: memory.kind,
      client: "benchmark",
      storageRoot,
      embeddingProvider,
      triggerConsolidation: false,
    });
  }
}

export interface ConsolidationDurationMeasurement {
  storeSize: number;
  durationMs: number;
}

/**
 * Q5(A): `consolidate()`'s own wall-clock cost in isolation, no Shared
 * Memory. One fresh store per size, one pass only — unlike the recall
 * latency runner's median-of-5, repeating this on the *same* store isn't
 * meaningful: the first pass promotes/prunes what there is to promote/prune,
 * so a second pass on the same store measures "nothing left to do," not the
 * cost this benchmark is after.
 */
export async function runConsolidationDurationBenchmark(storeSizes: number[]): Promise<ConsolidationDurationMeasurement[]> {
  const results: ConsolidationDurationMeasurement[] = [];
  for (const size of storeSizes) {
    await withTempDir(`raiminiscence-bench-consolidate-${size}-`, async (storageRoot) => {
      await seedStore(storageRoot, size);
      const start = performance.now();
      await consolidate({ storageRoot, scope: "project" });
      results.push({ storeSize: size, durationMs: performance.now() - start });
    });
  }
  return results;
}

export interface ConsolidationContentionMeasurement {
  storeSize: number;
  /** A plain `recall()` right after a `remember()` that opted out of opportunistic consolidation entirely. */
  baselineNextCallLatencyMs: number;
  /** The same next `recall()`, but the preceding `remember()` used its real default (`triggerConsolidation: true`), scheduling a full pass via `setImmediate` on the same event loop. */
  withPendingConsolidationNextCallLatencyMs: number;
  /** `withPendingConsolidationNextCallLatencyMs - baselineNextCallLatencyMs` — the actual user-facing symptom, not consolidation's raw cost. */
  contentionOverheadMs: number;
}

/**
 * Q5(B): how much a *pending* opportunistic consolidation (scheduled by a
 * normal `remember()` call, exactly as production behaves) delays the very
 * next tool call on the same event loop — the thing that actually matters to
 * a user, as opposed to (A)'s raw consolidate() duration.
 */
export async function runConsolidationContentionBenchmark(storeSizes: number[]): Promise<ConsolidationContentionMeasurement[]> {
  const results: ConsolidationContentionMeasurement[] = [];

  for (const size of storeSizes) {
    const baselineNextCallLatencyMs = await withTempDir(`raiminiscence-bench-contention-baseline-${size}-`, async (baselineRoot) => {
      await seedStore(baselineRoot, size);
      await recall({ query: SAMPLE_PROMPT, storageRoot: baselineRoot, embeddingProvider, triggerConsolidation: false }); // warm-up
      const start = performance.now();
      await recall({ query: SAMPLE_PROMPT, storageRoot: baselineRoot, embeddingProvider, triggerConsolidation: false });
      return performance.now() - start;
    });

    const withPendingConsolidationNextCallLatencyMs = await withTempDir(`raiminiscence-bench-contention-live-${size}-`, async (contendedRoot) => {
      await seedStore(contendedRoot, size);
      await recall({ query: SAMPLE_PROMPT, storageRoot: contendedRoot, embeddingProvider, triggerConsolidation: false }); // warm-up, no contention yet

      const oneMore = generateSyntheticMemories(1)[0]!;
      // Production default (`triggerConsolidation` unset ⇒ true): schedules a
      // real Clustering/Promotion/Promotion Audit/Pruning/Invalidation pass
      // via `setImmediate`, returning before that pass runs.
      await remember({
        content: oneMore.content,
        kind: oneMore.kind,
        client: "benchmark",
        storageRoot: contendedRoot,
        embeddingProvider,
      });

      const start = performance.now();
      await recall({ query: SAMPLE_PROMPT, storageRoot: contendedRoot, embeddingProvider, triggerConsolidation: false });
      const latencyMs = performance.now() - start;

      await settleOpportunisticConsolidation();
      return latencyMs;
    });

    results.push({
      storeSize: size,
      baselineNextCallLatencyMs,
      withPendingConsolidationNextCallLatencyMs,
      contentionOverheadMs: withPendingConsolidationNextCallLatencyMs - baselineNextCallLatencyMs,
    });
  }

  return results;
}

export interface ConsolidationSharedMemoryMeasurement {
  storeSize: number;
  durationWithoutSharedMemoryMs: number;
  durationWithSharedMemoryMs: number;
  /** Isolates Shared Memory's `git add`/`commit`/push-attempt cost from consolidate()'s own local compute cost. */
  sharedMemoryOverheadMs: number;
}

/**
 * Q5(C): isolates Shared Memory's `flushSharedMemory` git cost (`add -A`,
 * `commit`, a push attempt against no configured remote — fails fast, still
 * pays the attempt) from consolidate()'s own local compute cost measured in
 * (A). Deliberately run at fewer store sizes than (A)/(B): real `git`
 * subprocesses per size make this the most expensive of the three
 * measurements, and the local-git-cost signal doesn't need the full sweep.
 */
export async function runConsolidationSharedMemoryOverheadBenchmark(storeSizes: number[]): Promise<ConsolidationSharedMemoryMeasurement[]> {
  const results: ConsolidationSharedMemoryMeasurement[] = [];

  for (const size of storeSizes) {
    const durationWithoutSharedMemoryMs = await withTempDir(`raiminiscence-bench-consolidate-nosm-${size}-`, async (plainRoot) => {
      await seedStore(plainRoot, size);
      const start = performance.now();
      await consolidate({ storageRoot: plainRoot, scope: "project" });
      return performance.now() - start;
    });

    const durationWithSharedMemoryMs = await withTempDir(
      `raiminiscence-bench-consolidate-sm-${size}-`,
      async (sharedRoot) => {
        execFileSync("git", ["init", "-q"], { cwd: sharedRoot });
        execFileSync("git", ["config", "user.email", "bench@example.com"], { cwd: sharedRoot });
        execFileSync("git", ["config", "user.name", "Benchmark"], { cwd: sharedRoot });
        execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: sharedRoot });

        await seedStore(sharedRoot, size);
        // Migrates the just-seeded files into a worktree checkout of the
        // Shared Memory orphan branch (ADR-0017) — one-time, idempotent setup,
        // same as the real `SessionStart` hook step.
        ensureSharedMemoryWorktree(sharedRoot);

        const start = performance.now();
        await consolidate({ storageRoot: sharedRoot, scope: "project" }); // internally calls flushSharedMemory
        return performance.now() - start;
      },
      // maxRetries/retryDelay: a git worktree checkout can transiently race
      // rmSync's directory walk (ENOTEMPTY) right after git's own internal
      // bookkeeping finishes writing to .git/worktrees/ — retrying briefly
      // clears it, unlike the other, plain (non-git) temp dirs in this file.
      { maxRetries: 5, retryDelay: 200 },
    );

    results.push({
      storeSize: size,
      durationWithoutSharedMemoryMs,
      durationWithSharedMemoryMs,
      sharedMemoryOverheadMs: durationWithSharedMemoryMs - durationWithoutSharedMemoryMs,
    });
  }

  return results;
}
