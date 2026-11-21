import { z } from "zod";

/** Validates the Ollama `/api/embed` response shape at the network boundary, per CONTRIBUTING.md's Zod non-negotiable. */
const ollamaEmbeddingResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())).min(1),
});

/**
 * Validates an on-disk embedding record's full shape at the read boundary.
 * `record-schema.ts`'s envelope only validates the one field the generic
 * record layer reads itself (`updatedAt`) — this is the index-specific
 * validation for `EmbeddingRecord`.
 *
 * `identity` is optional here, not required as the `EmbeddingRecord` type
 * claims: a real on-disk file written before v17 added the field
 * has no `identity` key at all. `readPackedIndex` normalises that absence to
 * `UNSPECIFIED_IDENTITY` after this schema confirms the rest of the record
 * is well-formed.
 */
const embeddingRecordSchema = z.object({
  vector: z.array(z.number()),
  identity: z.object({ provider: z.string(), model: z.string(), prompt: z.string().optional() }).optional(),
  updatedAt: z.string(),
});

export interface StoredEmbeddingRecord {
  vector: number[];
  identity?: { provider: string; model: string; prompt?: string };
  updatedAt: string;
}

/** The embedding vector from an Ollama response body, or `null` when the body isn't the expected shape. */
export function parseOllamaEmbedding(body: unknown): number[] | null {
  const parsed = ollamaEmbeddingResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.embeddings[0]! : null;
}

/** An on-disk embedding record, or `null` when it doesn't match the expected shape. */
export function parseEmbeddingRecord(record: unknown): StoredEmbeddingRecord | null {
  const parsed = embeddingRecordSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}
