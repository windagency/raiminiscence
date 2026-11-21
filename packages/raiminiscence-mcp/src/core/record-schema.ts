import { z } from "zod";

/**
 * The only field the generic per-record layer reads off a record itself
 * (`record-index.ts`'s CAS comparison, and the Shared Memory merge driver's
 * recency rule). The rest of a record's on-disk shape is caller-defined, one
 * `TRecord` per index (conflict, embedding); `.passthrough()`
 * keeps every other field opaque to this layer.
 */
const recordEnvelopeSchema = z.object({ updatedAt: z.string().optional() }).passthrough();

export type RecordEnvelope = { updatedAt?: string } & Record<string, unknown>;

/** The parsed record with every field kept, or `null` when it isn't a record-shaped object. */
export function parseRecordEnvelope(record: unknown): RecordEnvelope | null {
  const parsed = recordEnvelopeSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

/** A record's `updatedAt`, or `undefined` when the value isn't a record-shaped object or has none. */
export function recordUpdatedAt(record: unknown): string | undefined {
  return parseRecordEnvelope(record)?.updatedAt;
}
