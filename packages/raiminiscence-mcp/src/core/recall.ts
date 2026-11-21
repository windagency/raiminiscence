import type { ConfidenceTier, MemoryKind, MemorySource, Scope } from "./types.js";
import { writeMemory } from "./storage.js";
import { triggerOpportunisticConsolidation, type OpportunisticConsolidationOptIn } from "./opportunistic-consolidation.js";
import { appendCachedRecords } from "./recall-cache.js";
import { computeConflictFields, toRecallResultItem, type SurfacedVia } from "./query-scoring.js";
import { scoreQueryAgainstCache, type CachedQueryParams } from "./cached-query.js";
import type { ServerLogger } from "#src/adapters/logger.js";

export interface RecallParams extends CachedQueryParams, OpportunisticConsolidationOptIn {
  /** Surfaces a detached opportunistic-consolidation-pass failure; unset in tests that don't care. */
  logger?: ServerLogger;
}

export interface RecallResultItem {
  id: string;
  kind: MemoryKind;
  confidence: ConfidenceTier;
  scope: Scope;
  source: MemorySource;
  summary: string;
  detail: string;
  score: number;
  strength: number;
  surfacedVia: SurfacedVia;
  /** v5: an unconfirmed pair — cosine-similar enough, no recorded verdict yet — flagged for the calling agent to judge. */
  conflictCandidateWith?: string[];
  /** v5: a pair with a confirmed `"contradicts"` verdict. */
  conflictsWith?: string[];
}

export interface RecallResult {
  results: RecallResultItem[];
  usedFallback: boolean;
  /** This call scheduled a pass — not a guarantee this call's Memories are covered by the very next one (a nearby call may already have triggered and settled one). */
  consolidationTriggered: boolean;
}

export async function recall(params: RecallParams): Promise<RecallResult> {
  // v15 (ADR-0022): the actual scoring — similarity x Strength x Confidence
  // Tier weight — is shared
  // verbatim with Inspect's `inspectQuery`. Everything below this point is
  // `recall`'s own: picking the top `k` and performing its mutations.
  const {
    scored: rankedCandidates,
    candidatesById,
    scope,
    effectiveRoot,
    now,
    k,
    provider,
    usedFallback,
    index,
    conflictIndex,
    recordsSnapshot,
  } = await scoreQueryAgainstCache(params);

  const scored = rankedCandidates.slice(0, k);

  // Spaced Repetition: being recalled resets the decay anchor and counts
  // toward the effective half-life extension used on the *next* recall.
  for (const { memory } of scored) {
    memory.frontmatter.lastRecalledAt = now.toISOString();
    memory.frontmatter.recallCount += 1;
    writeMemory(effectiveRoot, memory);
  }

  // v14 (ADR-0021): recall is itself a writer (the update just above),
  // not just a reader — patched from the snapshot already held from the top
  // of this call (`recordsSnapshot`), not a fresh read, since the writes
  // above already bumped the version marker as a safety net and a fresh read
  // now would rebuild (already reflecting them) before this patch doubled
  // them up. ADR-0036: appended as one log line, so the very next call (often
  // a fresh per-turn hook process) still finds a warm, correct cache.
  appendCachedRecords(effectiveRoot, recordsSnapshot, { upsertMemories: scored.map(({ memory }) => memory) });

  // v5: Conflict Candidates/confirmed Conflicts are detected at this same
  // point, over this same final result set, reusing the embeddings already
  // loaded for this call.
  const { conflictsWith, conflictCandidateWith } = computeConflictFields(
    scored.map(({ memory }) => memory.frontmatter.id),
    conflictIndex,
    index,
    (id) => candidatesById.get(id)?.memory.frontmatter.kind,
  );

  const consolidationTriggered = triggerOpportunisticConsolidation(scope, params, now, params.triggerConsolidation ?? true, provider, params.logger);

  return {
    results: scored.map((candidate) => toRecallResultItem(candidate, conflictsWith, conflictCandidateWith)),
    usedFallback,
    consolidationTriggered,
  };
}
