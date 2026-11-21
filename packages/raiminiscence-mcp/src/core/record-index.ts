import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecordEnvelope } from "./record-schema.js";
import { memoryStoreDir } from "./storage.js";
import { invalidateCachedEmbeddings, invalidateCachedRecords } from "./recall-cache.js";

const RECORD_EXTENSION = ".json";
// Pair keys (`pair-key.ts`'s `pairKey`) join two ids with "|", which
// isn't a safe filename character on every platform — this round-trips
// losslessly since ULIDs never contain "_".
const KEY_SEPARATOR_ESCAPE = "__";

function recordsDir(storageRoot: string, indexName: string): string {
  return join(memoryStoreDir(storageRoot), indexName);
}

function recordFileName(key: string): string {
  return `${key.replaceAll("|", KEY_SEPARATOR_ESCAPE)}${RECORD_EXTENSION}`;
}

function recordFilePath(storageRoot: string, indexName: string, key: string): string {
  return join(recordsDir(storageRoot, indexName), recordFileName(key));
}

/**
 * v14 (ADR-0021): every record write funnels through this file regardless of
 * which index (embeddings, conflict) it's for, making it the
 * lowest common point to bump the corpus cache's version marker — an
 * automatic safety net beneath the whole record-index layer, independent of
 * whether the caller knows the cache exists. See `recall-cache.ts`'s
 * `invalidateCache` doc comment.
 */
function invalidateCacheForIndex(storageRoot: string, indexName: string): void {
  if (indexName === "embeddings") {
    invalidateCachedEmbeddings(storageRoot);
  } else {
    invalidateCachedRecords(storageRoot);
  }
}

/**
 * One small JSON file per record — the layout every v11 index (Conflict
 * Edge, embedding) shares instead of the single blob per
 * index type used through v10, so concurrent writers to *different* records
 * never collide and the store stays git-mergeable. A missing record file is
 * a normal "not written yet" state; a corrupt one (invalid JSON, or valid
 * JSON that isn't even a record-shaped object) is never expected, so it's
 * surfaced as an error rather than silently discarded.
 */
export function readRecord<TRecord>(storageRoot: string, indexName: string, key: string): TRecord | undefined {
  const path = recordFilePath(storageRoot, indexName, key);
  if (!existsSync(path)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Record at "${path}" is corrupt and could not be parsed as JSON.`);
  }

  const record = parseRecordEnvelope(parsed);
  if (!record) {
    throw new Error(`Record at "${path}" is corrupt and does not match the expected record shape.`);
  }
  return record as TRecord;
}

export function writeRecord<TRecord>(storageRoot: string, indexName: string, key: string, record: TRecord): void {
  const dir = recordsDir(storageRoot, indexName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(recordFilePath(storageRoot, indexName, key), JSON.stringify(record), "utf8");
  invalidateCacheForIndex(storageRoot, indexName);
}

export function removeRecord(storageRoot: string, indexName: string, key: string): void {
  const path = recordFilePath(storageRoot, indexName, key);
  if (existsSync(path)) {
    rmSync(path);
    invalidateCacheForIndex(storageRoot, indexName);
  }
}

/** Every key currently on disk for `indexName`, decoded back to its original (unescaped) form. */
export function recordKeys(storageRoot: string, indexName: string): string[] {
  const dir = recordsDir(storageRoot, indexName);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(RECORD_EXTENSION))
    .map((name) => name.slice(0, -RECORD_EXTENSION.length).replaceAll(KEY_SEPARATOR_ESCAPE, "|"));
}

/**
 * Removes every pair-keyed record (Conflict Edge) whose key references
 * `id` — `removeConflictEdgesForId` keeps that index in sync when a Memory
 * is physically deleted (Pruning).
 */
export function removeRecordsReferencingId(storageRoot: string, indexName: string, id: string): void {
  for (const key of recordKeys(storageRoot, indexName)) {
    if (key.split("|").includes(id)) removeRecord(storageRoot, indexName, key);
  }
}

/** Reads every record in `indexName` back into the shared in-memory map shape the rest of the codebase already expects. */
export function readAllRecords<TRecord>(storageRoot: string, indexName: string): Record<string, TRecord> {
  const result: Record<string, TRecord> = {};
  for (const key of recordKeys(storageRoot, indexName)) {
    const record = readRecord<TRecord>(storageRoot, indexName, key);
    if (record !== undefined) result[key] = record;
  }
  return result;
}

/**
 * Reads one record (`undefined` if absent), hands it to `mutator`, and
 * persists whatever it returns — returning `undefined` deletes the record.
 * Unprotected read-modify-write, scoped to a single small file rather than
 * the one shared blob per index type used through v10.
 */
export function withRecord<TRecord>(
  storageRoot: string,
  indexName: string,
  key: string,
  mutator: (current: TRecord | undefined) => TRecord | undefined,
): void {
  const next = mutator(readRecord<TRecord>(storageRoot, indexName, key));
  if (next === undefined) {
    removeRecord(storageRoot, indexName, key);
  } else {
    writeRecord(storageRoot, indexName, key, next);
  }
}

/**
 * Optimistic compare-and-swap write: writes `next` only if the record's
 * on-disk `updatedAt` still matches `expectedUpdatedAt` (or the record is
 * still absent, when `expectedUpdatedAt` is `undefined`). Returns whether
 * the write applied — `false` means someone else wrote to this record since
 * it was read, and the caller should re-read and retry.
 */
export function writeRecordIfUnchanged<TRecord extends { updatedAt: string }>(
  storageRoot: string,
  indexName: string,
  key: string,
  expectedUpdatedAt: string | undefined,
  next: TRecord,
): boolean {
  const dir = recordsDir(storageRoot, indexName);
  mkdirSync(dir, { recursive: true });
  const path = recordFilePath(storageRoot, indexName, key);
  const current = readRecord<{ updatedAt?: string }>(storageRoot, indexName, key);
  if (current?.updatedAt !== expectedUpdatedAt) return false;

  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tempPath, JSON.stringify(next), "utf8");
  renameSync(tempPath, path);
  invalidateCacheForIndex(storageRoot, indexName);
  return true;
}
