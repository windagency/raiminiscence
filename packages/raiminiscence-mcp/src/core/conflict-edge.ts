import { readAllRecords, readRecord, removeRecordsReferencingId, writeRecord, writeRecordIfUnchanged } from "./record-index.js";
import { forEachPair, pairKey } from "./pair-key.js";
import type { ConflictVerdict, MemoryWriter } from "./types.js";

/** One Scope's verdicts, aggregated from its per-pair record files: unordered pair -> verdict. */
export type ConflictIndex = Record<string, ConflictVerdict>;

const INDEX_NAME = "conflict";

interface ConflictRecord {
  verdict: ConflictVerdict;
  updatedAt: string;
  writer?: MemoryWriter;
}

/**
 * v11 (ADR-0017): backed by one small file per pair under `conflict/`
 * rather than one shared blob, but still returns the same aggregated
 * pair -> verdict map every caller already expects.
 */
export function readConflictIndex(storageRoot: string): ConflictIndex {
  const records = readAllRecords<ConflictRecord>(storageRoot, INDEX_NAME);
  return Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.verdict]));
}

/** The recorded verdict for an unordered pair, or `undefined` if none has been recorded yet. */
export function conflictVerdict(index: ConflictIndex, a: string, b: string): ConflictVerdict | undefined {
  return index[pairKey(a, b)];
}

/**
 * Records the verdict for an unordered pair. A verdict is a judgment call
 * rather than an evidence-driven fact, so a later call always overwrites an
 * earlier one for the same pair (upsert, not append-only).
 *
 * v11 (ADR-0017): a Conflict Verdict write is worth
 * protecting against a same-instant local collision, since an agent's
 * explicit judgment must never be silently dropped. Optimistic
 * compare-and-swap against the record's `updatedAt`, with one retry against
 * freshly re-read state; if that retry also detects a change, the write
 * applies unconditionally rather than looping indefinitely — this is a
 * same-machine, same-instant race between two local processes, expected to
 * be extremely rare.
 */
export function upsertConflictVerdict(storageRoot: string, a: string, b: string, verdict: ConflictVerdict, writer?: MemoryWriter): void {
  const key = pairKey(a, b);
  const nextRecord = (): ConflictRecord => ({ verdict, updatedAt: new Date().toISOString(), ...(writer && { writer }) });

  const firstRead = readRecord<ConflictRecord>(storageRoot, INDEX_NAME, key);
  if (writeRecordIfUnchanged(storageRoot, INDEX_NAME, key, firstRead?.updatedAt, nextRecord())) return;

  const freshRead = readRecord<ConflictRecord>(storageRoot, INDEX_NAME, key);
  if (writeRecordIfUnchanged(storageRoot, INDEX_NAME, key, freshRead?.updatedAt, nextRecord())) return;

  // Raced twice in a row — apply unconditionally rather than retrying forever.
  writeRecord<ConflictRecord>(storageRoot, INDEX_NAME, key, nextRecord());
}

/** Keeps the index in sync when a Memory is physically deleted (Pruning). */
export function removeConflictEdgesForId(storageRoot: string, id: string): void {
  removeRecordsReferencingId(storageRoot, INDEX_NAME, id);
}

/** Records `b` under `a` and `a` under `b` in a symmetric id -> partner-ids map, e.g. `conflictsWith`/`conflictCandidateWith`. */
export function addSymmetricEntry(map: Map<string, string[]>, a: string, b: string): void {
  map.set(a, [...(map.get(a) ?? []), b]);
  map.set(b, [...(map.get(b) ?? []), a]);
}

/**
 * Whether `a`/`b` carry a confirmed `"contradicts"` verdict — the guard
 * Clustering (seed-to-candidate) applies before joining a pair.
 */
export function isContradicting(index: ConflictIndex, a: string, b: string): boolean {
  return conflictVerdict(index, a, b) === "contradicts";
}

/** Every unordered pair within `ids` recorded as `"contradicts"`, both directions. */
export function conflictsAmong(index: ConflictIndex, ids: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  forEachPair(ids, (a, b) => {
    if (isContradicting(index, a, b)) {
      addSymmetricEntry(result, a, b);
    }
  });
  return result;
}
