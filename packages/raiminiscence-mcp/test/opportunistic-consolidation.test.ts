import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllMemories } from "#src/core/storage.js";
import { recall, remember, settleOpportunisticConsolidation } from "#src/core/engine.js";
import { triggerOpportunisticConsolidation } from "#src/core/opportunistic-consolidation.js";
import {
  OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD,
  OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS,
  readOpportunisticConsolidationState,
  writeOpportunisticConsolidationState,
} from "#src/core/opportunistic-consolidation-state.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

function stubProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    identity: { provider: "stub", model: "stub" },
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

describe("opportunistic consolidation: testability seam", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-opportunistic-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  /**
   * v19 (ADR-0025) + race guard (fix): the first call fires unconditionally
   * (a fresh storage root has no persisted debounce state yet). The second
   * lands before that first call's `setImmediate`-deferred pass has even
   * started, let alone reset the clock — without the in-flight guard it
   * would misread the same "no state yet" snapshot and fire a second,
   * concurrent pass; the guard correctly skips it instead. The single pass
   * that does run still sees both memories, already written to disk
   * synchronously by each `remember` call before either's trigger check
   * ran, so it still consolidates both into one semantic memory below.
   */
  it("settleOpportunisticConsolidation waits for the background pass a remember call scheduled", async () => {
    const contentA = "Observation A about retry backoff.";
    const contentB = "Observation B about retry backoff.";
    const provider = stubProvider({ [contentA]: [1, 0], [contentB]: [0.99, 0.01] });
    // A fixed identity keeps B's write within microtasks, so it lands before A's pass runs; the real
    // identity reads git asynchronously, which would race that pass.
    const writerIdentityProvider = () => ({ sessionId: "settle-session" });

    await remember({ content: contentA, client: "claude-code", storageRoot, embeddingProvider: provider, writerIdentityProvider });
    const result = await remember({ content: contentB, client: "claude-code", storageRoot, embeddingProvider: provider, writerIdentityProvider });
    expect(result.consolidationTriggered).toBe(false);

    await settleOpportunisticConsolidation();

    expect(readAllMemories(storageRoot, ["semantic"])).toHaveLength(1);
  });

  it("triggerConsolidation: false suppresses the background pass entirely, on both remember and recall", async () => {
    const contentA = "Observation A about flaky retries.";
    const contentB = "Observation B about flaky retries.";
    const provider = stubProvider({ [contentA]: [1, 0], [contentB]: [0.99, 0.01] });

    const rememberedA = await remember({
      content: contentA,
      client: "claude-code",
      storageRoot,
      embeddingProvider: provider,
      triggerConsolidation: false,
    });
    expect(rememberedA.consolidationTriggered).toBe(false);

    const rememberedB = await remember({
      content: contentB,
      client: "claude-code",
      storageRoot,
      embeddingProvider: provider,
      triggerConsolidation: false,
    });
    expect(rememberedB.consolidationTriggered).toBe(false);

    const recalled = await recall({
      query: "flaky retries",
      storageRoot,
      embeddingProvider: provider,
      triggerConsolidation: false,
    });
    expect(recalled.consolidationTriggered).toBe(false);

    await settleOpportunisticConsolidation();

    expect(readAllMemories(storageRoot, ["semantic"])).toHaveLength(0);
  });

  it("recall's consolidationTriggered reports true by default, symmetric with remember", async () => {
    const content = "Something to recall.";
    const provider = stubProvider({ [content]: [1, 0] });
    // `triggerConsolidation: false` on this seed `remember` call so it never
    // touches the debounce state (or the new race guard's in-flight flag)
    // itself — isolates the assertion below to `recall`'s own trigger,
    // independent of `remember`'s, rather than racing the two.
    await remember({ content, client: "claude-code", storageRoot, embeddingProvider: provider, triggerConsolidation: false });

    const recalled = await recall({ query: "something to recall", storageRoot, embeddingProvider: provider });

    expect(recalled.consolidationTriggered).toBe(true);
    await settleOpportunisticConsolidation();
  });

  it("a call landing after a just-completed pass correctly reports consolidationTriggered: false", async () => {
    const contentA = "Observation A about connection pooling.";
    const contentB = "Observation B about connection pooling.";
    const provider = stubProvider({ [contentA]: [1, 0], [contentB]: [0.99, 0.01] });

    await remember({ content: contentA, client: "claude-code", storageRoot, embeddingProvider: provider });
    await settleOpportunisticConsolidation();

    const result = await remember({ content: contentB, client: "claude-code", storageRoot, embeddingProvider: provider });

    expect(result.consolidationTriggered).toBe(false);
  });
});

