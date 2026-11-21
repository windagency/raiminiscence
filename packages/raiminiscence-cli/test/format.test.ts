import { describe, expect, it } from "vitest";
import type { InspectMemoryResult, InspectQueryResult, RecallResultItem } from "raiminiscence-mcp";
import { formatBrowseResults, formatMemoryPanel, formatQueryResult } from "#src/format.js";

function memoryResult(overrides: Partial<InspectMemoryResult> = {}): InspectMemoryResult {
  return {
    id: "mem_abc123",
    kind: "decision",
    confidence: "observed",
    scope: "project",
    createdAt: "2026-01-01T00:00:00.000Z",
    summary: "Chose Postgres for the write model",
    detail: "Chose Postgres for the write model",
    strength: 0.75,
    baseHalfLifeDays: 21,
    effectiveHalfLifeDays: 21,
    reinforcementCeiling: { rawBonusDays: 0, boundedBonusDays: 0, ceilingDays: 10, percentUsed: 0 },
    ageDays: 3,
    reinforcement: {
      recallCount: 0,
      consolidationSurvivalCount: 0,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      lastRecalledAt: null,
    },
    ...overrides,
  };
}

function resultItem(overrides: Partial<RecallResultItem> = {}): RecallResultItem {
  return {
    id: "mem_abc123",
    kind: "decision",
    confidence: "observed",
    scope: "project",
    source: { client: "claude-code" },
    summary: "Chose Postgres for the write model",
    detail: "Chose Postgres for the write model",
    score: 0.9,
    strength: 0.75,
    surfacedVia: "match",
    ...overrides,
  };
}

describe("formatMemoryPanel", () => {
  it("compact mode ignores every field but id/kind/confidence/strength", () => {
    const output = formatMemoryPanel(memoryResult(), false);
    expect(output).toBe("mem_abc123  [decision, observed]  strength 0.75");
  });

  it("detailed mode shows a negative reinforcement bonus (decayed faster than base) without a stray '+'", () => {
    const output = formatMemoryPanel(memoryResult({ baseHalfLifeDays: 21, effectiveHalfLifeDays: 14 }), true);
    expect(output).toContain("(base 21d -> -7.0d reinforcement)");
  });

  it("detailed mode shows a positive reinforcement bonus with a leading '+'", () => {
    const output = formatMemoryPanel(memoryResult({ baseHalfLifeDays: 21, effectiveHalfLifeDays: 28 }), true);
    expect(output).toContain("(base 21d -> +7.0d reinforcement)");
  });

  it("detailed mode lists a negative Outcome Feedback count only when it's non-zero", () => {
    const withNegative = formatMemoryPanel(
      memoryResult({
        reinforcement: {
          recallCount: 1,
          consolidationSurvivalCount: 0,
          positiveFeedbackCount: 1,
          negativeFeedbackCount: 2,
          lastRecalledAt: null,
        },
      }),
      true,
    );
    expect(withNegative).toContain("2x negative Outcome Feedback");

    const withoutNegative = formatMemoryPanel(memoryResult(), true);
    expect(withoutNegative).not.toContain("negative Outcome Feedback");
  });
});

describe("formatQueryResult", () => {
  it("reports no qualifying results distinctly from an empty near-miss list", () => {
    const output = formatQueryResult({ results: [], nearMisses: [], usedFallback: false }, false);
    expect(output).toBe("┌─ (no qualifying results)\n└─");
  });

  it("connects a second result with '├─' rather than repeating '┌─'", () => {
    const result: InspectQueryResult = {
      results: [resultItem({ id: "mem_1" }), resultItem({ id: "mem_2" })],
      nearMisses: [],
      usedFallback: false,
    };
    const output = formatQueryResult(result, false);
    expect(output).toContain("┌─ 1. ");
    expect(output).toContain("├─ 2. ");
  });

  it("shows conflictsWith and conflictCandidateWith only when present", () => {
    const result: InspectQueryResult = {
      results: [resultItem({ conflictsWith: ["mem_2"], conflictCandidateWith: ["mem_3"] })],
      nearMisses: [],
      usedFallback: false,
    };
    const output = formatQueryResult(result, false);
    expect(output).toContain("conflictsWith: mem_2");
    expect(output).toContain("conflictCandidateWith: mem_3");
  });

  it("hides near-misses behind a count by default, and lists each one with --detailed", () => {
    const result: InspectQueryResult = {
      results: [],
      nearMisses: [
        { id: "mem_1", kind: "semantic", confidence: "stale", summary: "stale note", strength: 0.1, exclusionReason: "stale" },
        { id: "mem_2", kind: "semantic", confidence: "observed", summary: "below floor", strength: 0.05, exclusionReason: "below-min-score" },
      ],
      usedFallback: false,
    };

    const compact = formatQueryResult(result, false);
    expect(compact).toContain("2 near-misses hidden — rerun with --detailed to show them");
    expect(compact).not.toContain("excluded:");

    const detailed = formatQueryResult(result, true);
    expect(detailed).toContain("mem_1  score n/a  strength 0.10  excluded: stale");
    expect(detailed).toContain("mem_2  score n/a  strength 0.05  excluded: below-min-score");
  });

  it("singularizes the near-miss count line for exactly one hidden near-miss", () => {
    const result: InspectQueryResult = {
      results: [],
      nearMisses: [{ id: "mem_1", kind: "semantic", confidence: "stale", summary: "stale note", strength: 0.1, exclusionReason: "stale" }],
      usedFallback: false,
    };
    expect(formatQueryResult(result, false)).toContain("1 near-miss hidden");
  });
});

describe("formatBrowseResults", () => {
  it("reports a distinct message for an empty result set", () => {
    expect(formatBrowseResults([], false)).toBe("(no memories matched)");
    expect(formatBrowseResults([], true)).toBe("(no memories matched)");
  });

  it("compact mode joins one line per memory with no blank-line separation", () => {
    const output = formatBrowseResults([memoryResult({ id: "mem_1" }), memoryResult({ id: "mem_2" })], false);
    expect(output).toBe("mem_1  [decision, observed]  strength 0.75\nmem_2  [decision, observed]  strength 0.75");
  });

  it("detailed mode joins full panels separated by a blank line", () => {
    const output = formatBrowseResults([memoryResult({ id: "mem_1" }), memoryResult({ id: "mem_2" })], true);
    const panels = output.split("\n\n");
    expect(panels).toHaveLength(2);
    expect(panels[0]).toContain("┌─ Decision");
    expect(panels[1]).toContain("┌─ Decision");
  });
});
