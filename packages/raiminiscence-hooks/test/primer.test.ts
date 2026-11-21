import { describe, expect, it } from "vitest";
import type { OverviewResult, OverviewResultItem } from "raiminiscence-mcp";
import { primerText } from "#src/primer.js";

const NO_CURRENT_FOCUS = { own: null, project: null };

const OWN_CHECKPOINT: OverviewResultItem = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
  kind: "checkpoint",
  confidence: "observed",
  scope: "project",
  summary: "Working on the write-model migration",
  score: null,
  strength: 1,
};

const PROJECT_CHECKPOINT: OverviewResultItem = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  kind: "checkpoint",
  confidence: "observed",
  scope: "project",
  summary: "A teammate's checkpoint on the CSS refactor",
  score: null,
  strength: 1,
};

const FIXTURE_OVERVIEW: OverviewResult = {
  results: [
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      kind: "decision",
      confidence: "verified",
      scope: "project",
      summary: "Postgres chosen for write model",
      score: null,
      strength: 0.9,
    },
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      kind: "semantic",
      confidence: "inferred",
      scope: "project",
      summary: "Retry with exponential backoff on flaky network calls",
      score: null,
      strength: 0.7,
    },
  ],
  currentFocus: NO_CURRENT_FOCUS,
};

describe("primerText", () => {
  it("returns formatted, summary-only lines for a fixture project's overview results", async () => {
    const text = await primerText({
      storageRoot: "/tmp/does-not-matter",
      overviewFn: async () => FIXTURE_OVERVIEW,
    });

    expect(text).toBe(
      "[decision, verified] Postgres chosen for write model\n" + "[semantic, inferred] Retry with exponential backoff on flaky network calls",
    );
  });

  it("never includes full memory detail, only the summary line", async () => {
    const text = await primerText({
      storageRoot: "/tmp/does-not-matter",
      overviewFn: async () => ({
        results: [
          {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
            kind: "decision",
            confidence: "verified",
            scope: "project",
            summary: "Short summary line",
            score: null,
            strength: 1,
          },
        ],
        currentFocus: NO_CURRENT_FOCUS,
      }),
    });

    expect(text).toBe("[decision, verified] Short summary line");
    expect(text).not.toMatch(/detail|rationale|full body/i);
  });

  it("cuts off a hanging core-engine call at its internal timeout with no context and no thrown error", async () => {
    const hangingOverview = () =>
      new Promise<OverviewResult>((resolve) => {
        setTimeout(() => resolve(FIXTURE_OVERVIEW), 50_000);
      });

    const text = await primerText({
      storageRoot: "/tmp/does-not-matter",
      timeoutMs: 25,
      overviewFn: hangingOverview,
    });

    expect(text).toBe("");
  });

  it("returns no context (not an error) when the core-engine call rejects", async () => {
    const text = await primerText({
      storageRoot: "/tmp/does-not-matter",
      overviewFn: async () => {
        throw new Error("core engine exploded");
      },
    });

    expect(text).toBe("");
  });

  it("returns an empty primer for a project with nothing eligible yet", async () => {
    const text = await primerText({
      storageRoot: "/tmp/does-not-matter",
      overviewFn: async () => ({ results: [], currentFocus: NO_CURRENT_FOCUS }),
    });

    expect(text).toBe("");
  });

  describe("v13 (ADR-0020): currentFocus", () => {
    it("appends the caller's own most recent Checkpoint, labeled distinctly from the top-N results", async () => {
      const text = await primerText({
        storageRoot: "/tmp/does-not-matter",
        overviewFn: async () => ({ results: [], currentFocus: { own: OWN_CHECKPOINT, project: OWN_CHECKPOINT } }),
      });

      expect(text).toBe("[currentFocus:own] [checkpoint, observed] Working on the write-model migration");
    });

    it("appends the project's most recent Checkpoint only when it differs from the caller's own", async () => {
      const text = await primerText({
        storageRoot: "/tmp/does-not-matter",
        overviewFn: async () => ({ results: [], currentFocus: { own: OWN_CHECKPOINT, project: PROJECT_CHECKPOINT } }),
      });

      expect(text).toBe(
        "[currentFocus:own] [checkpoint, observed] Working on the write-model migration\n" +
          "[currentFocus:project] [checkpoint, observed] A teammate's checkpoint on the CSS refactor",
      );
    });

    it("omits the project line entirely when it's the same Checkpoint as own (single-writer, non-Shared-Memory case)", async () => {
      const text = await primerText({
        storageRoot: "/tmp/does-not-matter",
        overviewFn: async () => ({ results: [], currentFocus: { own: OWN_CHECKPOINT, project: OWN_CHECKPOINT } }),
      });

      expect(text).not.toMatch(/currentFocus:project/);
    });

    it("adds no currentFocus lines when neither own nor project exist yet", async () => {
      const text = await primerText({
        storageRoot: "/tmp/does-not-matter",
        overviewFn: async () => ({
          results: [
            {
              id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
              kind: "decision",
              confidence: "verified",
              scope: "project",
              summary: "Postgres chosen",
              score: null,
              strength: 0.9,
            },
          ],
          currentFocus: NO_CURRENT_FOCUS,
        }),
      });

      expect(text).toBe("[decision, verified] Postgres chosen");
    });
  });
});
