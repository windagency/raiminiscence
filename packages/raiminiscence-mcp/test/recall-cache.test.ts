import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { remember } from "#src/core/engine.js";
import { memoryStoreDir, writeMemory } from "#src/core/storage.js";
import { upsertVector } from "#src/core/embeddings/packed-index.js";
import { createFrontmatter } from "#src/core/create-frontmatter.js";
import {
  getCachedEmbeddings,
  getCachedRecords,
  invalidateCache,
  invalidateCachedEmbeddings,
  invalidateCachedRecords,
  writeCachedEmbeddings,
  writeCachedRecords,
} from "#src/core/recall-cache.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

const STUB_IDENTITY = { provider: "stub", model: "stub" };

function stubProvider(vector: number[] | null = [1, 0]): EmbeddingProvider {
  return {
    identity: STUB_IDENTITY,
    async embed() {
      return vector;
    },
  };
}

describe("recallCache (ADR-0021)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-recall-cache-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("cold start (no cache on disk) builds from the actual memory/index files", async () => {
    const remembered = await remember({ content: "A note.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });

    const records = getCachedRecords(storageRoot);
    expect(records.memories.map((m) => m.frontmatter.id)).toEqual([remembered.id]);
    expect(getCachedEmbeddings(storageRoot)[remembered.id]).toEqual({ vector: [1, 0], identity: STUB_IDENTITY, updatedAt: expect.any(String) });
  });

  it.each([
    ["a slot whose data isn't an object", { recordsVersion: 999_999, embeddingsVersion: 0 }, { version: 999_999, data: null }],
    ["a version marker and slot of the wrong types", { recordsVersion: "999999", embeddingsVersion: 0 }, { version: "999999", data: null }],
  ])("rebuilds from the memory files instead of trusting %s", async (_label, marker, slot) => {
    const remembered = await remember({ content: "A note.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    const cacheDir = join(storageRoot, ".raiminiscence", "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "version.json"), JSON.stringify(marker));
    writeFileSync(join(cacheDir, "records.json"), JSON.stringify(slot));

    expect(getCachedRecords(storageRoot).memories.map((m) => m.frontmatter.id)).toEqual([remembered.id]);
  });

  it("lives at .raiminiscence/cache, never inside .raiminiscence/memory", async () => {
    await remember({ content: "A note.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    getCachedRecords(storageRoot);
    getCachedEmbeddings(storageRoot);

    const cacheDir = join(storageRoot, ".raiminiscence", "cache");
    expect(existsSync(cacheDir)).toBe(true);
    expect(readdirSync(cacheDir).sort()).toEqual(["embeddings.json", "embeddings.log.jsonl", "records.json", "records.log.jsonl", "version.json"]);

    const memoryDir = memoryStoreDir(storageRoot);
    const namesUnderMemory = existsSync(memoryDir) ? readdirSync(memoryDir) : [];
    expect(namesUnderMemory).not.toContain("cache");
  });

  it("a low-level write bypassing remember() still invalidates the cache (the safety net)", async () => {
    const remembered = await remember({ content: "First.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    expect(getCachedRecords(storageRoot).memories).toHaveLength(1);

    // Directly poking storage.ts, the way many existing tests seed fixtures —
    // never goes through remember()'s own explicit cache patch.
    const secondFrontmatter = createFrontmatter({
      kind: "episodic",
      confidence: "observed",
      createdAt: new Date().toISOString(),
      source: { client: "claude-code" },
      scope: "project",
      originatingProject: null,
      relatedFiles: null,
    });
    writeMemory(storageRoot, { frontmatter: secondFrontmatter, body: "Second, written directly." });
    upsertVector(storageRoot, secondFrontmatter.id, [0, 1]);

    const records = getCachedRecords(storageRoot);
    expect(records.memories.map((m) => m.frontmatter.id).sort()).toEqual([remembered.id, secondFrontmatter.id].sort());
    expect(getCachedEmbeddings(storageRoot)[secondFrontmatter.id]!.vector).toEqual([0, 1]);
  });

  it("writeCachedRecords is trusted on the next read without an unnecessary rebuild", async () => {
    await remember({ content: "On disk.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    const base = getCachedRecords(storageRoot);

    // A value that deliberately doesn't match what's on disk, so a correct
    // "trust the version, don't rebuild" read can only return this.
    writeCachedRecords(storageRoot, { ...base, memories: [...base.memories, { frontmatter: base.memories[0]!.frontmatter, body: "synthetic" }] });

    expect(getCachedRecords(storageRoot).memories).toHaveLength(2);
  });

  it("invalidateCachedRecords forces the next read to rebuild from actual disk state", async () => {
    await remember({ content: "On disk.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    const base = getCachedRecords(storageRoot);
    writeCachedRecords(storageRoot, { ...base, memories: [...base.memories, { frontmatter: base.memories[0]!.frontmatter, body: "synthetic" }] });
    expect(getCachedRecords(storageRoot).memories).toHaveLength(2);

    invalidateCachedRecords(storageRoot);

    expect(getCachedRecords(storageRoot).memories).toHaveLength(1);
  });

  it("records and embeddings are independently versioned: invalidating one leaves the other's cached (even synthetic) value trusted", async () => {
    await remember({ content: "On disk.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    const recordsBase = getCachedRecords(storageRoot);
    writeCachedRecords(storageRoot, {
      ...recordsBase,
      memories: [...recordsBase.memories, { frontmatter: recordsBase.memories[0]!.frontmatter, body: "synthetic" }],
    });
    writeCachedEmbeddings(storageRoot, { synthetic: { vector: [9, 9], identity: STUB_IDENTITY, updatedAt: new Date().toISOString() } });

    invalidateCachedEmbeddings(storageRoot);

    expect(getCachedRecords(storageRoot).memories).toHaveLength(2); // records: untouched, still the synthetic value
    expect(getCachedEmbeddings(storageRoot)).not.toHaveProperty("synthetic"); // embeddings: rebuilt from disk
  });

  it("invalidateCache (both slots) forces a full rebuild of records and embeddings", async () => {
    const remembered = await remember({ content: "On disk.", client: "claude-code", storageRoot, embeddingProvider: stubProvider() });
    writeCachedRecords(storageRoot, { memories: [], conflicts: {} });
    writeCachedEmbeddings(storageRoot, {});

    invalidateCache(storageRoot);

    expect(getCachedRecords(storageRoot).memories.map((m) => m.frontmatter.id)).toEqual([remembered.id]);
    expect(getCachedEmbeddings(storageRoot)[remembered.id]).toEqual({ vector: [1, 0], identity: STUB_IDENTITY, updatedAt: expect.any(String) });
  });
});
