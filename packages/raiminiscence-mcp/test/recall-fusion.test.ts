import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall, remember } from "#src/core/engine.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

/** Fixed vectors per phrase, so the dense half of the fused score is known exactly. */
function stubProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    identity: { provider: "stub", model: "stub" },
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

describe("recall's fused lexical and embedding ranking (ADR-0032)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-fusion-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  async function rememberAll(provider: EmbeddingProvider, contents: string[]): Promise<void> {
    for (const content of contents) {
      await remember({ content, client: "claude-code", storageRoot, embeddingProvider: provider, triggerConsolidation: false });
    }
  }

  it("ranks a Memory sharing the query's words above a slightly closer embedding with none of them", async () => {
    const query = "kafka consumer lag alert";
    const lexicalMatch = "The kafka consumer lag alert fires at ten thousand messages";
    const closerEmbedding = "Queue backlog paging thresholds for the stream processors";
    const unrelated = "Lunch is at noon on Fridays";
    const provider = stubProvider({
      [query]: [1, 0],
      [lexicalMatch]: [0.9, 0.44],
      [closerEmbedding]: [0.95, 0.31],
      [unrelated]: [0, 1],
    });
    await rememberAll(provider, [closerEmbedding, lexicalMatch, unrelated]);

    const result = await recall({ query, storageRoot, embeddingProvider: provider, triggerConsolidation: false });

    expect(result.usedFallback).toBe(false);
    expect(result.results.map(({ summary }) => summary)).toEqual([lexicalMatch, closerEmbedding]);
  });

  it("still returns the pool's lowest-scoring Memory at the default minScore", async () => {
    const query = "release checklist";
    const provider = stubProvider({
      [query]: [1, 0],
      "Release checklist lives in the wiki": [0.9, 0.1],
      "Coffee machine descaling schedule": [0.2, 0.8],
    });
    await rememberAll(provider, ["Release checklist lives in the wiki", "Coffee machine descaling schedule"]);

    const result = await recall({ query, storageRoot, embeddingProvider: provider, triggerConsolidation: false });

    expect(result.results).toHaveLength(2);
  });

  it("returns a single-Memory pool with a positive score", async () => {
    const query = "staging database host";
    const provider = stubProvider({ [query]: [1, 0], "Staging runs on db-stg-2": [0.7, 0.3] });
    await rememberAll(provider, ["Staging runs on db-stg-2"]);

    const result = await recall({ query, storageRoot, embeddingProvider: provider, triggerConsolidation: false });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.score).toBeGreaterThan(0);
  });

  it("keeps minScore a threshold on raw similarity, not on the pool-relative fused score", async () => {
    const query = "feature flag rollout";
    const provider = stubProvider({
      [query]: [1, 0],
      "Feature flag rollout goes 1%, 10%, 100%": [0.3, 0.95],
      "Unrelated note about parking": [0.1, 0.99],
    });
    await rememberAll(provider, ["Feature flag rollout goes 1%, 10%, 100%", "Unrelated note about parking"]);

    const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.5, triggerConsolidation: false });

    expect(result.results).toEqual([]);
  });
});
