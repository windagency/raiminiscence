import { ALL_MEMORY_KINDS, type ConfidenceTier, type Memory, type MemoryKind, type Scope, type StorageLocation } from "./types.js";
import { findMemoryById, readAllMemories } from "./storage.js";
import { computeReinforcement, computeStrength, daysBetween } from "./decay.js";
import { isActive } from "./memory-view.js";
import { resolveScope } from "./project-root.js";
import { summaryOf } from "./memory-view.js";
import { computeConflictFields, toRecallResultItem } from "./query-scoring.js";
import { scoreQueryAgainstCache, type CachedQueryParams } from "./cached-query.js";
import type { RecallResultItem } from "./recall.js";
import { OperationalError } from "./errors.js";

/**
 * v15 (ADR-0022): Inspect — a read-only diagnostic, never a Recall. None of
 * `inspectMemory`/`inspectQuery`/`browseMemories` may ever call
 * `writeMemory` or otherwise mutate stored state —
 * that's the one property this whole module exists to guarantee. See the
 * ADR for why this needs its own scoring path rather than calling `recall()`
 * directly.
 */

export interface ReinforcementCeilingUsage {
  rawBonusDays: number;
  boundedBonusDays: number;
  ceilingDays: number;
  /** `boundedBonusDays / ceilingDays`, as a percentage (0-100). */
  percentUsed: number;
}

export interface ReinforcementCounters {
  recallCount: number;
  consolidationSurvivalCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  lastRecalledAt: string | null;
}

export interface InspectMemoryResult {
  id: string;
  kind: MemoryKind;
  confidence: ConfidenceTier;
  scope: Scope;
  createdAt: string;
  summary: string;
  detail: string;
  strength: number;
  baseHalfLifeDays: number;
  effectiveHalfLifeDays: number;
  reinforcementCeiling: ReinforcementCeilingUsage;
  ageDays: number;
  reinforcement: ReinforcementCounters;
}

function toInspectMemoryResult(memory: Memory, now: Date): InspectMemoryResult {
  const { frontmatter, body } = memory;
  const strength = computeStrength(frontmatter, now);
  const { rawBonusDays, boundedBonusDays, ceilingDays, effectiveHalfLifeDays } = computeReinforcement(frontmatter);

  return {
    id: frontmatter.id,
    kind: frontmatter.kind,
    confidence: frontmatter.confidence,
    scope: frontmatter.scope,
    createdAt: frontmatter.createdAt,
    summary: summaryOf(body),
    detail: body,
    strength,
    baseHalfLifeDays: frontmatter.baseHalfLifeDays,
    effectiveHalfLifeDays,
    reinforcementCeiling: {
      rawBonusDays,
      boundedBonusDays,
      ceilingDays,
      percentUsed: ceilingDays > 0 ? (boundedBonusDays / ceilingDays) * 100 : 0,
    },
    ageDays: daysBetween(new Date(frontmatter.createdAt), now),
    reinforcement: {
      recallCount: frontmatter.recallCount,
      consolidationSurvivalCount: frontmatter.consolidationSurvivalCount,
      positiveFeedbackCount: frontmatter.positiveFeedbackCount ?? 0,
      negativeFeedbackCount: frontmatter.negativeFeedbackCount ?? 0,
      lastRecalledAt: frontmatter.lastRecalledAt,
    },
  };
}

export interface InspectMemoryParams extends StorageLocation {
  id: string;
  scope?: Scope;
  now?: Date;
}

/**
 * Explains one Memory by id: its Strength, base/effective Half-life,
 * Reinforcement Ceiling usage, Confidence Tier, age, and reinforcement
 * counters — reusing `decay.ts`'s existing `computeStrength`/
 * `computeReinforcement` arithmetic directly rather than re-deriving it.
 * Read-only: a plain `findMemoryById` lookup, no write path at all.
 */
export function inspectMemory(params: InspectMemoryParams): InspectMemoryResult {
  const now = params.now ?? new Date();
  const { root: effectiveRoot } = resolveScope(params);
  const found = findMemoryById(effectiveRoot, params.id);
  if (!found) {
    throw new OperationalError(`No memory found with id "${params.id}"`);
  }
  return toInspectMemoryResult(found.memory, now);
}

export type InspectQueryExclusionReason = "below-min-score" | "stale" | "retracted";

export interface InspectQueryNearMiss {
  id: string;
  kind: MemoryKind;
  confidence: ConfidenceTier;
  summary: string;
  strength: number;
  exclusionReason: InspectQueryExclusionReason;
}

export interface InspectQueryResult {
  /** Identical shape/values to what an equivalent `recall()` call would return for its qualifying set. */
  results: RecallResultItem[];
  nearMisses: InspectQueryNearMiss[];
  usedFallback: boolean;
}

