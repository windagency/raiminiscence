import type { Memory } from "./types.js";
import { readAllMemories } from "./storage.js";
import { isActive, isNetNegativeFeedback } from "./memory-view.js";
import { conflictVerdict, type ConflictIndex } from "./conflict-edge.js";

export interface PromotionAuditFlag {
  memory: Memory;
  triggeringContributors: string[];
}

export interface PromotionAuditResult {
  conflictFlagged: PromotionAuditFlag[];
  feedbackFlagged: PromotionAuditFlag[];
}

/**
 * v8 (ADR-0013): re-examines every currently-active Semantic Memory's
 * `promotedFrom` contributors against *current* Conflict Edge and Outcome
 * Feedback state — not the state as it stood at Promotion time. Closes the
 * retroactive gap ADR-0011 and ADR-0012 each named and left open.
 *
 * The Conflict-Edge check is all-pairs within `promotedFrom`, not
 * seed-to-candidate only like live Clustering — `promotedFrom` is a flat
 * `string[]` with no seed identity preserved past Promotion. The feedback
 * check reuses `isNetNegativeFeedback` unchanged from v7. A `promotedFrom`
 * id that no longer resolves to any Memory (already removed by an earlier
 * Pruning pass) is silently skipped by both checks — not an error.
 *
 * Stateless: every call re-derives the candidate pool and re-runs both
 * checks from scratch. Already-stale/retracted Semantic Memories are
 * excluded from the candidate pool (mirroring Invalidation's own
 * `isActive` guard) so they're never redundantly reprocessed.
 */
export function eligibleForPromotionAudit(storageRoot: string, conflictIndex: ConflictIndex): PromotionAuditResult {
  const semanticMemories = readAllMemories(storageRoot, ["semantic"]).filter(isActive);
  const episodicById = new Map(readAllMemories(storageRoot, ["episodic"]).map((memory) => [memory.frontmatter.id, memory]));

  const conflictFlagged: PromotionAuditFlag[] = [];
  const feedbackFlagged: PromotionAuditFlag[] = [];

  for (const memory of semanticMemories) {
    const promotedFrom = memory.frontmatter.promotedFrom ?? [];

    const contradictingContributors = new Set<string>();
    for (let i = 0; i < promotedFrom.length; i++) {
      for (let j = i + 1; j < promotedFrom.length; j++) {
        const a = promotedFrom[i]!;
        const b = promotedFrom[j]!;
        if (conflictVerdict(conflictIndex, a, b) === "contradicts") {
          contradictingContributors.add(a);
          contradictingContributors.add(b);
        }
      }
    }
    if (contradictingContributors.size > 0) {
      conflictFlagged.push({ memory, triggeringContributors: [...contradictingContributors] });
    }

    const netNegativeContributors = promotedFrom.filter((id) => {
      const contributor = episodicById.get(id);
      return contributor !== undefined && isNetNegativeFeedback(contributor);
    });
    if (netNegativeContributors.length > 0) {
      feedbackFlagged.push({ memory, triggeringContributors: netNegativeContributors });
    }
  }

  return { conflictFlagged, feedbackFlagged };
}
