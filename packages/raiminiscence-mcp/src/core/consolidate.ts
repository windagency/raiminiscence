import type { ConsolidateScope, Memory, Scope, StorageLocation } from "./types.js";
import { deleteMemory, writeMemory } from "./storage.js";
import { effectiveStorageRoot } from "./project-root.js";
import { isNetNegativeFeedback } from "./memory-view.js";
import { removeVector, type PackedEmbeddingIndex } from "./embeddings/packed-index.js";
import { removeConflictEdgesForId, type ConflictIndex } from "./conflict-edge.js";
import { gitCommitSubjects, gitFileChangeTimestamps, type CommitSubjects, type FileChangeTimestamps } from "./git.js";
import { alreadyPromotedIds, clusterEpisodicMemories, promoteCluster } from "./clustering.js";
import { eligibleForPruning } from "./pruning.js";
import { eligibleForInvalidation } from "./invalidation.js";
import { eligibleForPromotionAudit } from "./promotion-audit.js";
import { eligibleForCommitInvalidation } from "./commit-invalidation.js";
import { flushSharedMemory } from "./shared-memory/sync.js";
import { getCachedEmbeddings, getCachedRecords, rebuildCache } from "./recall-cache.js";
import { mismatchedEmbeddings, reembedMismatched } from "./reembedding.js";
import { awaitPendingEmbeds } from "./pending-embeds.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { defaultProvider } from "./embeddings/default-provider.js";
import { resetOpportunisticConsolidationState } from "./opportunistic-consolidation-state.js";
import { staleMemory } from "./confidence-tier-fsm.js";
import type { ServerLogger } from "#src/adapters/logger.js";

export interface ConsolidateParams extends StorageLocation {
  scope?: ConsolidateScope;
  dryRun?: boolean;
  fileChangeTimestamps?: FileChangeTimestamps;
  commitSubjects?: CommitSubjects;
  now?: Date;
  embeddingProvider?: EmbeddingProvider;
  /**
   * v19 (ADR-0025): default `false` — forwarded to `flushSharedMemory`'s own
   * `awaitPush`. Every caller except the `SessionEnd` hook keeps the
   * default, so `consolidate()`'s own returned promise never waits on a
   * slow or unreachable remote.
   */
  awaitPush?: boolean;
  /**
   * Optional because `core/` itself has no logger dependency — threaded in
   * from `server.ts`, mirroring `recall`/`remember`'s own `logger` param.
   * When present, a real (non-`dryRun`) pass logs its summary result at
   * `info`, and gets forwarded to `flushSharedMemory` so a push failure
   * during this pass's own flush is visible too.
   */
  logger?: ServerLogger;
}

/**
 * Flat top-level counters, matching the spec contract (v1-v9): a new numeric
 * counter touches three sites — this interface, `consolidateOneRoot`'s
 * return object, and `mergeResults`'s explicit field sum (see below). Also,
 * `consolidate`'s `Array.prototype.reduce` has no zero-value seed to update —
 * `scopesToRun` always has at least one entry, so an initial accumulator is
 * never needed. Only `newSemanticIds` is summed by concatenation rather than
 * addition in `mergeResults`, since it's this interface's one non-numeric
 * (array-valued) field.
 */
export interface ConsolidateResult {
  clustersFound: number;
  memoriesPromoted: number;
  memoriesPruned: number;
  contributorsBumped: number;
  newSemanticIds: string[];
  memoriesInvalidated: number;
  blockedJoinAttempts: number;
  /**
   * v7 (ADR-0012): the number of distinct Memories excluded from the
   * episodic candidate pool for having net-negative Outcome Feedback,
   * before clusterEpisodicMemories ever runs — counted once per Memory,
   * not per seed/candidate attempt like blockedJoinAttempts.
   */
  feedbackExcludedCount: number;
  /**
   * v8 (ADR-0013): the number of distinct, currently-active Semantic
   * Memories whose `promotedFrom` contributors carry a confirmed
   * "contradicts" Conflict Edge, checked all-pairs (not seed-to-candidate
   * only). Never combined with `promotionAuditFeedbackCount` — a Semantic
   * Memory caught by both signals in the same run is counted in both.
   */
  promotionAuditConflictCount: number;
  /**
   * v8 (ADR-0013): the number of distinct, currently-active Semantic
   * Memories with at least one `promotedFrom` contributor that's now
   * net-negative on Outcome Feedback, reusing `isNetNegativeFeedback`
   * unchanged from v7.
   */
  promotionAuditFeedbackCount: number;
  /**
   * v9 (ADR-0014): the number of distinct, currently-active Memories (of
   * any Kind) with no `relatedFiles` set, staled because a qualifying
   * commit-subject's extracted target appeared in their body — the exact
   * complement of `memoriesInvalidated`'s own eligibility. Never combined
   * with `memoriesInvalidated`.
   */
  memoriesCommitInvalidated: number;
  /**
   * v17: the number of Memories whose stored embedding identity
   * no longer matched the current default provider and were recomputed by
   * Re-embedding this pass — a to-and-fro healing count, not a one-way
   * transition like `memoriesInvalidated`/`memoriesPruned`.
   */
  memoriesReembedded: number;
}