export type InspectQueryParams = CachedQueryParams;

/**
 * Explains how a query would score right now: the same candidate-scoring
 * path `recall()` uses (`scoreCandidatesForQuery`, shared verbatim), plus
 * every near-miss with its exclusion reason. Never calls `writeMemory` —
 * running this any number of times changes nothing.
 *
 * Stale/retracted Memories never enter the active pool `scoreCandidatesForQuery`
 * scores (the v14 records cache is active-only, see `recall-cache.ts`), so
 * they're read separately here purely to report *why* they're missing —
 * one extra full-directory read, acceptable since Inspect (unlike `recall`)
 * is never a hot path.
 */
export async function inspectQuery(params: InspectQueryParams): Promise<InspectQueryResult> {
  const { scored, belowMinScore, candidatesById, effectiveRoot, now, kinds, k, usedFallback, index, conflictIndex } =
    await scoreQueryAgainstCache(params);

  const topResults = scored.slice(0, k);
  const topIds = topResults.map(({ memory }) => memory.frontmatter.id);
  const { conflictsWith, conflictCandidateWith } = computeConflictFields(
    topIds,
    conflictIndex,
    index,
    (id) => candidatesById.get(id)?.memory.frontmatter.kind,
  );

  const results: RecallResultItem[] = topResults.map((candidate) => toRecallResultItem(candidate, conflictsWith, conflictCandidateWith));

  const toNearMiss = (memory: Memory, strength: number, exclusionReason: InspectQueryExclusionReason): InspectQueryNearMiss => ({
    id: memory.frontmatter.id,
    kind: memory.frontmatter.kind,
    confidence: memory.frontmatter.confidence,
    summary: summaryOf(memory.body),
    strength,
    exclusionReason,
  });

  const belowMinScoreNearMisses: InspectQueryNearMiss[] = belowMinScore.map(({ memory, strength }) =>
    toNearMiss(memory, strength, "below-min-score"),
  );

  const inactiveNearMisses: InspectQueryNearMiss[] = readAllMemories(effectiveRoot, kinds)
    .filter((memory) => !isActive(memory))
    .map((memory) =>
      toNearMiss(memory, computeStrength(memory.frontmatter, now), memory.frontmatter.confidence === "retracted" ? "retracted" : "stale"),
    );

  return {
    results,
    nearMisses: [...belowMinScoreNearMisses, ...inactiveNearMisses],
    usedFallback,
  };
}

export interface BrowseMemoriesFilters {
  kind?: MemoryKind;
  confidenceTier?: ConfidenceTier;
  minStrength?: number;
  maxStrength?: number;
  scope?: Scope;
  /** ISO date string; a Memory's `createdAt` must be >= this to match. */
  since?: string;
  /** ISO date string; a Memory's `createdAt` must be <= this to match. */
  until?: string;
}

export interface BrowseMemoriesParams extends StorageLocation {
  filters?: BrowseMemoriesFilters;
  now?: Date;
}

/**
 * Lists Memories filtered by Kind, Confidence Tier, a Strength threshold,
 * Scope, and a `createdAt` range — sorted by Strength ascending by default,
 * so the weakest (nearest Pruning) Memories sort first. Reads every Memory
 * Kind unfiltered by `isActive` (unlike `recall`'s active-only cache), since
 * browsing `stale`/`retracted` Memories by Confidence Tier is one of
 * Inspect's own use cases (see the `inspect` spec's user stories).
 */
export function browseMemories(params: BrowseMemoriesParams): InspectMemoryResult[] {
  const now = params.now ?? new Date();
  const filters = params.filters ?? {};
  const { root: effectiveRoot } = resolveScope({ ...params, scope: filters.scope });
  const kinds: MemoryKind[] = filters.kind ? [filters.kind] : ALL_MEMORY_KINDS;

  return readAllMemories(effectiveRoot, kinds)
    .map((memory) => toInspectMemoryResult(memory, now))
    .filter((result) => matchesBrowseFilters(result, filters))
    .sort((a, b) => a.strength - b.strength);
}

/** Every set filter must match; an unset one matches anything. `kind` and `scope` are already applied by the read itself. */
function matchesBrowseFilters(result: InspectMemoryResult, filters: BrowseMemoriesFilters) {
  return [
    filters.confidenceTier === undefined || result.confidence === filters.confidenceTier,
    filters.minStrength === undefined || result.strength >= filters.minStrength,
    filters.maxStrength === undefined || result.strength <= filters.maxStrength,
    filters.since === undefined || result.createdAt >= filters.since,
    filters.until === undefined || result.createdAt <= filters.until,
  ].every(Boolean);
}
