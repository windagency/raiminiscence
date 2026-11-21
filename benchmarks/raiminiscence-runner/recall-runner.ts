import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remember, recall } from "../../packages/raiminiscence-mcp/src/core/engine.js";
import type { MemoryKind } from "../../packages/raiminiscence-mcp/src/core/types.js";
import { resolveEmbeddingProvider } from "./embedding-provider.js";
import { loadCorpusFile, withTempDir } from "../temp-dir.js";

const embeddingProvider = resolveEmbeddingProvider();

interface CorpusMemory {
  id: string;
  kind: MemoryKind;
  content: string;
}

interface CorpusQuery {
  id: string;
  query: string;
  relevantIds: string[];
  note?: string;
}

export interface RaiminiscenceRecallHit {
  id: string;
  score: number;
}

export interface RaiminiscenceQueryResult {
  queryId: string;
  query: string;
  relevantIds: string[];
  topK: RaiminiscenceRecallHit[];
}

export interface RaiminiscenceRecallRun {
  system: "raiminiscence";
  k: number;
  storageRoot: string;
  perQuery: RaiminiscenceQueryResult[];
}

/**
 * Loads the shared corpus once into a fresh, uniquely-named base temp
 * directory (never reused across benchmark runs, never shared with the
 * hippo-memory runner), then evaluates each query from queries.json against
 * its own throwaway *copy* of that seeded store, via the real, in-process
 * `remember`/`recall` engine functions (no MCP protocol involved, per the
 * HLD's stated zero-MCP-dependency design) — the exact same functions the
 * MCP server itself calls.
 *
 * Per-query copies matter for correctness, not just isolation: `recall()`
 * has real, intentional side effects on the store it's called against
 * (Spaced Repetition's `lastRecalledAt`/`recallCount`) — exactly what you
 * want across a real session's *sequence* of recalls, but not what you want
 * when scoring 10 independent ground-truth queries against one fixed corpus:
 * without per-query isolation, query 2 would already be scored against a
 * corpus whose recall counts were
 * shaped by query 1's results, snowballing by query 10. Each query here
 * instead sees the same untouched, freshly-seeded corpus.
 *
 * Returns each query's ULID-keyed top-k so compare.ts can score
 * Recall@k/Precision@k against queries.json's hand-authored ground truth.
 * The caller is responsible for cleaning up `storageRoot` once done (the
 * base store is kept alive here for post-hoc inspection; per-query copies
 * are deleted internally as they're used).
 */
export async function runRaiminiscenceRecallBenchmark(): Promise<RaiminiscenceRecallRun> {
  const { memories } = loadCorpusFile<{ memories: CorpusMemory[] }>("memories.json");
  const { k, queries } = loadCorpusFile<{ k: number; queries: CorpusQuery[] }>("queries.json");

  const storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-bench-recall-base-"));

  // corpusId -> the ULID rAIminiscence actually assigned it, so results can
  // be reported back keyed by the shared, human-authored corpus id rather
  // than an opaque ULID.
  const ulidToCorpusId = new Map<string, string>();

  for (const memory of memories) {
    const result = await remember({
      content: memory.content,
      kind: memory.kind,
      client: "benchmark",
      storageRoot,
      embeddingProvider,
      triggerConsolidation: false,
    });
    ulidToCorpusId.set(result.id, memory.id);
  }

  const perQuery: RaiminiscenceQueryResult[] = [];
  for (const q of queries) {
    await withTempDir(`raiminiscence-bench-recall-${q.id}-`, async (queryStorageRoot) => {
      cpSync(storageRoot, queryStorageRoot, { recursive: true });
      const result = await recall({
        query: q.query,
        k,
        storageRoot: queryStorageRoot,
        embeddingProvider,
        triggerConsolidation: false,
      });
      perQuery.push({
        queryId: q.id,
        query: q.query,
        relevantIds: q.relevantIds,
        topK: result.results.map((item) => ({
          id: ulidToCorpusId.get(item.id) ?? item.id,
          score: item.score,
        })),
      });
    });
  }

  return { system: "raiminiscence", k, storageRoot, perQuery };
}

/** Deletes a run's isolated temp storage root. Call after results are captured. */
export function cleanupRaiminiscenceRun(storageRoot: string): void {
  rmSync(storageRoot, { recursive: true, force: true });
}