describe("opportunistic consolidation: v19 debounce", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-opportunistic-debounce-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("treats a state file of the wrong shape as absent, with a warning", () => {
    const cacheDir = join(storageRoot, ".raiminiscence", "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "opportunistic-consolidation.json"), JSON.stringify({ lastPassAt: 5, callsSinceLastPass: "4" }));
    const warnings: string[] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (_fields: Record<string, unknown>, msg?: string) => warnings.push(msg ?? ""),
      error: () => {},
    };

    expect(readOpportunisticConsolidationState(storageRoot, logger)).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/unexpected shape/)]);
  });

  it("fires unconditionally when no debounce state has ever been persisted for this storage root", async () => {
    expect(readOpportunisticConsolidationState(storageRoot)).toBeUndefined();

    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, new Date("2026-01-01T00:00:00.000Z"), true, stubProvider({}));

    expect(fired).toBe(true);
    await settleOpportunisticConsolidation();
  });

  /**
   * Race-guard regression: without an in-flight guard, a second call landing
   * before the first scheduled pass's `setImmediate` callback has even run
   * would still read the same "no state yet" (always-due) snapshot as the
   * first and fire its own concurrent `runConsolidate`, reintroducing the
   * back-to-back-pass contention the debounce exists to prevent. Both calls
   * here happen synchronously, before either's deferred pass has had a
   * chance to run and reset the clock — the only way to observe this race.
   */
  it("a second call landing while the first's scheduled pass is still in flight is skipped, not fired concurrently", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const first = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));
    const second = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(first).toBe(true);
    expect(second).toBe(false);

    await settleOpportunisticConsolidation();

    // Once the in-flight pass has settled and reset the clock, a fresh call
    // is free to fire again — the guard only blocks concurrent overlap, not
    // every future call.
    const afterSettle = triggerOpportunisticConsolidation(
      "project",
      { storageRoot },
      new Date(now.getTime() + OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS),
      true,
      stubProvider({}),
    );
    expect(afterSettle).toBe(true);
    await settleOpportunisticConsolidation();
  });

  it("does not fire when neither the time interval nor the call-count threshold has elapsed", () => {
    const lastPassAt = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, { lastPassAt: lastPassAt.toISOString(), callsSinceLastPass: 0 });

    const now = new Date(lastPassAt.getTime() + 1);
    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(fired).toBe(false);
  });

  it("does not fire one millisecond before the time-interval boundary", () => {
    const lastPassAt = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, { lastPassAt: lastPassAt.toISOString(), callsSinceLastPass: 0 });

    const now = new Date(lastPassAt.getTime() + OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS - 1);
    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(fired).toBe(false);
  });

  it("fires exactly at the time-interval boundary", async () => {
    const lastPassAt = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, { lastPassAt: lastPassAt.toISOString(), callsSinceLastPass: 0 });

    const now = new Date(lastPassAt.getTime() + OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS);
    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(fired).toBe(true);
    await settleOpportunisticConsolidation();
  });

  it("does not fire one call short of the call-count threshold", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, {
      lastPassAt: now.toISOString(),
      callsSinceLastPass: OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD - 1,
    });

    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(fired).toBe(false);
  });

  it("fires exactly at the call-count boundary, even though the time interval hasn't elapsed", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, {
      lastPassAt: now.toISOString(),
      callsSinceLastPass: OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD,
    });

    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(fired).toBe(true);
    await settleOpportunisticConsolidation();
  });

  it("a skipped (not-due) call still persists its own increment of the running call count", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, { lastPassAt: now.toISOString(), callsSinceLastPass: 3 });

    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, now, true, stubProvider({}));

    expect(fired).toBe(false);
    expect(readOpportunisticConsolidationState(storageRoot)).toEqual({ lastPassAt: now.toISOString(), callsSinceLastPass: 4 });
  });

  it("disabled (enabled: false) never fires and never touches the persisted state, regardless of debounce due-ness", () => {
    const lastPassAt = new Date("2026-01-01T00:00:00.000Z");
    writeOpportunisticConsolidationState(storageRoot, {
      lastPassAt: lastPassAt.toISOString(),
      callsSinceLastPass: OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD,
    });

    const fired = triggerOpportunisticConsolidation("project", { storageRoot }, lastPassAt, false, stubProvider({}));

    expect(fired).toBe(false);
    expect(readOpportunisticConsolidationState(storageRoot)).toEqual({
      lastPassAt: lastPassAt.toISOString(),
      callsSinceLastPass: OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD,
    });
  });
});
