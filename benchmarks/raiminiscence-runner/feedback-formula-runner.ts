import { computeStrength } from "../../packages/raiminiscence-mcp/src/core/decay.js";
import type { MemoryFrontmatter } from "../../packages/raiminiscence-mcp/src/core/types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Representative base half-life: semantic Memory Kind's 30 days (CONTEXT.md). */
const BASE_HALF_LIFE_DAYS = 30;

function buildFrontmatter(feedbackCount: number, sign: 1 | -1): MemoryFrontmatter {
  const createdAt = new Date(0).toISOString();
  return {
    id: "feedback-stress-test",
    schemaVersion: 2,
    kind: "semantic",
    confidence: "observed",
    isError: false,
    createdAt,
    lastRecalledAt: null,
    recallCount: 0,
    consolidationSurvivalCount: 0,
    baseHalfLifeDays: BASE_HALF_LIFE_DAYS,
    retractedAt: null,
    retractReason: null,
    source: { client: "benchmark" },
    scope: "project",
    originatingProject: null,
    promotedFrom: null,
    relatedFiles: null,
    staleAt: null,
    staleReason: null,
    positiveFeedbackCount: sign === 1 ? feedbackCount : 0,
    negativeFeedbackCount: sign === -1 ? feedbackCount : 0,
  };
}

export interface FeedbackStressPoint {
  feedbackCount: number;
  sign: "positive" | "negative";
  /** Strength (0..1) at each of `assessedAtDays` since the memory's anchor. */
  strengthByAssessedDay: Record<number, number>;
}

/**
 * Stress-tests rAIminiscence's real, unmodified `computeStrength` (see
 * packages/raiminiscence-mcp/src/core/decay.ts) — a pure function of
 * frontmatter + injected `now`, so this measures the actual production
 * formula directly, not a re-implementation of it. Originally answered
 * hippo-memory-comparison.md §3.1's open question empirically: did the
 * additive, uncapped feedback term (+/-5 days per event, no ceiling) let a
 * handful of high-feedback memories keep an artificially high Strength (and
 * therefore recall ranking) much longer than a formula with a bounded effect
 * would? v12's Reinforcement Ceiling (ADR-0003/ADR-0016, `decay.ts`) has
 * since closed that gap — the combined Spaced Repetition + positive
 * Outcome Feedback term now saturates asymptotically toward
 * `REINFORCEMENT_CEILING_MULTIPLIER` x a memory's own base half-life — so
 * this runner now measures the shape of that bound rather than an
 * open-ended growth curve. The negative feedback term is untouched by v12:
 * still a flat -5 days/event, floored at `MIN_EFFECTIVE_HALF_LIFE_DAYS`.
 */
export function runRaiminiscenceFeedbackStressTest(feedbackCounts: number[], assessedAtDays: number[]): FeedbackStressPoint[] {
  const points: FeedbackStressPoint[] = [];
  for (const sign of [1, -1] as const) {
    for (const feedbackCount of feedbackCounts) {
      const frontmatter = buildFrontmatter(feedbackCount, sign);
      const strengthByAssessedDay: Record<number, number> = {};
      for (const days of assessedAtDays) {
        const now = new Date(new Date(frontmatter.createdAt).getTime() + days * MS_PER_DAY);
        strengthByAssessedDay[days] = computeStrength(frontmatter, now);
      }
      points.push({ feedbackCount, sign: sign === 1 ? "positive" : "negative", strengthByAssessedDay });
    }
  }
  return points;
}
