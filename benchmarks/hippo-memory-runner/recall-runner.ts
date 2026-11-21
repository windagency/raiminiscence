import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHippo, hippoRecall, writeHippoMemory, type MemoryKind } from "./hippo-cli.js";
import { loadCorpusFile, withTempDir } from "../temp-dir.js";

interface CorpusMemory {
  id: string;
  kind: MemoryKind;
  content: string;
}

interface CorpusQuery {
  id: string;
  query: string;
  relevantIds: string[];
}

export interface HippoRecallHitResult {
  id: string;
  score: number;
}

export interface HippoQueryResult {
  queryId: string;
  query: string;
  relevantIds: string[];
  topK: HippoRecallHitResult[];
}

export interface HippoRecallRun {
  system: "hippo-memory";
  k: number;
  storageRoot: string;
  perQuery: HippoQueryResult[];
}

/**
 * Loads the shared corpus once into a fresh, uniquely-named isolated
 * directory (its own `.hippo/`, never reused across runs, never shared with
 * the rAIminiscence runner) via hippo-memory's real CLI, then evaluates
 * each query from queries.json against its own throwaway *copy* of that
 * seeded `.hippo/` store — mirroring the rAIminiscence runner's own
 * per-query isolation (hippo's `recall` also has real side effects:
 * retrieval-count-driven salience, co-access-style graph edges when
 * `--hops`/`--graph-stream` are used), so a 10-query ground-truth batch here
 * scores each query against the same untouched corpus, never against state
 * shaped by an earlier query in this same batch.
 */
export async function runHippoRecallBenchmark(): Promise<HippoRecallRun> {
  const { memories } = loadCorpusFile<{ memories: CorpusMemory[] }>("memories.json");
  const { k, queries } = loadCorpusFile<{ k: number; queries: CorpusQuery[] }>("queries.json");

  const storageRoot = mkdtempSync(join(tmpdir(), "hippo-bench-recall-base-"));
  const initResult = runHippo(["init", "--no-hooks", "--no-schedule", "--no-learn"], storageRoot);
  if (initResult.status !== 0) throw new Error(`hippo init failed: ${initResult.stderr}`);

  const hippoIdToCorpusId = new Map<string, string>();
  for (const memory of memories) {
    const hippoId = writeHippoMemory(memory, storageRoot);
    hippoIdToCorpusId.set(hippoId, memory.id);
  }

  // `hippo remember` auto-embeds on write when `@huggingface/transformers` is
  // installed (confirmed empirically), but `hippo decide` does not — an
  // explicit `hippo embed` closes that gap for the corpus's decision-kind
  // memories before any per-query copy is made, so every copy inherits a
  // fully-embedded base store.
  const embedResult = runHippo(["embed"], storageRoot);
  if (embedResult.status !== 0) throw new Error(`hippo embed failed: ${embedResult.stderr}`);

  const perQuery: HippoQueryResult[] = [];
  for (const q of queries) {
    await withTempDir(`hippo-bench-recall-${q.id}-`, async (queryStorageRoot) => {
      cpSync(storageRoot, queryStorageRoot, { recursive: true });
      const response = hippoRecall(q.query, queryStorageRoot);
      perQuery.push({
        queryId: q.id,
        query: q.query,
        relevantIds: q.relevantIds,
        topK: response.results.slice(0, k).map((hit) => ({
          id: hippoIdToCorpusId.get(hit.id) ?? hit.id,
          score: hit.score,
        })),
      });
    });
  }

  return { system: "hippo-memory", k, storageRoot, perQuery };
}

/** Deletes a run's isolated temp storage root. Call after results are captured. */
export function cleanupHippoRun(storageRoot: string): void {
  rmSync(storageRoot, { recursive: true, force: true });
}
