import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conflict, remember } from "#src/core/engine.js";
import { consolidate } from "#src/core/consolidate.js";
import { conflictVerdict, readConflictIndex, removeConflictEdgesForId, upsertConflictVerdict } from "#src/core/conflict-edge.js";
import * as recordIndex from "#src/core/record-index.js";
import { pairKey } from "#src/core/pair-key.js";
import { upsertVector } from "#src/core/embeddings/packed-index.js";
import { readMemory, writeMemory } from "#src/core/storage.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

describe("Conflict Edge storage", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-conflict-edge-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("records a verdict, readable symmetrically regardless of argument order", () => {
    upsertConflictVerdict(storageRoot, "a", "b", "contradicts");

    const index = readConflictIndex(storageRoot);
    expect(conflictVerdict(index, "a", "b")).toBe("contradicts");
    expect(conflictVerdict(index, "b", "a")).toBe("contradicts");
  });

  it("returns undefined for a pair with no recorded verdict", () => {
    const index = readConflictIndex(storageRoot);
    expect(conflictVerdict(index, "a", "b")).toBeUndefined();
  });

  it("upserts: a later call overwrites an earlier verdict for the same pair", () => {
    upsertConflictVerdict(storageRoot, "a", "b", "no-conflict");
    upsertConflictVerdict(storageRoot, "b", "a", "contradicts");

    const index = readConflictIndex(storageRoot);
    expect(conflictVerdict(index, "a", "b")).toBe("contradicts");
  });

  it("removeConflictEdgesForId removes every edge referencing the given id and leaves others untouched", () => {
    upsertConflictVerdict(storageRoot, "a", "b", "contradicts");
    upsertConflictVerdict(storageRoot, "b", "c", "no-conflict");
    upsertConflictVerdict(storageRoot, "c", "d", "supersedes");

    removeConflictEdgesForId(storageRoot, "b");

    const index = readConflictIndex(storageRoot);
    expect(conflictVerdict(index, "a", "b")).toBeUndefined();
    expect(conflictVerdict(index, "b", "c")).toBeUndefined();
    expect(conflictVerdict(index, "c", "d")).toBe("supersedes");
  });

  it("Pruning removes Conflict Edges referencing a deleted id and leaves other edges untouched", async () => {
    const a = await remember({ content: "prunable observation alpha.", client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    const b = await remember({ content: "prunable observation beta.", client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    const c = await remember({ content: "prunable observation gamma.", client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0, 0]);
    upsertVector(storageRoot, b.id, [1, 0, 0]);
    upsertVector(storageRoot, c.id, [0, 1, 0]);

    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");
    upsertConflictVerdict(storageRoot, b.id, c.id, "no-conflict");

    // Force `a` to prune-eligible strength without touching the others.
    const memoryA = readMemory(storageRoot, "episodic", a.id)!;
    memoryA.frontmatter.createdAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    memoryA.frontmatter.lastRecalledAt = null;
    writeMemory(storageRoot, memoryA);

    await consolidate({ storageRoot });

    const after = readConflictIndex(storageRoot);
    expect(conflictVerdict(after, a.id, b.id)).toBeUndefined();
    expect(conflictVerdict(after, b.id, c.id)).toBe("no-conflict");
  });

  it("a same-instant collision retries against fresh state rather than silently dropping either writer's verdict", () => {
    upsertConflictVerdict(storageRoot, "a", "b", "no-conflict");
    const staleSnapshot = recordIndex.readRecord(storageRoot, "conflict", pairKey("a", "b"));

    // A concurrent writer commits a fresher verdict for the same pair.
    upsertConflictVerdict(storageRoot, "a", "b", "contradicts");

    // Simulate a second writer whose own read happened before that commit landed.
    const readSpy = vi.spyOn(recordIndex, "readRecord").mockReturnValueOnce(staleSnapshot);
    upsertConflictVerdict(storageRoot, "a", "b", "supersedes");
    readSpy.mockRestore();

    const index = readConflictIndex(storageRoot);
    expect(conflictVerdict(index, "a", "b")).toBe("supersedes");
  });

  it("records a writer identity on the verdict, and still succeeds with no git identity available", () => {
    upsertConflictVerdict(storageRoot, "a", "b", "contradicts", { sessionId: "no-git-identity-session" });

    const record = recordIndex.readRecord<{ writer?: { sessionId: string } }>(storageRoot, "conflict", pairKey("a", "b"));
    expect(record?.writer).toEqual({ sessionId: "no-git-identity-session" });
  });

  it("conflict() attaches a writer identity to the recorded verdict", async () => {
    const a = await remember({
      content: "conflict writer identity alpha.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });
    const b = await remember({
      content: "conflict writer identity beta.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });

    conflict({
      memoryId: a.id,
      otherMemoryId: b.id,
      verdict: "contradicts",
      storageRoot,
      writerIdentityProvider: () => ({ sessionId: "conflict-tool-session" }),
    });

    const record = recordIndex.readRecord<{ writer?: { sessionId: string } }>(storageRoot, "conflict", pairKey(a.id, b.id));
    expect(record?.writer).toEqual({ sessionId: "conflict-tool-session" });
  });
});
