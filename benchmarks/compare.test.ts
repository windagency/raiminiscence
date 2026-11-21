import { describe, it, expect } from "vitest";
import { scoreQuery } from "./compare.js";

describe("scoreQuery", () => {
  it("scores an exact match at k (all relevant ids returned, nothing extra)", () => {
    const metrics = scoreQuery(
      {
        queryId: "q1",
        query: "exact match",
        relevantIds: ["a", "b"],
        topK: [
          { id: "a", score: 0.9 },
          { id: "b", score: 0.8 },
        ],
      },
      2,
    );
    expect(metrics.hits).toEqual(["a", "b"]);
    expect(metrics.recallAtK).toBe(1);
    expect(metrics.precisionAtK).toBe(1);
  });

  it("scores partial overlap between returned and relevant ids", () => {
    const metrics = scoreQuery(
      {
        queryId: "q2",
        query: "partial overlap",
        relevantIds: ["a", "b", "c"],
        topK: [
          { id: "a", score: 0.9 },
          { id: "x", score: 0.7 },
          { id: "c", score: 0.5 },
        ],
      },
      3,
    );
    expect(metrics.hits).toEqual(["a", "c"]);
    // 2 of 3 relevant ids were found.
    expect(metrics.recallAtK).toBeCloseTo(2 / 3);
    // 2 hits out of min(k=3, returned=3) = 3.
    expect(metrics.precisionAtK).toBeCloseTo(2 / 3);
  });

  it("treats an empty relevantIds list as recall 0, not NaN", () => {
    const metrics = scoreQuery(
      {
        queryId: "q3",
        query: "no ground truth",
        relevantIds: [],
        topK: [{ id: "a", score: 0.9 }],
      },
      1,
    );
    expect(metrics.recallAtK).toBe(0);
    // precision denominator is min(k=1, returned=1) = 1, with 0 hits.
    expect(metrics.precisionAtK).toBe(0);
  });

  it("treats an empty returned-ids list as precision 0, not NaN", () => {
    const metrics = scoreQuery(
      {
        queryId: "q4",
        query: "system returned nothing",
        relevantIds: ["a", "b"],
        topK: [],
      },
      5,
    );
    expect(metrics.hits).toEqual([]);
    expect(metrics.recallAtK).toBe(0);
    // precision denominator is min(k=5, returned=0) = 0 -> guarded to 0.
    expect(metrics.precisionAtK).toBe(0);
  });

  it("uses min(k, returnedIds.length) as the precision denominator when fewer than k results are returned", () => {
    const metrics = scoreQuery(
      {
        queryId: "q5",
        query: "fewer results than k",
        relevantIds: ["a", "b"],
        topK: [{ id: "a", score: 0.9 }],
      },
      5,
    );
    expect(metrics.hits).toEqual(["a"]);
    expect(metrics.recallAtK).toBeCloseTo(1 / 2);
    // 1 hit out of min(k=5, returned=1) = 1, NOT hits/k (which would be 1/5).
    expect(metrics.precisionAtK).toBe(1);
  });

  it("uses k itself as the precision denominator when returned results exceed k", () => {
    const metrics = scoreQuery(
      {
        queryId: "q6",
        query: "more results than k",
        relevantIds: ["a"],
        topK: [
          { id: "x", score: 0.95 },
          { id: "a", score: 0.9 },
          { id: "y", score: 0.85 },
        ],
      },
      2,
    );
    expect(metrics.hits).toEqual(["a"]);
    expect(metrics.recallAtK).toBe(1);
    // 1 hit out of min(k=2, returned=3) = 2.
    expect(metrics.precisionAtK).toBe(0.5);
  });

  it("scores zero overlap between returned and relevant ids", () => {
    const metrics = scoreQuery(
      {
        queryId: "q7",
        query: "no overlap",
        relevantIds: ["a", "b"],
        topK: [
          { id: "x", score: 0.9 },
          { id: "y", score: 0.8 },
        ],
      },
      2,
    );
    expect(metrics.hits).toEqual([]);
    expect(metrics.recallAtK).toBe(0);
    expect(metrics.precisionAtK).toBe(0);
  });

  it("passes through queryId, query, relevantIds and derives returnedIds from topK", () => {
    const metrics = scoreQuery(
      {
        queryId: "q8",
        query: "passthrough fields",
        relevantIds: ["a"],
        topK: [{ id: "a", score: 0.42 }],
      },
      1,
    );
    expect(metrics.queryId).toBe("q8");
    expect(metrics.query).toBe("passthrough fields");
    expect(metrics.relevantIds).toEqual(["a"]);
    expect(metrics.returnedIds).toEqual(["a"]);
  });
});
