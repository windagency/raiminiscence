import type { Memory } from "./types.js";
import { readAllMemories, writeMemory } from "./storage.js";
import { createFrontmatter } from "./create-frontmatter.js";
import { summaryOf } from "./memory-view.js";
import { type PackedEmbeddingIndex, cosineSimilarity } from "./embeddings/packed-index.js";
import { identitiesCompatible, NOMIC_TASK_PREFIX, type EmbeddingProviderIdentity } from "./embeddings/provider.js";
import { isContradicting, type ConflictIndex } from "./conflict-edge.js";

/**
 * v17 (ADR-0024): empirically re-validated against the Embedded
 * Provider's own similarity distribution when it became the new default —
 * kept unchanged. Under both providers this value sits above every
 * confusable-sibling pair tested (with more margin for the Embedded
 * Provider than for Ollama) at the cost of recall on subtler near-duplicate
 * pairs, an acceptable trade for a threshold whose job is avoiding false
 * merges, not maximising recall.
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.82;

/**
 * ADR-0042: nomic's task prefixes lift every similarity, the median corpus
 * pair from 0.42 to 0.57 Embedded. 0.87 keeps the Embedded Provider's merges
 * on `benchmarks/corpus/memories.json` exactly as they were at 0.82, with the
 * same margin over its closest confusable sibling, and widens Ollama's.
 */
export const PREFIXED_CLUSTER_SIMILARITY_THRESHOLD = 0.87;

/** The similarity at or above which two vectors of `identity` count as the same thing. */
export function clusterSimilarityThreshold(identity: EmbeddingProviderIdentity): number {
  return identity.prompt === NOMIC_TASK_PREFIX ? PREFIXED_CLUSTER_SIMILARITY_THRESHOLD : CLUSTER_SIMILARITY_THRESHOLD;
}

export interface ClusteringResult {
  clusters: Memory[][];
  /**
   * v6 (ADR-0011): incremented once per candidate excluded from a seed's
   * Cluster by a confirmed "contradicts" verdict, checked before
   * similarity — so this counts every contradicting pair encountered, not
   * only ones that would otherwise have cleared the threshold.
   */
  blockedJoinAttempts: number;
}

/**
 * Simple greedy single-pass grouping: each unclaimed episodic memory seeds
 * a cluster, pulling in every other unclaimed memory cosine-similar enough
 * to it. Memories with no stored embedding (never embedded, or the
 * provider was unreachable at write time) can't be clustered. v6
 * (ADR-0011): a candidate with a confirmed "contradicts" Conflict Edge
 * against the seed is excluded from that Cluster regardless of
 * similarity — checked seed-to-candidate only, matching the similarity
 * check's own granularity.
 */
export function clusterEpisodicMemories(memories: Memory[], index: PackedEmbeddingIndex, conflictIndex: ConflictIndex): ClusteringResult {
  const withVectors = memories.filter((memory) => index[memory.frontmatter.id] !== undefined);
  const assigned = new Set<string>();
  const clusters: Memory[][] = [];
  let blockedJoinAttempts = 0;

  for (const seed of withVectors) {
    if (assigned.has(seed.frontmatter.id)) continue;
    // withVectors only holds Memories that have an index entry.
    const seedRecord = index[seed.frontmatter.id]!;
    const cluster: Memory[] = [seed];
    assigned.add(seed.frontmatter.id);

    for (const candidate of withVectors) {
      if (assigned.has(candidate.frontmatter.id)) continue;
      if (isContradicting(conflictIndex, seed.frontmatter.id, candidate.frontmatter.id)) {
        blockedJoinAttempts += 1;
        continue;
      }
      // v17: a seed/candidate pair embedded under different
      // Providers/models is never compared — silently skipped, same as
      // either side missing an embedding entirely (not counted as blocked).
      const candidateRecord = index[candidate.frontmatter.id]!;
      if (!identitiesCompatible(seedRecord.identity, candidateRecord.identity)) continue;
      const similarity = cosineSimilarity(seedRecord.vector, candidateRecord.vector);
      if (similarity >= clusterSimilarityThreshold(seedRecord.identity)) {
        cluster.push(candidate);
        assigned.add(candidate.frontmatter.id);
      }
    }

    if (cluster.length >= 2) clusters.push(cluster);
  }

  return { clusters, blockedJoinAttempts };
}

export function promoteCluster(storageRoot: string, cluster: Memory[], now: Date): Memory {
  const promotedFrom = cluster.map((memory) => memory.frontmatter.id);
  const summaries = cluster.map((memory) => summaryOf(memory.body));
  // A Cluster always holds at least two Memories (clusterEpisodicMemories).
  const anchor = cluster[0]!.frontmatter;

  const semanticMemory: Memory = {
    frontmatter: createFrontmatter({
      kind: "semantic",
      confidence: "inferred",
      createdAt: now.toISOString(),
      source: anchor.source,
      scope: anchor.scope,
      originatingProject: anchor.originatingProject,
      promotedFrom,
    }),
    body: `Consolidated pattern from ${cluster.length} related observations.\n${summaries.join("; ")}`,
  };

  writeMemory(storageRoot, semanticMemory);

  for (const contributor of cluster) {
    contributor.frontmatter.consolidationSurvivalCount += 1;
    writeMemory(storageRoot, contributor);
  }

  return semanticMemory;
}

export function alreadyPromotedIds(storageRoot: string): Set<string> {
  const ids = readAllMemories(storageRoot, ["semantic"]).flatMap((memory) => memory.frontmatter.promotedFrom ?? []);
  return new Set(ids);
}
