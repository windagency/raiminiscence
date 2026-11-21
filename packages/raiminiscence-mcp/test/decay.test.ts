import { describe, expect, it } from "vitest";
import { computeStrength } from "#src/core/decay.js";
import { BASE_HALF_LIFE_DAYS, CURRENT_SCHEMA_VERSION } from "#src/core/types.js";
import type { MemoryFrontmatter } from "#src/core/types.js";

const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

function fixture(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: "episodic",
    confidence: "observed",
    isError: false,
    createdAt: CREATED_AT.toISOString(),
    lastRecalledAt: null,
    recallCount: 0,
    consolidationSurvivalCount: 0,
    baseHalfLifeDays: BASE_HALF_LIFE_DAYS.episodic,
    retractedAt: null,
    retractReason: null,
    source: { client: "claude-code" },
    scope: "project",
    originatingProject: null,
    promotedFrom: null,
    relatedFiles: null,
    staleAt: null,
    staleReason: null,
    positiveFeedbackCount: 0,
    negativeFeedbackCount: 0,
    ...overrides,
  };
}

function daysAfter(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("BASE_HALF_LIFE_DAYS", () => {
  it("gives checkpoint a 3-day base half-life (v13, ADR-0020) — shorter than every other Kind", () => {
    expect(BASE_HALF_LIFE_DAYS.checkpoint).toBe(3);
    expect(BASE_HALF_LIFE_DAYS.checkpoint).toBeLessThan(BASE_HALF_LIFE_DAYS.episodic);
    expect(BASE_HALF_LIFE_DAYS.checkpoint).toBeLessThan(BASE_HALF_LIFE_DAYS.decision);
    expect(BASE_HALF_LIFE_DAYS.checkpoint).toBeLessThan(BASE_HALF_LIFE_DAYS.semantic);
  });
});

describe("computeStrength", () => {
  it("decays a checkpoint memory per the same formula, with no special-case behavior beyond its base half-life", () => {
    const memory = fixture({ kind: "checkpoint", baseHalfLifeDays: BASE_HALF_LIFE_DAYS.checkpoint });
    const now = daysAfter(CREATED_AT, 14 + BASE_HALF_LIFE_DAYS.checkpoint);
    expect(computeStrength(memory, now)).toBeCloseTo(0.5, 5);
  });

  it("is 1.0 (full strength) inside the 14-day grace period", () => {
    const memory = fixture();
    expect(computeStrength(memory, daysAfter(CREATED_AT, 14))).toBeCloseTo(1.0, 5);
  });

  it("decays to exactly half at one base half-life past the grace period", () => {
    const memory = fixture({ baseHalfLifeDays: 7 });
    const now = daysAfter(CREATED_AT, 14 + 7);
    expect(computeStrength(memory, now)).toBeCloseTo(0.5, 5);
  });

  it("decays further the longer past the grace period it goes", () => {
    const memory = fixture({ baseHalfLifeDays: 7 });
    const now = daysAfter(CREATED_AT, 14 + 14);
    expect(computeStrength(memory, now)).toBeCloseTo(0.25, 5);
  });

  it("doubles the effective half-life for corrected mistakes (Error Amplification)", () => {
    const errored = fixture({ baseHalfLifeDays: 7, isError: true });
    const routine = fixture({ baseHalfLifeDays: 7, isError: false });
    const now = daysAfter(CREATED_AT, 14 + 7);

    // Routine memory has decayed to half; the error-amplified one (double
    // half-life) should still be well above half at the same elapsed time.
    expect(computeStrength(routine, now)).toBeCloseTo(0.5, 5);
    expect(computeStrength(errored, now)).toBeGreaterThan(0.5);
    expect(computeStrength(errored, now)).toBeCloseTo(Math.pow(0.5, 0.5), 5);
  });

  it("extends effective half-life via Spaced Repetition after repeated recalls", () => {
    const neverRecalled = fixture({ baseHalfLifeDays: 7, recallCount: 0 });
    const recalledFiveTimes = fixture({ baseHalfLifeDays: 7, recallCount: 5 });
    const now = daysAfter(CREATED_AT, 14 + 7);

    expect(computeStrength(recalledFiveTimes, now)).toBeGreaterThan(computeStrength(neverRecalled, now));
  });

  it("anchors decay on lastRecalledAt when present, resetting elapsed time", () => {
    const recentlyRecalled = fixture({
      baseHalfLifeDays: 7,
      lastRecalledAt: daysAfter(CREATED_AT, 30).toISOString(),
    });
    const now = daysAfter(CREATED_AT, 30 + 14);
    expect(computeStrength(recentlyRecalled, now)).toBeCloseTo(1.0, 5);
  });

  it("never goes negative or before the anchor", () => {
    const memory = fixture();
    expect(computeStrength(memory, CREATED_AT)).toBeCloseTo(1.0, 5);
  });

  it("positive Outcome Feedback extends effective half-life more than an ordinary recall bonus", () => {
    const now = daysAfter(CREATED_AT, 14 + 7);
    const recalledOnce = fixture({ baseHalfLifeDays: 7, recallCount: 1 });
    const positiveFeedbackOnce = fixture({ baseHalfLifeDays: 7, positiveFeedbackCount: 1 });

    expect(computeStrength(positiveFeedbackOnce, now)).toBeGreaterThan(computeStrength(recalledOnce, now));
  });

  it("negative Outcome Feedback shrinks effective half-life, accelerating decay", () => {
    const now = daysAfter(CREATED_AT, 14 + 7);
    const untouched = fixture({ baseHalfLifeDays: 7 });
    const negativeFeedbackOnce = fixture({ baseHalfLifeDays: 7, negativeFeedbackCount: 1 });

    expect(computeStrength(negativeFeedbackOnce, now)).toBeLessThan(computeStrength(untouched, now));
  });

  it("floors effective half-life so heavy negative feedback can't invert or zero it out", () => {
    const now = daysAfter(CREATED_AT, 14 + 7);
    const heavilyNegative = fixture({ baseHalfLifeDays: 7, negativeFeedbackCount: 100 });
    expect(computeStrength(heavilyNegative, now)).toBeGreaterThan(0);
    expect(Number.isFinite(computeStrength(heavilyNegative, now))).toBe(true);
  });

  it("treats a pre-v2 memory missing positiveFeedbackCount/negativeFeedbackCount as zero, not NaN", () => {
    const legacy = fixture({ baseHalfLifeDays: 7 });
    // @ts-expect-error simulating a genuinely pre-v2 file, where these keys are absent (undefined), not 0
    delete legacy.positiveFeedbackCount;
    // @ts-expect-error see above
    delete legacy.negativeFeedbackCount;

    const strength = computeStrength(legacy, daysAfter(CREATED_AT, 14 + 7));
    expect(Number.isFinite(strength)).toBe(true);
    expect(strength).toBeCloseTo(0.5, 5);
  });

  describe("Reinforcement Ceiling", () => {
    // Effective half-life can approach, but never reach, base*(1 + REINFORCEMENT_CEILING_MULTIPLIER).
    // A reference memory whose *base* half-life is set to exactly that theoretical
    // maximum (with zero bonus of its own) decays slower than any amount of
    // reinforcement can, so comparing against it proves the ceiling holds without
    // asserting on the formula's internal constants.
    function ceilingReference(baseHalfLifeDays: number): MemoryFrontmatter {
      return fixture({ baseHalfLifeDays: baseHalfLifeDays * 5 });
    }

    it("bounds Spaced Repetition's own recall/consolidation bonus below the theoretical ceiling at very high counts", () => {
      const now = daysAfter(CREATED_AT, 14 + 7);
      const heavilyRecalled = fixture({ baseHalfLifeDays: 7, recallCount: 50, consolidationSurvivalCount: 50 });

      expect(computeStrength(heavilyRecalled, now)).toBeLessThan(computeStrength(ceilingReference(7), now));
    });

    it("bounds Outcome Feedback's positive bonus below the theoretical ceiling at very high counts", () => {
      const now = daysAfter(CREATED_AT, 14 + 7);
      const heavilyPraised = fixture({ baseHalfLifeDays: 7, positiveFeedbackCount: 50 });

      expect(computeStrength(heavilyPraised, now)).toBeLessThan(computeStrength(ceilingReference(7), now));
    });

    it("keeps Spaced Repetition and Outcome Feedback under one shared ceiling, not two independent ones", () => {
      const now = daysAfter(CREATED_AT, 14 + 7);
      // If each mechanism had its own independent ceiling, combining huge counts of
      // both would exceed the single-mechanism theoretical maximum used above.
      const bothHeavilyReinforced = fixture({
        baseHalfLifeDays: 7,
        recallCount: 50,
        consolidationSurvivalCount: 50,
        positiveFeedbackCount: 50,
      });

      expect(computeStrength(bothHeavilyReinforced, now)).toBeLessThan(computeStrength(ceilingReference(7), now));
    });

    it("scales the ceiling proportionally to each Memory Kind's own baseHalfLifeDays for the same event count", () => {
      const episodic = fixture({ baseHalfLifeDays: BASE_HALF_LIFE_DAYS.episodic, recallCount: 15 });
      const semantic = fixture({ baseHalfLifeDays: BASE_HALF_LIFE_DAYS.semantic, recallCount: 15 });
      const elapsedDays = 100;
      const now = daysAfter(CREATED_AT, 14 + elapsedDays);

      // Recover each memory's effective half-life from computeStrength's output
      // (strength = 0.5^(elapsed/hl)  =>  hl = elapsed * ln(0.5) / ln(strength)),
      // then compare the *bonus-to-base ratio* rather than the internal formula.
      const inferEffectiveHalfLife = (strength: number) => (elapsedDays * Math.log(0.5)) / Math.log(strength);

      const episodicHalfLife = inferEffectiveHalfLife(computeStrength(episodic, now));
      const semanticHalfLife = inferEffectiveHalfLife(computeStrength(semantic, now));

      const episodicBonusRatio = (episodicHalfLife - BASE_HALF_LIFE_DAYS.episodic) / BASE_HALF_LIFE_DAYS.episodic;
      const semanticBonusRatio = (semanticHalfLife - BASE_HALF_LIFE_DAYS.semantic) / BASE_HALF_LIFE_DAYS.semantic;

      expect(episodicBonusRatio).toBeCloseTo(semanticBonusRatio, 5);
    });
  });
});
