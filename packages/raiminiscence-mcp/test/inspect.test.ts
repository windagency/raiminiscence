import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browseMemories, inspectMemory, inspectQuery, recall, remember } from "#src/core/engine.js";
import { readMemory, writeMemory } from "#src/core/storage.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

function stubProvider(vectors: Record<string, number[]>, identity = { provider: "stub", model: "stub" }): EmbeddingProvider {
  return {
    identity,
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

/**
 * Every fixture here disables opportunistic (background) consolidation —
 * `remember`'s default — so a test's own deliberately-decayed/staled
 * fixtures can't be pruned or staled again out from under it mid-test by an
 * unrelated background pass (see `opportunistic-consolidation.test.ts`).
 */
const NO_CONSOLIDATION = { triggerConsolidation: false } as const;

describe("inspectMemory", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-inspect-memory-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("reports Strength/Half-life/Confidence Tier/age/reinforcement for a fresh memory", async () => {
    const remembered = await remember({ content: "A fresh observation.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const now = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    const result = inspectMemory({ id: remembered.id, storageRoot, now });

    expect(result.id).toBe(remembered.id);
    expect(result.kind).toBe("episodic");
    expect(result.confidence).toBe("observed");
    expect(result.strength).toBe(1); // inside the 14-day grace period
    expect(result.baseHalfLifeDays).toBe(7);
    expect(result.effectiveHalfLifeDays).toBe(7);
    expect(result.reinforcementCeiling).toEqual({ rawBonusDays: 0, boundedBonusDays: 0, ceilingDays: 28, percentUsed: 0 });
    // Precision reflects real wall-clock elapsed time, not a fixed offset — tolerate suite-load jitter
    // (whole-second scale) while still catching an off-by-a-day or units-mixup calculation error.
    expect(result.ageDays).toBeCloseTo(5, 2);
    expect(result.reinforcement).toEqual({
      recallCount: 0,
      consolidationSurvivalCount: 0,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      lastRecalledAt: null,
    });
  });

  it("reports a nonzero Reinforcement Ceiling usage for a heavily-reinforced memory, extending its effective half-life", async () => {
    const remembered = await remember({
      content: "A heavily reinforced decision.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      ...NO_CONSOLIDATION,
    });
    const memory = readMemory(storageRoot, "decision", remembered.id)!;
    memory.frontmatter.recallCount = 4;
    memory.frontmatter.positiveFeedbackCount = 2;
    writeMemory(storageRoot, memory);

    const result = inspectMemory({ id: remembered.id, storageRoot });

    expect(result.reinforcement.recallCount).toBe(4);
    expect(result.reinforcement.positiveFeedbackCount).toBe(2);
    expect(result.reinforcementCeiling.rawBonusDays).toBeGreaterThan(0);
    expect(result.reinforcementCeiling.boundedBonusDays).toBeGreaterThan(0);
    expect(result.reinforcementCeiling.percentUsed).toBeGreaterThan(0);
    expect(result.reinforcementCeiling.percentUsed).toBeLessThan(100);
    expect(result.effectiveHalfLifeDays).toBeGreaterThan(result.baseHalfLifeDays);
  });

  it("reports a shrunk effective half-life for a memory with negative Outcome Feedback", async () => {
    const remembered = await remember({
      content: "A memory that turned out unhelpful.",
      client: "claude-code",
      storageRoot,
      ...NO_CONSOLIDATION,
    });
    const memory = readMemory(storageRoot, "episodic", remembered.id)!;
    memory.frontmatter.negativeFeedbackCount = 2;
    writeMemory(storageRoot, memory);

    const result = inspectMemory({ id: remembered.id, storageRoot });

    expect(result.effectiveHalfLifeDays).toBeLessThan(result.baseHalfLifeDays);
  });

  it("throws the shared not-found error for an unknown id", () => {
    expect(() => inspectMemory({ id: "nonexistent-id", storageRoot })).toThrow(/No memory found/);
  });

  it("never mutates the memory it inspects (recallCount, lastRecalledAt, confidence all unchanged)", async () => {
    const remembered = await remember({ content: "Should stay untouched.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const before = readMemory(storageRoot, "episodic", remembered.id)!;

    inspectMemory({ id: remembered.id, storageRoot });
    inspectMemory({ id: remembered.id, storageRoot });
    inspectMemory({ id: remembered.id, storageRoot });

    const after = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(after.frontmatter).toEqual(before.frontmatter);
  });
});

describe("inspectQuery", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-inspect-query-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("produces the identical qualifying-result set and surfacedVia values as an equivalent recall() call on the same fixture", async () => {
    const query = "database write durability";
    const strongMatch = "Postgres chosen for transactional write durability";
    const weakMatch = "A tangential note that still barely mentions durability";
    const decoy = "Completely unrelated note about CSS grid layout";

    const provider = stubProvider({
      [query]: [1, 0, 0],
      [strongMatch]: [0.99, 0.05, 0],
      [weakMatch]: [0.35, 0.9, 0],
      [decoy]: [0, 0, 1],
    });

    const strong = await remember({ content: strongMatch, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const weak = await remember({ content: weakMatch, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    await remember({ content: decoy, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });

    const normalize = (results: { id: string; score: number; surfacedVia: string }[]) =>
      [...results].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, score, surfacedVia }) => ({ id, score, surfacedVia }));

    // Called *before* recall() below, against identical, not-yet-mutated
    // state — inspectQuery never mutates anything itself (asserted
    // separately below), so calling it first rather than reusing a second
    // storage root is what actually guarantees both calls score the same
    // starting state, not two independently-fixtured stores that would only
    // coincidentally agree.
    const inspected = await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });
    const recalled = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

    expect(normalize(inspected.results)).toEqual(normalize(recalled.results));
  });

  it("reports a below-minScore candidate as a near-miss with exclusionReason 'below-min-score', never inside recall()'s own results", async () => {
    const query = "database write durability";
    const strongMatch = "Postgres chosen for transactional write durability";
    const decoy = "Completely unrelated note about CSS grid layout";

    const provider = stubProvider({
      [query]: [1, 0],
      [strongMatch]: [1, 0],
      [decoy]: [0, 1],
    });

    await remember({ content: strongMatch, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const decoyMemory = await remember({ content: decoy, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });

    const inspected = await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0.5 });
    const recalled = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.5 });

    expect(recalled.results.some((r) => r.id === decoyMemory.id)).toBe(false);
    expect(inspected.results.some((r) => r.id === decoyMemory.id)).toBe(false);
    const nearMiss = inspected.nearMisses.find((m) => m.id === decoyMemory.id);
    expect(nearMiss?.exclusionReason).toBe("below-min-score");
  });

  it("reports a stale candidate as a near-miss with exclusionReason 'stale', excluded from recall()'s results entirely", async () => {
    const query = "auth token approach";
    const staleMatch = "Session tokens via signed JWT, no refresh rotation";

    const provider = stubProvider({ [query]: [1, 0], [staleMatch]: [1, 0] });

    const remembered = await remember({
      content: staleMatch,
      kind: "semantic",
      client: "claude-code",
      storageRoot,
      embeddingProvider: provider,
      ...NO_CONSOLIDATION,
    });
    const memory = readMemory(storageRoot, "semantic", remembered.id)!;
    memory.frontmatter.confidence = "stale";
    memory.frontmatter.staleReason = "Invalidation";
    writeMemory(storageRoot, memory);

    const inspected = await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0 });
    const recalled = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0 });

    expect(recalled.results).toEqual([]);
    expect(inspected.results).toEqual([]);
    const nearMiss = inspected.nearMisses.find((m) => m.id === remembered.id);
    expect(nearMiss?.exclusionReason).toBe("stale");
    expect(nearMiss?.strength).toBeGreaterThan(0);
  });

  it("reports a retracted candidate as a near-miss with exclusionReason 'retracted'", async () => {
    const query = "old approach";
    const content = "An approach we later retracted";
    const provider = stubProvider({ [query]: [1, 0], [content]: [1, 0] });

    const remembered = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const memory = readMemory(storageRoot, "episodic", remembered.id)!;
    memory.frontmatter.confidence = "retracted";
    memory.frontmatter.retractedAt = new Date().toISOString();
    writeMemory(storageRoot, memory);

    const inspected = await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0 });
    const nearMiss = inspected.nearMisses.find((m) => m.id === remembered.id);
    expect(nearMiss?.exclusionReason).toBe("retracted");
  });

  it("never mutates recallCount or lastRecalledAt, run any number of times", async () => {
    const query = "database write durability";
    const strongMatch = "Postgres chosen for transactional write durability";
    const weakMatch = "A tangential note that still barely mentions durability";
    const provider = stubProvider({ [query]: [1, 0, 0], [strongMatch]: [0.99, 0.05, 0], [weakMatch]: [0.35, 0.9, 0] });

    const strong = await remember({ content: strongMatch, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const weak = await remember({ content: weakMatch, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const beforeStrong = readMemory(storageRoot, "episodic", strong.id)!.frontmatter;
    const beforeWeak = readMemory(storageRoot, "episodic", weak.id)!.frontmatter;

    await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });
    await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });
    await inspectQuery({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

    const afterStrong = readMemory(storageRoot, "episodic", strong.id)!.frontmatter;
    const afterWeak = readMemory(storageRoot, "episodic", weak.id)!.frontmatter;

    expect(afterStrong).toEqual(beforeStrong);
    expect(afterWeak).toEqual(beforeWeak);
  });

  it("v17: treats a Memory embedded under a different provider than the current query as unembedded, matching recall()'s own fallback", async () => {
    const query = "abc";
    const content = "xyz has nothing in common lexically with the query";

    const rememberingProvider = stubProvider({ [content]: [1, 0] }, { provider: "ollama", model: "nomic-embed-text" });
    const queryingProvider = stubProvider({ [query]: [1, 0] }, { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" });

    await remember({ content, client: "claude-code", storageRoot, embeddingProvider: rememberingProvider, ...NO_CONSOLIDATION });

    const result = await inspectQuery({ query, storageRoot, embeddingProvider: queryingProvider });

    expect(result.results).toEqual([]);
  });
});

describe("browseMemories", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-browse-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("filters by kind", async () => {
    const episodic = await remember({ content: "An episodic note.", kind: "episodic", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const decision = await remember({ content: "A decision note.", kind: "decision", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });

    const results = browseMemories({ storageRoot, filters: { kind: "decision" } });

    expect(results.map((r) => r.id)).toEqual([decision.id]);
    expect(results.map((r) => r.id)).not.toContain(episodic.id);
  });

  it("filters by confidenceTier, including stale memories the active-only cache would hide", async () => {
    const active = await remember({ content: "Still active.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const staled = await remember({ content: "Now stale.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const memory = readMemory(storageRoot, "episodic", staled.id)!;
    memory.frontmatter.confidence = "stale";
    writeMemory(storageRoot, memory);

    const staleResults = browseMemories({ storageRoot, filters: { confidenceTier: "stale" } });
    expect(staleResults.map((r) => r.id)).toEqual([staled.id]);

    const observedResults = browseMemories({ storageRoot, filters: { confidenceTier: "observed" } });
    expect(observedResults.map((r) => r.id)).toEqual([active.id]);
  });

  it("filters by a minStrength/maxStrength threshold", async () => {
    const now = new Date();
    const fresh = await remember({ content: "Freshly created.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const decayed = await remember({ content: "Created long ago.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const memory = readMemory(storageRoot, "episodic", decayed.id)!;
    memory.frontmatter.createdAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    writeMemory(storageRoot, memory);

    const weakOnly = browseMemories({ storageRoot, filters: { maxStrength: 0.1 }, now });
    expect(weakOnly.map((r) => r.id)).toEqual([decayed.id]);

    const strongOnly = browseMemories({ storageRoot, filters: { minStrength: 0.9 }, now });
    expect(strongOnly.map((r) => r.id)).toEqual([fresh.id]);
  });

  it("filters by a createdAt range (since/until)", async () => {
    const early = await remember({ content: "Created early.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const earlyMemory = readMemory(storageRoot, "episodic", early.id)!;
    earlyMemory.frontmatter.createdAt = "2026-01-01T00:00:00.000Z";
    writeMemory(storageRoot, earlyMemory);

    const late = await remember({ content: "Created late.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const lateMemory = readMemory(storageRoot, "episodic", late.id)!;
    lateMemory.frontmatter.createdAt = "2026-06-01T00:00:00.000Z";
    writeMemory(storageRoot, lateMemory);

    const results = browseMemories({ storageRoot, filters: { since: "2026-03-01T00:00:00.000Z" } });
    expect(results.map((r) => r.id)).toEqual([late.id]);
  });

  it("combines filters", async () => {
    const decision = await remember({ content: "A decision to keep.", kind: "decision", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    await remember({ content: "An episodic note.", kind: "episodic", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const staleDecision = await remember({
      content: "A stale decision.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      ...NO_CONSOLIDATION,
    });
    const memory = readMemory(storageRoot, "decision", staleDecision.id)!;
    memory.frontmatter.confidence = "stale";
    writeMemory(storageRoot, memory);

    const results = browseMemories({ storageRoot, filters: { kind: "decision", confidenceTier: "observed" } });
    expect(results.map((r) => r.id)).toEqual([decision.id]);
  });

  it("defaults to sorting by Strength ascending", async () => {
    const now = new Date();
    const weaker = await remember({ content: "Weaker memory.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const weakerMemory = readMemory(storageRoot, "episodic", weaker.id)!;
    weakerMemory.frontmatter.createdAt = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    writeMemory(storageRoot, weakerMemory);
    const stronger = await remember({ content: "Stronger memory.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });

    const results = browseMemories({ storageRoot, now });

    expect(results.map((r) => r.id)).toEqual([weaker.id, stronger.id]);
  });

  it("never mutates any Memory it lists", async () => {
    const remembered = await remember({ content: "Should stay untouched.", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });
    const before = readMemory(storageRoot, "episodic", remembered.id)!;

    browseMemories({ storageRoot });
    browseMemories({ storageRoot });

    const after = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(after.frontmatter).toEqual(before.frontmatter);
  });
});
