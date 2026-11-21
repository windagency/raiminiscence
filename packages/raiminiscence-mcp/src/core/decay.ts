import type { ConfidenceTier, MemoryFrontmatter } from "./types.js";

export const DECAY_GRACE_PERIOD_DAYS = 14;
export const SPACED_REPETITION_BONUS_DAYS = 2;
export const ERROR_AMPLIFICATION_MULTIPLIER = 2;

/** Outcome Feedback: a stronger reinforcement than an ordinary recall's Spaced Repetition bonus. */
export const POSITIVE_FEEDBACK_BONUS_DAYS = 5;
/** Outcome Feedback: shrinks effective Half-life, accelerating Decay. */
export const NEGATIVE_FEEDBACK_PENALTY_DAYS = 5;
/** Floor so accumulated negative feedback can never drive effective half-life to zero or below. */
const MIN_EFFECTIVE_HALF_LIFE_DAYS = 1;

/** Reinforcement Ceiling: Spaced Repetition's and Outcome Feedback's positive bonus days
 * asymptotically approach, but never reach, this multiple of a Memory's own baseHalfLifeDays. */
export const REINFORCEMENT_CEILING_MULTIPLIER = 4;
/** Reinforcement Ceiling: raw bonus-days at which half of the ceiling has been reached. */
export const REINFORCEMENT_HALF_SATURATION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Confidence Tier weighting applied on top of Strength when ranking recall
 * results. `stale`/`retracted` are intentionally absent: those tiers are
 * excluded from ranking entirely upstream, never merely down-weighted.
 */
export const CONFIDENCE_WEIGHT: Partial<Record<ConfidenceTier, number>> = {
  verified: 1.0,
  observed: 0.85,
  inferred: 0.7,
};

export const EXCLUDED_CONFIDENCE_TIERS: Set<ConfidenceTier> = new Set(["stale", "retracted"]);

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/** Reinforcement Ceiling's raw-bonus-days/bounded-bonus-days/ceiling-days breakdown, plus the effective Half-life it produces. */
export interface ReinforcementBreakdown {
  rawBonusDays: number;
  boundedBonusDays: number;
  ceilingDays: number;
  negativeFeedbackDays: number;
  effectiveHalfLifeDays: number;
}

/**
 * Reinforcement Ceiling's arithmetic, factored out of `computeStrength` so
 * v15's Inspect can report the same raw-bonus-days/bounded-bonus-days/ceiling
 * breakdown `computeStrength` itself uses, rather than re-deriving the
 * formula a second time (see `inspect.ts`'s `inspectMemory`).
 */
export function computeReinforcement(frontmatter: MemoryFrontmatter): ReinforcementBreakdown {
  // `?? 0`: a pre-v2 Memory file genuinely lacks these keys (undefined, not
  // 0), and schemaVersion bumps are migration-free — see CURRENT_SCHEMA_VERSION.
  const negativeFeedbackDays = (frontmatter.negativeFeedbackCount ?? 0) * NEGATIVE_FEEDBACK_PENALTY_DAYS;
  // Reinforcement Ceiling: Spaced Repetition's and Outcome Feedback's positive terms
  // share one raw sum, squashed through a smooth curve that approaches but never
  // reaches REINFORCEMENT_CEILING_MULTIPLIER x baseHalfLifeDays. Outcome Feedback's
  // negative term is untouched — it already saturates against MIN_EFFECTIVE_HALF_LIFE_DAYS.
  const rawBonusDays =
    (frontmatter.recallCount + frontmatter.consolidationSurvivalCount) * SPACED_REPETITION_BONUS_DAYS +
    (frontmatter.positiveFeedbackCount ?? 0) * POSITIVE_FEEDBACK_BONUS_DAYS;
  const ceilingDays = REINFORCEMENT_CEILING_MULTIPLIER * frontmatter.baseHalfLifeDays;
  const boundedBonusDays = ceilingDays * (1 - Math.pow(0.5, rawBonusDays / REINFORCEMENT_HALF_SATURATION_DAYS));
  const effectiveHalfLifeDays = Math.max(
    MIN_EFFECTIVE_HALF_LIFE_DAYS,
    frontmatter.baseHalfLifeDays * (frontmatter.isError ? ERROR_AMPLIFICATION_MULTIPLIER : 1) + boundedBonusDays - negativeFeedbackDays,
  );
  return { rawBonusDays, boundedBonusDays, ceilingDays, negativeFeedbackDays, effectiveHalfLifeDays };
}

/**
 * A Memory's current decayed relevance. Pure function of frontmatter plus
 * the supplied "now" — never reads the system clock directly, so decay
 * behaviour is deterministic and unit-testable without mocking time.
 */
export function computeStrength(frontmatter: MemoryFrontmatter, now: Date): number {
  const anchor = new Date(frontmatter.lastRecalledAt ?? frontmatter.createdAt);
  const { effectiveHalfLifeDays } = computeReinforcement(frontmatter);
  const effectiveElapsed = Math.max(0, daysBetween(anchor, now) - DECAY_GRACE_PERIOD_DAYS);
  return Math.pow(0.5, effectiveElapsed / effectiveHalfLifeDays);
}