interface ConsolidateOneRootOptions {
  effectiveRoot: string;
  dryRun: boolean;
  now: Date;
  fileChangeTimestamps: FileChangeTimestamps;
  commitSubjects: CommitSubjects;
  embeddingProvider: EmbeddingProvider;
  awaitPush: boolean;
  logger?: ServerLogger;
}

/**
 * v17: Re-embedding runs first, ahead of Clustering and every
 * other step below, so nothing later in this pass has to reason about a
 * mismatched, not-yet-healed embedding. Returns the possibly-refreshed
 * index — Clustering must see any vectors Re-embedding just healed, not
 * the stale snapshot.
 */
async function runReembedding(
  effectiveRoot: string,
  dryRun: boolean,
  cachedMemories: Memory[],
  index: PackedEmbeddingIndex,
  embeddingProvider: EmbeddingProvider,
) {
  const mismatched = mismatchedEmbeddings(cachedMemories, index, embeddingProvider);
  if (dryRun) {
    return { memoriesReembedded: mismatched.length, index };
  }
  const memoriesReembedded = await reembedMismatched(effectiveRoot, mismatched, embeddingProvider);
  // upsertVector's underlying writer already invalidated the embeddings
  // cache slot as its own safety net; re-reading here picks up the
  // healed vectors before Clustering runs.
  const refreshedIndex = memoriesReembedded > 0 ? getCachedEmbeddings(effectiveRoot) : index;
  return { memoriesReembedded, index: refreshedIndex };
}

function runClusteringAndPromotion(
  effectiveRoot: string,
  dryRun: boolean,
  now: Date,
  cachedMemories: Memory[],
  index: PackedEmbeddingIndex,
  conflictIndex: ConflictIndex,
) {
  const promoted = alreadyPromotedIds(effectiveRoot);
  const episodic = cachedMemories.filter((memory) => memory.frontmatter.kind === "episodic" && !promoted.has(memory.frontmatter.id));
  // v7 (ADR-0012): a net-negative Memory is filtered out of the candidate
  // pool entirely, before clusterEpisodicMemories ever runs — it can
  // neither seed a Cluster nor join one.
  const feedbackEligible = episodic.filter((memory) => !isNetNegativeFeedback(memory));
  const feedbackExcludedCount = episodic.length - feedbackEligible.length;
  const { clusters, blockedJoinAttempts } = clusterEpisodicMemories(feedbackEligible, index, conflictIndex);

  const newSemanticIds: string[] = [];
  let contributorsBumped = 0;

  if (dryRun) {
    contributorsBumped = clusters.reduce((sum, cluster) => sum + cluster.length, 0);
  } else {
    for (const cluster of clusters) {
      const semanticMemory = promoteCluster(effectiveRoot, cluster, now);
      newSemanticIds.push(semanticMemory.frontmatter.id);
      contributorsBumped += cluster.length;
    }
  }

  return { clusters, blockedJoinAttempts, feedbackExcludedCount, contributorsBumped, newSemanticIds };
}

/**
 * The shape Promotion Audit, Commit Invalidation, and Invalidation each
 * repeat: stale every eligible item's Memory with its own message and
 * persist it, then report how many were eligible. Always returns
 * `items.length` — the count is "how many were eligible", not "how many
 * mutations actually ran" — so `dryRun` and `alreadyStaled` (Promotion
 * Audit's own dedup against a Memory its first pass already staled) affect
 * only whether the mutation happens, never the returned count.
 */
function staleEligible<T>(
  effectiveRoot: string,
  dryRun: boolean,
  now: Date,
  items: T[],
  toMemoryAndMessage: (item: T) => { memory: Memory; message: string },
  alreadyStaled?: (memory: Memory) => boolean,
): number {
  if (!dryRun) {
    for (const item of items) {
      const { memory, message } = toMemoryAndMessage(item);
      if (alreadyStaled?.(memory)) continue;
      staleMemory(memory, now, message);
      writeMemory(effectiveRoot, memory);
    }
  }
  return items.length;
}

/**
 * v8 (ADR-0013): runs after Promotion (so it can see Semantic Memories from
 * this same run) and before Pruning (so it sees Conflict Edges and feedback
 * counts before Pruning can delete a contributor, and with it that
 * contributor's Conflict Edges, within the same pass).
 */
