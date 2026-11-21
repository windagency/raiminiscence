import { describe, expect, it } from "vitest";
import {
  gateVerdict,
  hookChecks,
  locomoRecall,
  longMemEvalHits,
  metricChecks,
  pairedMeanDifference,
  renderGateReport,
  type LongMemEvalQuestion,
  type LongMemEvalRow,
  type LocomoQa,
} from "./benchmark-gate-verdict.js";

const question = (id: string, answerSessionIds: string[], answer = "Business Administration"): LongMemEvalQuestion => ({
  question_id: id,
  answer_session_ids: answerSessionIds,
  answer,
});
const row = (id: string, ...sessions: [tag: string, content?: string][]): LongMemEvalRow => ({
  question_id: id,
  retrieved_memories: sessions.map(([tag, content = ""]) => ({ tags: [tag], content })),
});

describe("pairedMeanDifference", () => {
  it("reports both means, their difference and a 95% bootstrap interval around it", () => {
    const rai = Array.from({ length: 200 }, (_, i) => (i % 10 < 9 ? 1 : 0));
    const hippo = Array.from({ length: 200 }, (_, i) => (i % 10 < 8 ? 1 : 0));
    const summary = pairedMeanDifference(rai, hippo);

    expect(summary.raiminiscence).toBeCloseTo(0.9);
    expect(summary.hippo).toBeCloseTo(0.8);
    expect(summary.difference).toBeCloseTo(0.1);
    expect(summary.ci95[0]).toBeLessThanOrEqual(summary.difference);
    expect(summary.ci95[1]).toBeGreaterThanOrEqual(summary.difference);
    expect(summary.ci95[1] - summary.ci95[0]).toBeGreaterThan(0);
  });

  it("gives a zero-width interval when every pair agrees", () => {
    expect(pairedMeanDifference([1, 0, 1], [1, 0, 1]).ci95).toEqual([0, 0]);
  });

  it("refuses unpaired samples", () => {
    expect(() => pairedMeanDifference([1], [1, 0])).toThrow();
  });
});

describe("longMemEvalHits", () => {
  const questions = [question("q1", ["answer_1", "answer_2"]), question("q2_abs", ["answer_9"]), question("q3", ["answer_3"], "it")];
  const rows = [
    row("q1", ["x"], ["answer_2", "graduated in Business Administration"], ["answer_1"]),
    row("q2_abs", ["answer_9"]),
    row("q3", ["answer_3", "it is"]),
  ];
  const hits = longMemEvalHits(rows, questions);

  it("scores any-evidence recall as hippo-memory's evaluate_retrieval.py does: an evidence session's id in a tag, every question", () => {
    expect(hits["any-evidence R@1"]).toEqual({ q1: 0, q2_abs: 1, q3: 1 });
    expect(hits["any-evidence R@3"]).toEqual({ q1: 1, q2_abs: 1, q3: 1 });
  });

  it("scores all-evidence recall as score_haystack.py does: every evidence session, abstentions left out", () => {
    expect(hits["all-evidence R@1"]).toEqual({ q1: 0, q3: 1 });
    expect(hits["all-evidence R@5"]).toEqual({ q1: 1, q3: 1 });
  });

  it("scores answer_in_content@5 as evaluate_retrieval.py does, ignoring answers under three characters", () => {
    expect(hits["answer_in_content@5"]).toEqual({ q1: 1, q2_abs: 0, q3: 0 });
  });
});

describe("locomoRecall", () => {
  it("averages the share of gold turns in the top k over scored QAs, as hippo-memory's analysis does", () => {
    const qas: LocomoQa[] = [
      { conversation_id: "c", qa_index: 0, scored: true, gold_evidence: ["D1:1", "D1:2"], retrieved_dia_ids: ["D1:1", "D9:9", "D1:2"] },
      { conversation_id: "c", qa_index: 1, scored: false, gold_evidence: ["D1:1"], retrieved_dia_ids: [] },
    ];
    const recall = locomoRecall(qas);

    expect(recall["R@1"]).toEqual({ "c#0": 0.5 });
    expect(recall["R@3"]).toEqual({ "c#0": 1 });
  });
});

describe("metricChecks", () => {
  it("passes a metric whose interval's lower bound is at or above -3 points, and fails one below", () => {
    const tie = Array.from({ length: 1000 }, (_, i) => i % 2);
    const scores = (values: number[]) => Object.fromEntries(values.map((v, i) => [`q${i}`, v]));
    // One point behind on 1000 questions puts the lower bound near -1.6 points; ten behind, near -12.
    const slightly = tie.map((value, i) => (i < 20 && value === 1 ? 0 : value));
    const clearly = tie.map((value, i) => (i < 200 && value === 1 ? 0 : value));
    const checks = metricChecks("LoCoMo", "hippo-memory B", {
      level: { rai: scores(tie), hippo: scores(tie) },
      slightly: { rai: scores(slightly), hippo: scores(tie) },
      clearly: { rai: scores(clearly), hippo: scores(tie) },
    });

    expect(checks.map(({ metric, ci95, pass }) => [metric, ci95[0] < -0.01, pass])).toEqual([
      ["level", false, true],
      ["slightly", true, true],
      ["clearly", true, false],
    ]);
  });

  it("pairs by question id and refuses runs that do not cover the same questions", () => {
    expect(() => metricChecks("LoCoMo", "B", { m: { rai: { a: 1 }, hippo: { b: 1 } } })).toThrow(/same questions/);
  });
});

describe("hookChecks", () => {
  it("passes a store size where rAIminiscence's median is at or below hippo-memory's", () => {
    const checks = hookChecks([
      { storeSize: 10, summary: { medianMs: { raiminiscence: 50, hippo: 120 } } },
      { storeSize: 1500, summary: { medianMs: { raiminiscence: 130, hippo: 120 } } },
    ]);

    expect(checks.map(({ storeSize, pass }) => [storeSize, pass])).toEqual([
      [10, true],
      [1500, false],
    ]);
  });
});

describe("gateVerdict and renderGateReport", () => {
  it("fails the gate when any check fails, and names the failing checks in the report", () => {
    const metrics = [
      {
        suite: "LongMemEval-S",
        reference: "hippo-memory B",
        metric: "any-evidence R@1",
        raiminiscence: 0.864,
        hippo: 0.876,
        difference: -0.012,
        ci95: [-0.036, 0.012] as [number, number],
        pass: false,
      },
    ];
    const hooks = hookChecks([{ storeSize: 10, summary: { medianMs: { raiminiscence: 50, hippo: 120 } } }]);
    const verdict = gateVerdict(metrics, hooks);
    const report = renderGateReport(verdict, { date: "2026-11-09", hippoVersion: "3.3.3", sources: ["a.jsonl"] });

    expect(verdict.pass).toBe(false);
    expect(report).toContain("**Fails.** 1 check fails: LongMemEval-S any-evidence R@1 against hippo-memory B.");
    expect(report).toContain("| LongMemEval-S | hippo-memory B | any-evidence R@1 | 86.4 | 87.6 | -1.2 [-3.6, +1.2] | fails |");
    expect(report).toContain("| 10 | 50.0 ms | 120.0 ms | passes |");
  });
});
