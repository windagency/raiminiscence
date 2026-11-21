import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consolidate } from "#src/core/consolidate.js";
import { remember } from "#src/core/engine.js";
import { deleteMemory, readMemory, writeMemory } from "#src/core/storage.js";
import { readPackedIndex, upsertVector } from "#src/core/embeddings/packed-index.js";
import { upsertConflictVerdict } from "#src/core/conflict-edge.js";
import { ensureSharedMemoryWorktree, SHARED_MEMORY_BRANCH } from "#src/core/shared-memory/setup.js";
import { readOpportunisticConsolidationState, writeOpportunisticConsolidationState } from "#src/core/opportunistic-consolidation-state.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

describe("consolidate: Clustering + Promotion", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-consolidate-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("promotes a cluster of cosine-similar episodic memories into one semantic memory", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const c = await remember({
      content: "Unrelated observation about CSS.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });

    // Simulate embeddings that would have come from a live provider.
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);
    upsertVector(storageRoot, c.id, [0, 1]);

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(1);
    expect(result.memoriesPromoted).toBe(1);
    expect(result.newSemanticIds).toHaveLength(1);
    expect(result.contributorsBumped).toBe(2);

    const promoted = readMemory(storageRoot, "semantic", result.newSemanticIds[0]!);
    expect(promoted?.frontmatter.confidence).toBe("inferred");
    expect(promoted?.frontmatter.promotedFrom?.sort()).toEqual([a.id, b.id].sort());

    const survivorA = readMemory(storageRoot, "episodic", a.id);
    const survivorB = readMemory(storageRoot, "episodic", b.id);
    expect(survivorA?.frontmatter.consolidationSurvivalCount).toBe(1);
    expect(survivorB?.frontmatter.consolidationSurvivalCount).toBe(1);
  });

  it("v13 (ADR-0020): a Checkpoint, even cosine-similar to episodic memories, is never a Clustering seed or candidate", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const checkpoint = await remember({
      content: "Checkpoint: still working on retry backoff.",
      kind: "checkpoint",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, checkpoint.id, [0.99, 0.01]);

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(0);
    expect(result.memoriesPromoted).toBe(0);
    expect(result.newSemanticIds).toEqual([]);

    const checkpointAfter = readMemory(storageRoot, "checkpoint", checkpoint.id);
    expect(checkpointAfter?.frontmatter.consolidationSurvivalCount).toBe(0);
  });

  it("does not re-promote the same cluster on a subsequent run", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    expect(first.memoriesPromoted).toBe(1);

    const second = await consolidate({ storageRoot });

    expect(second.clustersFound).toBe(0);
    expect(second.memoriesPromoted).toBe(0);
    expect(second.newSemanticIds).toEqual([]);
  });

  it("prunes a memory whose Strength has decayed below 0.05 and drops its index entry", async () => {
    const remembered = await remember({
      content: "A memory old enough to prune.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, remembered.id, [1, 0]);

    const memory = readMemory(storageRoot, "episodic", remembered.id)!;
    // 200 days ago is far enough past the 7-day base half-life + grace period to decay under 0.05.
    memory.frontmatter.createdAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    writeMemory(storageRoot, memory);

    const result = await consolidate({ storageRoot });

    expect(result.memoriesPruned).toBe(1);
    expect(readMemory(storageRoot, "episodic", remembered.id)).toBeNull();
  });

  it("dryRun reports counts without mutating storage", async () => {
    const a = await remember({
      content: "Observation A about flaky tests.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about flaky tests.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const result = await consolidate({ storageRoot, dryRun: true });

    expect(result.clustersFound).toBe(1);
    expect(result.memoriesPromoted).toBe(1);
    expect(result.newSemanticIds).toEqual([]);

    // Nothing was actually written: no new semantic memory, no survival bump.
    expect(readMemory(storageRoot, "episodic", a.id)?.frontmatter.consolidationSurvivalCount).toBe(0);
  });

  it("nothing eligible returns the all-zero shape, not an error", async () => {
    const result = await consolidate({ storageRoot });

    expect(result).toEqual({
      clustersFound: 0,
      memoriesPromoted: 0,
      memoriesPruned: 0,
      contributorsBumped: 0,
      newSemanticIds: [],
      memoriesInvalidated: 0,
      blockedJoinAttempts: 0,
      feedbackExcludedCount: 0,
      promotionAuditConflictCount: 0,
      promotionAuditFeedbackCount: 0,
      memoriesCommitInvalidated: 0,
      memoriesReembedded: 0,
    });
  });

  it("v6: a confirmed contradicts verdict blocks a cosine-similar candidate from joining the seed's Cluster", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);
    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(0);
    expect(result.memoriesPromoted).toBe(0);
    expect(result.newSemanticIds).toEqual([]);
    expect(result.blockedJoinAttempts).toBe(1);

    const survivorA = readMemory(storageRoot, "episodic", a.id);
    const survivorB = readMemory(storageRoot, "episodic", b.id);
    expect(survivorA?.frontmatter.consolidationSurvivalCount).toBe(0);
    expect(survivorB?.frontmatter.consolidationSurvivalCount).toBe(0);
  });

  it("v6: a supersedes/no-conflict/unrecorded pair clusters exactly as before the gate existed", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);
    upsertConflictVerdict(storageRoot, a.id, b.id, "supersedes");

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(1);
    expect(result.memoriesPromoted).toBe(1);
    expect(result.blockedJoinAttempts).toBe(0);
    expect(readMemory(storageRoot, "semantic", result.newSemanticIds[0]!)?.frontmatter.promotedFrom?.sort()).toEqual([a.id, b.id].sort());
  });

  it("v6: a blocked pairing doesn't stop an unrelated third Memory from still forming its own Cluster in the same pass", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const c = await remember({
      content: "Observation C about CSS grid layout.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const d = await remember({
      content: "Observation D about CSS grid layout.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);
    upsertVector(storageRoot, c.id, [0, 1]);
    upsertVector(storageRoot, d.id, [0.01, 0.99]);
    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(1);
    expect(result.blockedJoinAttempts).toBe(1);
    expect(readMemory(storageRoot, "semantic", result.newSemanticIds[0]!)?.frontmatter.promotedFrom?.sort()).toEqual([c.id, d.id].sort());
    expect(readMemory(storageRoot, "episodic", a.id)).not.toBeNull();
    expect(readMemory(storageRoot, "episodic", b.id)).not.toBeNull();
  });

  it("v6: a Semantic Memory promoted before a contradicts verdict existed for its contributors is left unchanged by a later run", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    expect(first.memoriesPromoted).toBe(1);
    const semanticId = first.newSemanticIds[0]!;

    // The verdict is only recorded after that Consolidation run already promoted them together.
    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const second = await consolidate({ storageRoot });

    expect(second.clustersFound).toBe(0);
    expect(second.blockedJoinAttempts).toBe(0);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.promotedFrom?.sort()).toEqual([a.id, b.id].sort());
  });

  it("scope: both sums independent per-scope results without cross-scope clustering", async () => {
    const globalStorageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-consolidate-global-"));
    try {
      const p1 = await remember({
        content: "Project observation one about deploys.",
        client: "claude-code",
        storageRoot,
        embeddingProvider: unreachableProvider,
      });
      const p2 = await remember({
        content: "Project observation two about deploys.",
        client: "claude-code",
        storageRoot,
        embeddingProvider: unreachableProvider,
      });
      upsertVector(storageRoot, p1.id, [1, 0]);
      upsertVector(storageRoot, p2.id, [0.99, 0.01]);

      const g1 = await remember({
        content: "Global observation one about naming.",
        client: "claude-code",
        scope: "global",
        storageRoot,
        globalStorageRoot,
        embeddingProvider: unreachableProvider,
      });
      const g2 = await remember({
        content: "Global observation two about naming.",
        client: "claude-code",
        scope: "global",
        storageRoot,
        globalStorageRoot,
        embeddingProvider: unreachableProvider,
      });
      upsertVector(globalStorageRoot, g1.id, [0, 1]);
      upsertVector(globalStorageRoot, g2.id, [0.01, 0.99]);

      const result = await consolidate({ scope: "both", storageRoot, globalStorageRoot });

      expect(result.clustersFound).toBe(2);
      expect(result.memoriesPromoted).toBe(2);
      expect(result.newSemanticIds).toHaveLength(2);
    } finally {
      rmSync(globalStorageRoot, { recursive: true, force: true });
    }
  });

  it("v7: a net-negative Memory that would otherwise seed or join a Cluster does neither, and feedbackExcludedCount reflects it", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 2;
    memoryA.frontmatter.positiveFeedbackCount = 1;
    writeMemory(storageRoot, memoryA);

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(0);
    expect(result.memoriesPromoted).toBe(0);
    expect(result.newSemanticIds).toEqual([]);
    expect(result.feedbackExcludedCount).toBe(1);

    const survivorA = readMemory(storageRoot, "episodic", a.id);
    const survivorB = readMemory(storageRoot, "episodic", b.id);
    expect(survivorA?.frontmatter.consolidationSurvivalCount).toBe(0);
    expect(survivorB?.frontmatter.consolidationSurvivalCount).toBe(0);
  });

  it("v7: an unrelated, non-negative pair in the same pass still clusters and promotes normally", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const c = await remember({
      content: "Observation C about CSS grid layout.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const d = await remember({
      content: "Observation D about CSS grid layout.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);
    upsertVector(storageRoot, c.id, [0, 1]);
    upsertVector(storageRoot, d.id, [0.01, 0.99]);

    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 3;
    memoryA.frontmatter.positiveFeedbackCount = 0;
    writeMemory(storageRoot, memoryA);

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(1);
    expect(result.feedbackExcludedCount).toBe(1);
    expect(readMemory(storageRoot, "semantic", result.newSemanticIds[0]!)?.frontmatter.promotedFrom?.sort()).toEqual([c.id, d.id].sort());
    expect(readMemory(storageRoot, "episodic", a.id)).not.toBeNull();
    expect(readMemory(storageRoot, "episodic", b.id)).not.toBeNull();
  });

  it("v7: negative feedback that does not exceed positive feedback clusters exactly as before", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 2;
    memoryA.frontmatter.positiveFeedbackCount = 2;
    writeMemory(storageRoot, memoryA);

    const result = await consolidate({ storageRoot });

    expect(result.clustersFound).toBe(1);
    expect(result.memoriesPromoted).toBe(1);
    expect(result.feedbackExcludedCount).toBe(0);
    expect(readMemory(storageRoot, "semantic", result.newSemanticIds[0]!)?.frontmatter.promotedFrom?.sort()).toEqual([a.id, b.id].sort());
  });

  it("v7: a Semantic Memory promoted before its contributor turned net-negative is left unchanged by a later run", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    expect(first.memoriesPromoted).toBe(1);
    const semanticId = first.newSemanticIds[0]!;

    // Contributor turns net-negative only after that Consolidation run already promoted it.
    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 5;
    memoryA.frontmatter.positiveFeedbackCount = 0;
    writeMemory(storageRoot, memoryA);

    const second = await consolidate({ storageRoot });

    expect(second.clustersFound).toBe(0);
    expect(second.feedbackExcludedCount).toBe(0);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.promotedFrom?.sort()).toEqual([a.id, b.id].sort());
  });

  it("v7: a net-negative Memory and a separate contradicts-verdict pair in the same pass each count only their own mechanism", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const c = await remember({
      content: "Observation C about CSS grid layout.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const d = await remember({
      content: "Observation D about CSS grid layout.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);
    upsertVector(storageRoot, c.id, [0, 1]);
    upsertVector(storageRoot, d.id, [0.01, 0.99]);
    upsertConflictVerdict(storageRoot, c.id, d.id, "contradicts");

    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 2;
    memoryA.frontmatter.positiveFeedbackCount = 0;
    writeMemory(storageRoot, memoryA);

    const result = await consolidate({ storageRoot });

    expect(result.feedbackExcludedCount).toBe(1);
    expect(result.blockedJoinAttempts).toBe(1);
    expect(result.clustersFound).toBe(0);
    expect(readMemory(storageRoot, "episodic", a.id)).not.toBeNull();
    expect(readMemory(storageRoot, "episodic", b.id)).not.toBeNull();
  });

  it("v8: a contradicts verdict recorded after promotion stales the Semantic Memory and is reflected in promotionAuditConflictCount", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("inferred");

    // The verdict is only recorded after that Consolidation run already promoted them together.
    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditConflictCount).toBe(1);
    expect(second.promotionAuditFeedbackCount).toBe(0);
    const staled = readMemory(storageRoot, "semantic", semanticId);
    expect(staled?.frontmatter.confidence).toBe("stale");
    expect(staled?.frontmatter.staleAt).not.toBeNull();
    expect(staled?.frontmatter.staleReason).toContain("Promotion Audit");
  });

  it("v8: a contributor turning net-negative after promotion stales the Semantic Memory and is reflected in promotionAuditFeedbackCount", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    // Contributor turns net-negative only after that Consolidation run already promoted it.
    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 5;
    memoryA.frontmatter.positiveFeedbackCount = 0;
    writeMemory(storageRoot, memoryA);

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditFeedbackCount).toBe(1);
    expect(second.promotionAuditConflictCount).toBe(0);
    const staled = readMemory(storageRoot, "semantic", semanticId);
    expect(staled?.frontmatter.confidence).toBe("stale");
    expect(staled?.frontmatter.staleReason).toContain("Promotion Audit");
  });

  it("v8: an all-pairs check catches a contradicts verdict between two non-seed contributors that live Clustering's seed-only gate would have missed", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const c = await remember({
      content: "Observation C about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.999, 0.001]);
    upsertVector(storageRoot, c.id, [0.998, 0.002]);

    const first = await consolidate({ storageRoot });
    expect(first.newSemanticIds).toHaveLength(1);
    const semanticId = first.newSemanticIds[0]!;
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.promotedFrom?.sort()).toEqual([a.id, b.id, c.id].sort());

    // b and c are both non-seed contributors relative to a — live Clustering's
    // seed-to-candidate check never compares them to each other.
    upsertConflictVerdict(storageRoot, b.id, c.id, "contradicts");

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditConflictCount).toBe(1);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("stale");
  });

  it("v8: a Semantic Memory with conflict-free, non-negative contributors is left untouched across multiple runs", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    const second = await consolidate({ storageRoot });
    const third = await consolidate({ storageRoot });

    expect(second.promotionAuditConflictCount).toBe(0);
    expect(second.promotionAuditFeedbackCount).toBe(0);
    expect(third.promotionAuditConflictCount).toBe(0);
    expect(third.promotionAuditFeedbackCount).toBe(0);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("inferred");
  });

  it("v8: a Semantic Memory already stale from Invalidation is not reprocessed by Promotion Audit", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    const staleAt = new Date("2020-01-01T00:00:00.000Z").toISOString();
    const staleReason = "Pre-existing staleness, not from Promotion Audit.";
    const semantic = readMemory(storageRoot, "semantic", semanticId)!;
    semantic.frontmatter.confidence = "stale";
    semantic.frontmatter.staleAt = staleAt;
    semantic.frontmatter.staleReason = staleReason;
    writeMemory(storageRoot, semantic);

    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditConflictCount).toBe(0);
    const stillStale = readMemory(storageRoot, "semantic", semanticId);
    expect(stillStale?.frontmatter.staleAt).toBe(staleAt);
    expect(stillStale?.frontmatter.staleReason).toBe(staleReason);
  });

  it("v8: a promotedFrom id that no longer resolves to any Memory is skipped without error, and remaining contributors are still checked", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    // Simulate a's earlier physical removal by Pruning, leaving a dangling promotedFrom id.
    deleteMemory(storageRoot, "episodic", a.id);

    const memoryB = readMemory(storageRoot, "episodic", b.id)!;
    memoryB.frontmatter.negativeFeedbackCount = 5;
    memoryB.frontmatter.positiveFeedbackCount = 0;
    writeMemory(storageRoot, memoryB);

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditFeedbackCount).toBe(1);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("stale");
  });

  it("v8: a Semantic Memory hit by both signals in the same run is counted in both fields but transitions to stale once", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");
    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.negativeFeedbackCount = 5;
    memoryA.frontmatter.positiveFeedbackCount = 0;
    writeMemory(storageRoot, memoryA);

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditConflictCount).toBe(1);
    expect(second.promotionAuditFeedbackCount).toBe(1);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("stale");
  });

  it("v8: dryRun reports both promotion audit counts without writing any frontmatter changes", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const dryRunResult = await consolidate({ storageRoot, dryRun: true });

    expect(dryRunResult.promotionAuditConflictCount).toBe(1);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("inferred");
  });

  it("v8: a contributor eligible for Pruning in the same pass is still checked by Promotion Audit before it's removed", async () => {
    const a = await remember({
      content: "Observation A about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "Observation B about retry backoff.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    upsertVector(storageRoot, a.id, [1, 0]);
    upsertVector(storageRoot, b.id, [0.99, 0.01]);

    const first = await consolidate({ storageRoot });
    const semanticId = first.newSemanticIds[0]!;

    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    // Decay one contributor far enough that it's eligible for Pruning in the same pass.
    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.createdAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    writeMemory(storageRoot, memoryA);

    const second = await consolidate({ storageRoot });

    expect(second.promotionAuditConflictCount).toBe(1);
    expect(second.memoriesPruned).toBe(1);
    expect(readMemory(storageRoot, "semantic", semanticId)?.frontmatter.confidence).toBe("stale");
    expect(readMemory(storageRoot, "episodic", a.id)).toBeNull();
  });

  it("v17: Re-embedding heals a Memory whose stored identity doesn't match the current default provider, ahead of Clustering", async () => {
    const content = "Observation about retry backoff, embedded under the old provider.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0], { provider: "old", model: "old-model" });

    const newProvider: EmbeddingProvider = {
      identity: { provider: "new", model: "new-model" },
      async embed(text: string) {
        return text === content ? [0, 1] : null;
      },
    };

    const result = await consolidate({ storageRoot, embeddingProvider: newProvider });

    expect(result.memoriesReembedded).toBe(1);
    const healed = readPackedIndex(storageRoot)[a.id]!;
    expect(healed.vector).toEqual([0, 1]);
    expect(healed.identity).toEqual({ provider: "new", model: "new-model" });
  });

  it("v17: dryRun reports the would-be re-embedded count without recomputing anything", async () => {
    const content = "Observation about retry backoff, embedded under the old provider.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0], { provider: "old", model: "old-model" });

    const newProvider: EmbeddingProvider = {
      identity: { provider: "new", model: "new-model" },
      async embed(text: string) {
        return text === content ? [0, 1] : null;
      },
    };

    const result = await consolidate({ storageRoot, dryRun: true, embeddingProvider: newProvider });

    expect(result.memoriesReembedded).toBe(1);
    const untouched = readPackedIndex(storageRoot)[a.id]!;
    expect(untouched.vector).toEqual([1, 0]);
    expect(untouched.identity).toEqual({ provider: "old", model: "old-model" });
  });

  describe("v19 (ADR-0025): Opportunistic Consolidation debounce reset", () => {
    it("a real pass resets the debounce state, regardless of what pre-existing state (or lack of it) it found", async () => {
      writeOpportunisticConsolidationState(storageRoot, { lastPassAt: "2020-01-01T00:00:00.000Z", callsSinceLastPass: 15 });

      const now = new Date("2026-01-01T00:00:00.000Z");
      await consolidate({ storageRoot, now, embeddingProvider: unreachableProvider });

      expect(readOpportunisticConsolidationState(storageRoot)).toEqual({ lastPassAt: now.toISOString(), callsSinceLastPass: 0 });
    });

    it("a real pass creates the debounce state from scratch when this storage root never had a prior pass", async () => {
      expect(readOpportunisticConsolidationState(storageRoot)).toBeUndefined();

      const now = new Date("2026-01-01T00:00:00.000Z");
      await consolidate({ storageRoot, now, embeddingProvider: unreachableProvider });

      expect(readOpportunisticConsolidationState(storageRoot)).toEqual({ lastPassAt: now.toISOString(), callsSinceLastPass: 0 });
    });

    it("a dryRun pass never touches the debounce state", async () => {
      writeOpportunisticConsolidationState(storageRoot, { lastPassAt: "2020-01-01T00:00:00.000Z", callsSinceLastPass: 15 });

      await consolidate({ storageRoot, dryRun: true, now: new Date("2026-01-01T00:00:00.000Z"), embeddingProvider: unreachableProvider });

      expect(readOpportunisticConsolidationState(storageRoot)).toEqual({ lastPassAt: "2020-01-01T00:00:00.000Z", callsSinceLastPass: 15 });
    });
  });

  describe("v19 (ADR-0025): awaitPush threads through consolidate() into the Shared Memory flush", () => {
    function git(cwd: string, args: string[]): string {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    }

    it("consolidate({ awaitPush: true }) doesn't resolve until the Shared Memory push has actually reached the remote", async () => {
      const remoteDir = mkdtempSync(join(tmpdir(), "raiminiscence-consolidate-remote-"));
      try {
        git(remoteDir, ["init", "--bare", "-q"]);
        git(storageRoot, ["clone", remoteDir, "."]);
        git(storageRoot, ["config", "user.name", "Test Writer"]);
        git(storageRoot, ["config", "user.email", "writer@example.com"]);

        ensureSharedMemoryWorktree(storageRoot);

        await consolidate({ storageRoot, awaitPush: true, embeddingProvider: unreachableProvider });

        const worktreeDir = join(storageRoot, ".raiminiscence", "memory");
        const localHead = git(worktreeDir, ["rev-parse", "HEAD"]).trim();
        const remoteHead = git(remoteDir, ["rev-parse", SHARED_MEMORY_BRANCH]).trim();
        expect(remoteHead).toBe(localHead);
      } finally {
        rmSync(remoteDir, { recursive: true, force: true });
      }
    });
  });
});
