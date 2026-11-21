import type { Memory, MemoryKind } from "./types.js";
import { CONFIDENCE_WEIGHT, computeStrength } from "./decay.js";
import { cosineSimilarity, type PackedEmbeddingIndex } from "./embeddings/packed-index.js";
import { identitiesCompatible, type EmbeddingProviderIdentity } from "./embeddings/provider.js";
import { addSymmetricEntry, conflictVerdict, conflictsAmong, type ConflictIndex } from "./conflict-edge.js";
import { clusterSimilarityThreshold } from "./clustering.js";
import { summaryOf } from "./memory-view.js";
import { bm25Scores, minMaxNormalize } from "./lexical-scoring.js";
import type { RecallResultItem } from "./recall.js";

/**
 * v15 (ADR-0022): `recall`'s scoring logic — embedding similarity, Strength,
 * Confidence Tier weighting, and Conflict Candidate detection — extracted
 * into this module so `recall()` and Inspect's `inspectQuery()`
 * (`inspect.ts`) call the exact same pure scoring core instead of two
 * independently-maintained copies. Nothing here ever mutates stored state;
 * `recall()` alone performs the mutation (`writeMemory`) after this core returns.
 */

/**
 * How a `recall` result arrived. ADR-0037 removed Spreading Activation, so
 * every result is `"match"`; the `"connection-N"` members stay in the type so
 * a consumer's exhaustive check written against the earlier API still compiles.
 */
export type SurfacedVia = "match" | "connection-1" | "connection-2" | "connection-3";

/** Naive keyword-overlap scorer; used only when no embedding provider is reachable. */
export function naiveScore(query: string, body: string): number {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0) return 0;
  const haystack = body.toLowerCase();
  const matches = queryTokens.filter((token) => haystack.includes(token));
  return matches.length / queryTokens.length;
}

/** A pool candidate with its similarity-based scores. */
export interface CandidateBase {
  memory: Memory;
  strength: number;
  /** Raw similarity x Strength x Confidence Tier weight: what `minScore` gates. */
  baseScore: number;
  /** ADR-0032: fused lexical + embedding similarity x the same weights: what ranks. */
  rankScore: number;
}

/** A candidate carrying its final score and how it arrived there (`RecallResultItem.surfacedVia`). */
export interface ScoredCandidate extends CandidateBase {
  score: number;
  surfacedVia: SurfacedVia;
}

/**
 * For every pair within `ids` (a `recall`/`inspectQuery` call's final
 * returned result set): a confirmed `"contradicts"` verdict populates
 * `conflictsWith`; no recorded verdict at all, with both embeddings present
 * and cosine-similar at or above Clustering's threshold, populates
 * `conflictCandidateWith` instead; `"supersedes"`/`"no-conflict"` or a
 * missing embedding populates neither. Open to every Memory Kind except
 * Checkpoint — `ids` is already Scope/`kind`-filtered by the caller, so no
 * further boundary check is needed here beyond the v13 (ADR-0020)
 * Checkpoint exclusion: successive Checkpoints on the same evolving task are
 * expected to be near-duplicates by construction, not a genuine
 * disagreement, so a pair is never even considered for
 * `conflictCandidateWith` (regardless of similarity) when either side is a
 * Checkpoint.
 */
export function computeConflictFields(
  ids: string[],
  conflictIndex: ConflictIndex,
  embeddingIndex: PackedEmbeddingIndex,
  kindOf: (id: string) => MemoryKind | undefined,
): { conflictsWith: Map<string, string[]>; conflictCandidateWith: Map<string, string[]> } {
  const conflictsWith = conflictsAmong(conflictIndex, ids);
  const conflictCandidateWith = new Map<string, string[]>();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      if (kindOf(a) === "checkpoint" || kindOf(b) === "checkpoint") continue;
      if (conflictVerdict(conflictIndex, a, b) !== undefined) continue;
      const recordA = embeddingIndex[a];
      const recordB = embeddingIndex[b];
      if (recordA === undefined || recordB === undefined) continue;
      // v17: two Memories embedded under different Providers/models
      // are never compared, same as either side missing an embedding at all.
      if (!identitiesCompatible(recordA.identity, recordB.identity)) continue;
      if (cosineSimilarity(recordA.vector, recordB.vector) >= clusterSimilarityThreshold(recordA.identity)) {
        addSymmetricEntry(conflictCandidateWith, a, b);
      }
    }
  }

  return { conflictsWith, conflictCandidateWith };
}

/**
 * The `RecallResultItem` mapping `recall()` and `inspectQuery()` both need
 * for one of their own scored candidates, verbatim — the third piece (after
 * `scoreCandidatesForQuery`/`computeConflictFields`) of the scoring path
 * they already share.
 */
