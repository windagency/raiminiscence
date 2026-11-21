import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryStoreDir } from "#src/core/storage.js";

/**
 * Simulates a genuine pre-v17 on-disk embedding file (no `identity` key at
 * all), bypassing `upsertVector`'s default-parameter shortcut so a test
 * exercises the real read-boundary normalisation, not the write path.
 */
export function writeLegacyEmbeddingMissingIdentity(storageRoot: string, id: string, vector: number[]): void {
  const dir = join(memoryStoreDir(storageRoot), "embeddings");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ vector, updatedAt: new Date().toISOString() }), "utf8");
}
