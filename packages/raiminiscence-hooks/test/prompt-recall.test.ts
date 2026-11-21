import { describe, expect, it } from "vitest";
import type { RecallResult } from "raiminiscence-mcp";
import { promptRecallText } from "#src/prompt-recall.js";

const FIXTURE_RECALL: RecallResult = {
  results: [
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      kind: "decision",
      confidence: "verified",
      scope: "project",
      source: { client: "claude-code" },
      summary: "Postgres chosen for write model",
      detail: "Postgres chosen for write model over the alternatives considered.",
      score: 0.9,
      strength: 0.9,
      surfacedVia: "match",
    },
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      kind: "semantic",
      confidence: "inferred",
      scope: "project",
      source: { client: "claude-code" },
      summary: "Retry with exponential backoff on flaky network calls",
      detail: "Retry with exponential backoff on flaky network calls, capped at five attempts.",
      score: 0.7,
      strength: 0.7,
      surfacedVia: "connection-1",
      conflictCandidateWith: ["01ARZ3NDEKTSV4RRFFQ69G5FAX"],
      conflictsWith: ["01ARZ3NDEKTSV4RRFFQ69G5FAY"],
    },
  ],
  usedFallback: false,
  consolidationTriggered: false,
};

describe("promptRecallText", () => {
  it("returns formatted, summary-only lines for a fixture recall result", async () => {
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      recallFn: async () => FIXTURE_RECALL,
    });

    expect(text).toBe(
      "[decision, verified] Postgres chosen for write model\n" + "[semantic, inferred] Retry with exponential backoff on flaky network calls",
    );
  });

  it("never includes surfacedVia/conflictsWith/conflictCandidateWith, even when present on the fixture", async () => {
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      recallFn: async () => FIXTURE_RECALL,
    });

    expect(text).not.toMatch(/surfacedVia|connection-1|conflictsWith|conflictCandidateWith|01ARZ3NDEKTSV4RRFFQ69G5FAX|01ARZ3NDEKTSV4RRFFQ69G5FAY/);
  });

  it("calls recall with the prompt's literal text as the query, k: 10 and triggerConsolidation: false", async () => {
    let receivedParams: unknown;
    await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "what did we decide about retries?",
      recallFn: async (params) => {
        receivedParams = params;
        return { results: [], usedFallback: false, consolidationTriggered: false };
      },
    });

    expect(receivedParams).toEqual({
      storageRoot: "/tmp/does-not-matter",
      query: "what did we decide about retries?",
      k: 10,
      triggerConsolidation: false,
    });
  });

  it("cuts off a hanging core-engine call at its internal timeout with no context and no thrown error", async () => {
    const hangingRecall = () =>
      new Promise<RecallResult>((resolve) => {
        setTimeout(() => resolve(FIXTURE_RECALL), 50_000);
      });

    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "anything",
      timeoutMs: 25,
      recallFn: hangingRecall,
    });

    expect(text).toBe("");
  });

  it("returns no context (not an error) when the core-engine call rejects", async () => {
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "anything",
      recallFn: async () => {
        throw new Error("core engine exploded");
      },
    });

    expect(text).toBe("");
  });

  it("returns an empty string for a prompt with nothing eligible to recall", async () => {
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "anything",
      recallFn: async () => ({ results: [], usedFallback: false, consolidationTriggered: false }),
    });

    expect(text).toBe("");
  });

  it("uses a running server's results and never recalls locally (ADR-0039)", async () => {
    let servedParams: unknown;
    let localCalls = 0;
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      servedRecallFn: async (params) => {
        servedParams = params;
        return FIXTURE_RECALL.results;
      },
      recallFn: async () => {
        localCalls += 1;
        return { results: [], usedFallback: false, consolidationTriggered: false };
      },
    });

    expect(text).toBe(
      "[decision, verified] Postgres chosen for write model\n" + "[semantic, inferred] Retry with exponential backoff on flaky network calls",
    );
    expect(servedParams).toEqual({ storageRoot: "/tmp/does-not-matter", query: "how did we pick the write model?", k: 10 });
    expect(localCalls).toBe(0);
  });

  it("recalls locally when no server answers (ADR-0039)", async () => {
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      servedRecallFn: async () => null,
      recallFn: async () => FIXTURE_RECALL,
    });

    expect(text).toBe(
      "[decision, verified] Postgres chosen for write model\n" + "[semantic, inferred] Retry with exponential backoff on flaky network calls",
    );
  });

  it("starts a warm process once its local recall is done, when no server answered (ADR-0040)", async () => {
    const events: string[] = [];
    await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      servedRecallFn: async () => null,
      recallFn: async () => {
        events.push("local recall");
        return FIXTURE_RECALL;
      },
      startWarmFn: (params) => events.push(`warm ${params.storageRoot}`),
    });

    expect(events).toEqual(["local recall", "warm /tmp/does-not-matter"]);
  });

  it("starts a warm process even when the local recall fails (ADR-0040)", async () => {
    const started: string[] = [];
    const text = await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      servedRecallFn: async () => null,
      recallFn: async () => {
        throw new Error("boom");
      },
      startWarmFn: (params) => started.push(params.storageRoot),
    });

    expect(text).toBe("");
    expect(started).toEqual(["/tmp/does-not-matter"]);
  });

  it("starts no warm process when a server answered (ADR-0040)", async () => {
    const started: string[] = [];
    await promptRecallText({
      storageRoot: "/tmp/does-not-matter",
      prompt: "how did we pick the write model?",
      servedRecallFn: async () => FIXTURE_RECALL.results,
      startWarmFn: (params) => started.push(params.storageRoot),
    });

    expect(started).toEqual([]);
  });
});
