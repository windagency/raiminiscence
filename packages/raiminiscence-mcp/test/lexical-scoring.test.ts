import { describe, expect, it } from "vitest";
import { bm25Scores, minMaxNormalize } from "#src/core/lexical-scoring.js";

describe("bm25Scores", () => {
  it("scores a body containing a query term above one that doesn't", () => {
    const [hit, miss] = bm25Scores("postgres durability", ["We chose Postgres for durability", "The cache is warmed on boot"]);

    expect(hit).toBeGreaterThan(0);
    expect(miss).toBe(0);
  });

  it("weighs a term rarer across the pool more heavily", () => {
    const bodies = ["deploy deploy rollback", "deploy pipeline", "deploy notes", "rollback plan"];
    const [, , deployOnly, rollbackOnly] = bm25Scores("deploy rollback", bodies);

    expect(rollbackOnly).toBeGreaterThan(deployOnly!);
  });

  it("matches case-insensitively on letter and digit runs", () => {
    const [score] = bm25Scores("HTTP/2 Timeout", ["the http 2 client timeout was raised"]);

    expect(score).toBeGreaterThan(0);
  });

  it("returns zeros for a query with no tokens", () => {
    expect(bm25Scores("  ?! ", ["anything at all", "more text"])).toEqual([0, 0]);
  });
});

describe("minMaxNormalize", () => {
  it("maps the lowest value to 0 and the highest to 1", () => {
    expect(minMaxNormalize([2, 4, 3])).toEqual([0, 1, 0.5]);
  });

  it("maps a pool of equal positive values to 1", () => {
    expect(minMaxNormalize([0.4, 0.4])).toEqual([1, 1]);
  });

  it("maps a pool of equal non-positive values to 0", () => {
    expect(minMaxNormalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("returns an empty array for an empty pool", () => {
    expect(minMaxNormalize([])).toEqual([]);
  });
});