export function toRecallResultItem(
  candidate: ScoredCandidate,
  conflictsWith: Map<string, string[]>,
  conflictCandidateWith: Map<string, string[]>,
): RecallResultItem {
  const { memory, score, strength, surfacedVia } = candidate;
  return {
    id: memory.frontmatter.id,
    kind: memory.frontmatter.kind,
    confidence: memory.frontmatter.confidence,
    scope: memory.frontmatter.scope,
    source: memory.frontmatter.source,
    summary: summaryOf(memory.body),
    detail: memory.body,
    score,
    strength,
    surfacedVia,
    conflictCandidateWith: conflictCandidateWith.get(memory.frontmatter.id),
    conflictsWith: conflictsWith.get(memory.frontmatter.id),
  };
}

export interface ScoreCandidatesParams {
  query: string;
  /** Already resolved by the caller (`provider.embed(query)`) — this core is fully synchronous. */
  queryVector: number[] | null;
  /** v17: the Provider/model identity `queryVector` was actually embedded with — irrelevant when `queryVector` is `null`. */
  queryIdentity: EmbeddingProviderIdentity;
  /** Already Scope/`kind`-filtered, active-only Memories to score. */
  pool: Memory[];
  now: Date;
  index: PackedEmbeddingIndex;
  minScore: number;
}

export interface ScoreCandidatesResult {
  /** Qualifying candidates, ranked desc by score. Unsliced — callers apply their own `k`. */
  scored: ScoredCandidate[];
  /** Non-qualifying candidates — what `recall` would never return, given this pool. */
  belowMinScore: CandidateBase[];
  /** Every candidate this call considered, keyed by id. */
  candidatesById: Map<string, CandidateBase>;
}

/** ADR-0032: the dense and lexical halves weigh equally in the fused similarity. */
const DENSE_WEIGHT = 0.5;

/**
 * ADR-0032: each candidate's raw similarity and BM25 score, both min-max
 * normalised over the pool, mixed by `DENSE_WEIGHT`. Without a query
 * embedding there is nothing to fuse with: the raw similarity ranks alone.
 */
function fusedSimilarities(query: string, pool: Memory[], similarities: number[], queryVector: number[] | null): number[] {
  if (queryVector === null) return similarities;
  const dense = minMaxNormalize(similarities);
  const lexical = minMaxNormalize(
    bm25Scores(
      query,
      pool.map((memory) => memory.body),
    ),
  );
  return dense.map((value, i) => DENSE_WEIGHT * value + (1 - DENSE_WEIGHT) * lexical[i]!);
}

/**
 * `scoreCandidatesForQuery`'s first phase: cosine similarity (or the naive
 * keyword fallback) x Strength x Confidence Tier weight, per pool candidate,
 * plus the fused ranking score (ADR-0032) under the same weights.
 */
function computeBaseScores(
  pool: Memory[],
  now: Date,
  index: PackedEmbeddingIndex,
  query: string,
  queryVector: number[] | null,
  queryIdentity: EmbeddingProviderIdentity,
): CandidateBase[] {
  const similarities = pool.map((memory) => {
    const candidateRecord = index[memory.frontmatter.id];
    // v17: a candidate embedded under a different Provider/model
    // than the one that just embedded `query` is treated exactly like a
    // failed `embed()` call for this candidate — absent, naive fallback.
    const candidateMatches = candidateRecord !== undefined && identitiesCompatible(candidateRecord.identity, queryIdentity);
    return queryVector !== null && candidateMatches ? cosineSimilarity(queryVector, candidateRecord.vector) : naiveScore(query, memory.body);
  });
  const fused = fusedSimilarities(query, pool, similarities, queryVector);
  return pool.map((memory, i) => {
    const strength = computeStrength(memory.frontmatter, now);
    const weight = strength * (CONFIDENCE_WEIGHT[memory.frontmatter.confidence] ?? 0);
    return { memory, strength, baseScore: similarities[i]! * weight, rankScore: fused[i]! * weight };
  });
}

/**
 * The pure scoring core shared by `recall()` and `inspectQuery()`: the fused
 * similarity x Strength x Confidence Tier weight ranks every candidate that
 * cleared `minScore` on its raw similarity alone. Never mutates anything —
 * no `writeMemory`.
 */
export function scoreCandidatesForQuery(params: ScoreCandidatesParams): ScoreCandidatesResult {
  const { query, queryVector, queryIdentity, pool, now, index, minScore } = params;

  const candidates = computeBaseScores(pool, now, index, query, queryVector, queryIdentity);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.memory.frontmatter.id, candidate]));

  // ADR-0032: a fused-score tie falls back to the raw similarity.
  const scored = candidates
    .filter(({ baseScore }) => baseScore > minScore)
    .map((candidate) => ({ ...candidate, score: candidate.rankScore, surfacedVia: "match" as const }))
    .sort((a, b) => b.score - a.score || b.baseScore - a.baseScore);
  const belowMinScore = candidates.filter(({ baseScore }) => baseScore <= minScore);

  return { scored, belowMinScore, candidatesById };
}