function runPromotionAudit(effectiveRoot: string, dryRun: boolean, now: Date, conflictIndex: ConflictIndex) {
  const { conflictFlagged, feedbackFlagged } = eligibleForPromotionAudit(effectiveRoot, conflictIndex);
  const staledIds = new Set<string>();
  const conflictFlaggedCount = staleEligible(effectiveRoot, dryRun, now, conflictFlagged, ({ memory, triggeringContributors }) => {
    staledIds.add(memory.frontmatter.id);
    return {
      memory,
      message: `Promotion Audit: confirmed contradicts verdict among promotedFrom contributors ${triggeringContributors.join(", ")}`,
    };
  });
  const feedbackFlaggedCount = staleEligible(
    effectiveRoot,
    dryRun,
    now,
    feedbackFlagged,
    ({ memory, triggeringContributors }) => ({
      memory,
      message: `Promotion Audit: promotedFrom contributor(s) ${triggeringContributors.join(", ")} now net-negative on feedback`,
    }),
    (memory) => staledIds.has(memory.frontmatter.id),
  );
  return { conflictFlaggedCount, feedbackFlaggedCount };
}

/**
 * v9 (ADR-0014): runs before Pruning, mirroring Promotion Audit's own
 * precedent, so a Memory eligible for Pruning in the same pass is still
 * evaluated by Commit Invalidation before Pruning can remove it. Checks the
 * exact complement of existing Invalidation's own candidate pool, so the two
 * mechanisms never compete to stale the same Memory.
 */
function runCommitInvalidation(effectiveRoot: string, dryRun: boolean, now: Date, commitSubjects: CommitSubjects): number {
  const commitInvalidatable = eligibleForCommitInvalidation(effectiveRoot, commitSubjects);
  return staleEligible(effectiveRoot, dryRun, now, commitInvalidatable, ({ memory, triggeringTarget }) => ({
    memory,
    message: `Commit Invalidation: commit history shows a move away from "${triggeringTarget}"`,
  }));
}

function runPruning(effectiveRoot: string, dryRun: boolean, now: Date): number {
  const prunable = eligibleForPruning(effectiveRoot, now);
  if (!dryRun) {
    for (const { kind, memory } of prunable) {
      deleteMemory(effectiveRoot, kind, memory.frontmatter.id);
      removeVector(effectiveRoot, memory.frontmatter.id);
      removeConflictEdgesForId(effectiveRoot, memory.frontmatter.id);
    }
  }
  return prunable.length;
}

function runInvalidation(effectiveRoot: string, dryRun: boolean, now: Date, fileChangeTimestamps: FileChangeTimestamps): number {
  const invalidatable = eligibleForInvalidation(effectiveRoot, fileChangeTimestamps);
  return staleEligible(effectiveRoot, dryRun, now, invalidatable, ({ memory, triggeringFiles }) => ({
    memory,
    message: `Related file(s) changed: ${triggeringFiles.join(", ")}`,
  }));
}

async function consolidateOneRoot({
  effectiveRoot,
  dryRun,
  now,
  fileChangeTimestamps,
  commitSubjects,
  embeddingProvider,
  awaitPush,
  logger,
}: ConsolidateOneRootOptions): Promise<ConsolidateResult> {
  // v14 (ADR-0021): reads the same versioned cache `recall` does, instead of
  // its own separate full scan — the cache is already active-only, so no
  // `isActive` re-check is needed here.
  const initialIndex = getCachedEmbeddings(effectiveRoot);
  const { memories: cachedMemories, conflicts: conflictIndex } = getCachedRecords(effectiveRoot);

  const { memoriesReembedded, index } = await runReembedding(effectiveRoot, dryRun, cachedMemories, initialIndex, embeddingProvider);

  const { clusters, blockedJoinAttempts, feedbackExcludedCount, contributorsBumped, newSemanticIds } = runClusteringAndPromotion(
    effectiveRoot,
    dryRun,
    now,
    cachedMemories,
    index,
    conflictIndex,
  );

  const { conflictFlaggedCount, feedbackFlaggedCount } = runPromotionAudit(effectiveRoot, dryRun, now, conflictIndex);

  const memoriesCommitInvalidated = runCommitInvalidation(effectiveRoot, dryRun, now, commitSubjects);

  const memoriesPruned = runPruning(effectiveRoot, dryRun, now);

  const memoriesInvalidated = runInvalidation(effectiveRoot, dryRun, now, fileChangeTimestamps);

  // v14 (ADR-0021): one rebuild for the whole pass, not one per mutation
  // above — a Clustering/Promotion/Promotion Audit/Pruning/Invalidation run
  // can touch dozens of Memories, and patching the cache per-mutation would
  // turn one opportunistic pass into dozens of full cache rewrites.
  if (!dryRun) rebuildCache(effectiveRoot);

  // v19 (ADR-0025): resetting the Opportunistic Consolidation debounce
  // clock is a side effect of the pass's own local work completing, not of
  // however long the Shared Memory flush below takes — so this runs before
  // that flush, and doesn't wait on `awaitPush` either.
  if (!dryRun) resetOpportunisticConsolidationState(effectiveRoot, now);

  // v11 (ADR-0017): a no-op unless this store has opted into Shared Memory
  // (`.raiminiscence/memory/` isn't a worktree) — safe to call unconditionally
  // for every scope, including global.
  if (!dryRun) await flushSharedMemory(effectiveRoot, { awaitPush, logger });

  return {
    clustersFound: clusters.length,
    memoriesPromoted: dryRun ? clusters.length : newSemanticIds.length,
    memoriesPruned,
    contributorsBumped,
    newSemanticIds,
    memoriesInvalidated,
    blockedJoinAttempts,
    feedbackExcludedCount,
    promotionAuditConflictCount: conflictFlaggedCount,
    promotionAuditFeedbackCount: feedbackFlaggedCount,
    memoriesCommitInvalidated,
    memoriesReembedded,
  };
}

