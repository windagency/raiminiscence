import type { Memory } from "./types.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { identitiesCompatible } from "./embeddings/provider.js";
import { type PackedEmbeddingIndex, upsertVector } from "./embeddings/packed-index.js";

/**
 * v17: active Memories whose stored embedding identity doesn't
 * match `provider`'s own identity — Re-embedding's candidate pool. ADR-0041
 * adds Memories with no stored embedding at all.
 */
export function mismatchedEmbeddings(memories: Memory[], index: PackedEmbeddingIndex, provider: EmbeddingProvider): Memory[] {
  return memories.filter((memory) => {
    const record = index[memory.frontmatter.id];
    // ADR-0041: a Memory with no vector at all is healed too, e.g. one whose background embed never landed.
    return record === undefined || !identitiesCompatible(record.identity, provider.identity);
  });
}

/**
 * Recomputes and persists a healed vector+identity for each mismatched
 * Memory, so every later Consolidation step in the same pass (Clustering
 * onward) sees an ordinary, fully-embedded Memory again — this is a
 * to-and-fro transition, not a one-way state change like
 * Invalidation/Forget. A `null` embed (provider unreachable) leaves that
 * Memory's old vector and identity untouched — it stays on the
 * lexical-fallback path exactly as before this step ran, and is retried on
 * the next Consolidation pass. The first `null` ends this pass's healing: an
 * unreachable provider would fail every remaining Memory the same way, one
 * timeout each.
 */
export async function reembedMismatched(storageRoot: string, mismatched: Memory[], provider: EmbeddingProvider): Promise<number> {
  let reembedded = 0;
  for (const memory of mismatched) {
    const vector = await provider.embed(memory.body, "document");
    if (vector === null) break;
    upsertVector(storageRoot, memory.frontmatter.id, vector, provider.identity);
    reembedded += 1;
  }
  return reembedded;
}
