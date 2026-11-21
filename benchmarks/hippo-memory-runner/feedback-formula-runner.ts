import { createMemory, applyOutcome, calculateStrength } from "./adapters/hippo-memory.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Same representative base half-life as the rAIminiscence side (30 days). */
const BASE_HALF_LIFE_DAYS = 30;

export interface FeedbackStressPoint {
  feedbackCount: number;
  sign: "positive" | "negative";
  strengthByAssessedDay: Record<number, number>;
}

/**
 * Stress-tests hippo-memory's real, unmodified `calculateStrength` +
 * `applyOutcome` (imported directly from the installed package's public
 * export surface, `dist/index.js` — not re-implemented), mirroring
 * feedback-formula-runner.ts's methodology exactly (same base half-life, same
 * feedback counts, same assessed-day snapshots) for a fair side-by-side.
 * `retrieval_count` stays 0 and `tags`/`emotional_valence` stay neutral on
 * every entry, isolating the reward-factor term from hippo's other strength
 * multipliers (retrieval boost, emotional multiplier) — confirmed from
 * source (`dist/src/memory.js`) that both equal 1.0 under these conditions.
 */
export function runHippoFeedbackStressTest(feedbackCounts: number[], assessedAtDays: number[]): FeedbackStressPoint[] {
  const points: FeedbackStressPoint[] = [];
  for (const sign of ["positive", "negative"] as const) {
    for (const feedbackCount of feedbackCounts) {
      let entry = createMemory(`feedback stress test entry (${sign}, n=${feedbackCount})`, {
        baseHalfLifeDays: BASE_HALF_LIFE_DAYS,
      });
      for (let i = 0; i < feedbackCount; i++) {
        entry = applyOutcome(entry, sign === "positive");
      }
      const created = new Date(entry.created);
      const strengthByAssessedDay: Record<number, number> = {};
      for (const days of assessedAtDays) {
        const now = new Date(created.getTime() + days * MS_PER_DAY);
        strengthByAssessedDay[days] = calculateStrength(entry, now);
      }
      points.push({ feedbackCount, sign, strengthByAssessedDay });
    }
  }
  return points;
}
