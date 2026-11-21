import { readAllRecords, removeRecord, writeRecord } from "#src/core/record-index.js";
import { parseEmbeddingRecord } from "./embedding-schema.js";
import { UNSPECIFIED_IDENTITY, type EmbeddingProviderIdentity } from "./provider.js";

export interface EmbeddingRecord {
  vector: number[];
  identity: EmbeddingProviderIdentity;
  updatedAt: string;
}

/**
 * v17: carries each vector's recorded Provider/model identity
 * alongside it, so a caller can tell a genuinely comparable stored embedding
 * apart from one produced by a different provider/model before ever calling
 * `cosineSimilarity` on it.
 */
export type PackedEmbeddingIndex = Record<string, EmbeddingRecord>;

const INDEX_NAME = "embeddings";

/**
 * v11 (ADR-0017): backed by one small file per Memory id under
 * `embeddings/` rather than one shared blob.
 *
 * Normalises a missing `identity` to `UNSPECIFIED_IDENTITY` here, at the read
 * boundary — a real on-disk file written before v17 added the field
 * has no `identity` key at all, despite `EmbeddingRecord.identity` being typed
 * as required. This is the one place that knows the value came from untrusted
 * on-disk JSON rather than a freshly-constructed `EmbeddingRecord`, so every
 * caller of `identitiesCompatible` downstream can assume a well-formed
 * `EmbeddingProviderIdentity` without its own guard.
 */
export function readPackedIndex(storageRoot: string): PackedEmbeddingIndex {
  const raw = readAllRecords<unknown>(storageRoot, INDEX_NAME);
  return Object.fromEntries(
    Object.entries(raw).map(([id, record]) => {
      const parsed = parseEmbeddingRecord(record);
      if (!parsed) {
        throw new Error(`Embedding record "${id}" is corrupt and does not match the expected shape.`);
      }
      return [id, { ...parsed, identity: parsed.identity ?? UNSPECIFIED_IDENTITY }];
    }),
  );
}

/**
 * `identity` defaults to `UNSPECIFIED_IDENTITY` for the many pre-v17 tests
 * that insert a vector directly, bypassing `remember()` (which always passes
 * its provider's real identity) — never a real provider's own value.
 */
export function upsertVector(storageRoot: string, id: string, vector: number[], identity: EmbeddingProviderIdentity = UNSPECIFIED_IDENTITY): void {
  writeRecord<EmbeddingRecord>(storageRoot, INDEX_NAME, id, { vector, identity, updatedAt: new Date().toISOString() });
}

/** Keeps the index in sync when a Memory is removed (Forget/Pruning). */
export function removeVector(storageRoot: string, id: string): void {
  removeRecord(storageRoot, INDEX_NAME, id);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magnitudeA += x * x;
    magnitudeB += y * y;
  }
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}