function mergeResults(a: ConsolidateResult, b: ConsolidateResult): ConsolidateResult {
  return {
    clustersFound: a.clustersFound + b.clustersFound,
    memoriesPromoted: a.memoriesPromoted + b.memoriesPromoted,
    memoriesPruned: a.memoriesPruned + b.memoriesPruned,
    contributorsBumped: a.contributorsBumped + b.contributorsBumped,
    newSemanticIds: [...a.newSemanticIds, ...b.newSemanticIds],
    memoriesInvalidated: a.memoriesInvalidated + b.memoriesInvalidated,
    blockedJoinAttempts: a.blockedJoinAttempts + b.blockedJoinAttempts,
    feedbackExcludedCount: a.feedbackExcludedCount + b.feedbackExcludedCount,
    promotionAuditConflictCount: a.promotionAuditConflictCount + b.promotionAuditConflictCount,
    promotionAuditFeedbackCount: a.promotionAuditFeedbackCount + b.promotionAuditFeedbackCount,
    memoriesCommitInvalidated: a.memoriesCommitInvalidated + b.memoriesCommitInvalidated,
    memoriesReembedded: a.memoriesReembedded + b.memoriesReembedded,
  };
}

/** `consolidate`'s params with every default resolved, shared by each root it runs. */
function perRootOptions(params: ConsolidateParams): Omit<ConsolidateOneRootOptions, "effectiveRoot"> {
  return {
    dryRun: params.dryRun ?? false,
    now: params.now ?? new Date(),
    fileChangeTimestamps: params.fileChangeTimestamps ?? gitFileChangeTimestamps,
    commitSubjects: params.commitSubjects ?? gitCommitSubjects,
    embeddingProvider: params.embeddingProvider ?? defaultProvider(),
    awaitPush: params.awaitPush ?? false,
    logger: params.logger,
  };
}

/**
 * Re-embedding + Clustering + Promotion + Promotion Audit + Commit
 * Invalidation + Pruning + Invalidation, run explicitly or
 * opportunistically. `scope: "both"` runs project and global stores
 * independently and sums counts — Clustering never mixes memories across
 * the two. Each concern (Re-embedding in `reembedding.ts`,
 * Clustering/Promotion in `clustering.ts`, Promotion Audit in
 * `promotion-audit.ts`, Commit Invalidation in `commit-invalidation.ts`,
 * Pruning in `pruning.ts`, Invalidation in `invalidation.ts`) lives in its
 * own module; this file only sequences them per root and merges the counts
 * — except the v7 (ADR-0012) net-negative-feedback pool filter, which has
 * no module of its own since it's just one more predicate on the
 * candidate pool this file already builds.
 */
export async function consolidate(params: ConsolidateParams): Promise<ConsolidateResult> {
  const scope = params.scope ?? "project";
  const scopesToRun: Scope[] = scope === "both" ? ["project", "global"] : [scope];
  const options = perRootOptions(params);
  const { dryRun, logger } = options;
  const roots = scopesToRun.map((s) => effectiveStorageRoot(s, params));
  // ADR-0041: Clustering and Re-embedding must see the vectors `remember` is still writing.
  await Promise.all(roots.map(awaitPendingEmbeds));

  const results = await Promise.all(roots.map((effectiveRoot) => consolidateOneRoot({ ...options, effectiveRoot })));
  // `scopesToRun` always has at least one entry, so `results` is never
  // empty — no zero-value seed needed for this reduce.
  const merged = results.reduce(mergeResults);

  // Only a real pass, never a `dryRun` preview — mirrors `flushSharedMemory`'s
  // own `!dryRun` gate above, so a dry run stays exactly as side-effect-free
  // (including in the logs) as before.
  if (!dryRun) logger?.info({ scope, ...merged }, "consolidation pass complete");

  return merged;
}
