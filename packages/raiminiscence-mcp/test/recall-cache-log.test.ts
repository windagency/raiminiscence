import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recall, remember } from "#src/core/engine.js";
import { readAllMemories } from "#src/core/storage.js";
import { rebuildCache } from "#src/core/recall-cache.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

const stubProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed(text: string) {
    return [text.length % 7, 1];
  },
};

const NO_CONSOLIDATION = { triggerConsolidation: false } as const;

/** A fresh copy of the cache module, with none of this process's in-memory state: what another process would see. */
async function freshCacheModule(): Promise<typeof import("#src/core/recall-cache.js")> {
  vi.resetModules();
  return import("#src/core/recall-cache.js");
}

describe("recall cache base snapshot plus append-only log (ADR-0036)", () => {
  let storageRoot: string;
  let cacheDir: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-cache-log-"));
    cacheDir = join(storageRoot, ".raiminiscence", "cache");
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  async function rememberNotes(from: number, count: number): Promise<void> {
    for (let i = from; i < from + count; i++) {
      await remember({
        content: `Retry note ${i}: the payment client retries timeouts`,
        client: "claude-code",
        storageRoot,
        embeddingProvider: stubProvider,
        ...NO_CONSOLIDATION,
      });
    }
  }

  const lines = (name: string) => (existsSync(join(cacheDir, name)) ? readFileSync(join(cacheDir, name), "utf8").split("\n").filter(Boolean) : []);

  it("appends a remember to each log and leaves both base snapshots untouched", async () => {
    await rememberNotes(0, 20);
    rebuildCache(storageRoot);
    const recordsBase = readFileSync(join(cacheDir, "records.json"), "utf8");
    const embeddingsBase = readFileSync(join(cacheDir, "embeddings.json"), "utf8");

    await rememberNotes(20, 3);

    expect(readFileSync(join(cacheDir, "records.json"), "utf8")).toBe(recordsBase);
    expect(readFileSync(join(cacheDir, "embeddings.json"), "utf8")).toBe(embeddingsBase);
    expect(lines("records.log.jsonl")).toHaveLength(3);
    expect(lines("embeddings.log.jsonl")).toHaveLength(3);
  });

  it("lets another process replay base plus log to the state on disk, without a rebuild", async () => {
    await rememberNotes(0, 20);
    rebuildCache(storageRoot);
    await rememberNotes(20, 2);
    await recall({ query: "payment client retries", k: 3, storageRoot, embeddingProvider: stubProvider, ...NO_CONSOLIDATION });
    const logBefore = lines("records.log.jsonl");

    const fresh = await freshCacheModule();
    const records = fresh.getCachedRecords(storageRoot);

    expect(records.memories.map((m) => m.frontmatter.id).sort()).toEqual(
      readAllMemories(storageRoot)
        .map((m) => m.frontmatter.id)
        .sort(),
    );
    expect(Object.keys(fresh.getCachedEmbeddings(storageRoot))).toHaveLength(22);
    expect(lines("records.log.jsonl")).toEqual(logBefore);
  });

  it("compacts so neither log stays larger than its base", async () => {
    await rememberNotes(0, 12);

    for (const slot of ["records", "embeddings"]) {
      expect(statSync(join(cacheDir, `${slot}.log.jsonl`)).size).toBeLessThanOrEqual(statSync(join(cacheDir, `${slot}.json`)).size);
    }
    const fresh = await freshCacheModule();
    expect(fresh.getCachedRecords(storageRoot).memories).toHaveLength(12);
  });

  it("rebuilds from the memory files when the log's chain cannot reach the marker", async () => {
    await rememberNotes(0, 20);
    rebuildCache(storageRoot);
    await rememberNotes(20, 2);
    appendFileSync(join(cacheDir, "records.log.jsonl"), '{"version": 1, "prev": 0, "op": {"upse');
    const marker = JSON.parse(readFileSync(join(cacheDir, "version.json"), "utf8"));
    writeFileSync(join(cacheDir, "version.json"), JSON.stringify({ ...marker, recordsVersion: marker.recordsVersion + 1 }));

    const fresh = await freshCacheModule();

    expect(fresh.getCachedRecords(storageRoot).memories).toHaveLength(22);
  });
});
