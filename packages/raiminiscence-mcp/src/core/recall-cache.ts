import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { ALL_MEMORY_KINDS, type Memory } from "./types.js";
import { readAllMemories } from "./storage.js";
import { isActive } from "./memory-view.js";
import { readPackedIndex, type PackedEmbeddingIndex } from "./embeddings/packed-index.js";
import { readConflictIndex, type ConflictIndex } from "./conflict-edge.js";
import { parseCacheLogEntry, parseCacheSlotFile, parseVersionMarker } from "./cache-state-schema.js";

/**
 * v14 (ADR-0021): a derived, rebuildable performance cache for `recall`'s
 * and `consolidate`'s corpus-wide reads — never a source of truth, never
 * synced via Shared Memory. Lives at `.raiminiscence/cache/`, a sibling to
 * `.raiminiscence/memory/` rather than inside it, so Shared Memory's
 * `git add -A` (scoped to the `memory/` worktree) can never pick it up.
 *
 * Split into two independently-versioned slots — records (memories,
 * conflicts) and embeddings — because `recall`'s own writeback (Spaced
 * Repetition's `lastRecalledAt`/`recallCount` bump) touches records on
 * every call but never embeddings; a
 * single combined blob would force rewriting the far larger embedding
 * vectors on every recall for no reason.
 */
export interface CachedRecords {
  memories: Memory[];
  conflicts: ConflictIndex;
}

export interface VersionMarker {
  recordsVersion: number;
  embeddingsVersion: number;
}

const NO_VERSION: VersionMarker = { recordsVersion: 0, embeddingsVersion: 0 };

function cacheDir(storageRoot: string): string {
  return join(storageRoot, ".raiminiscence", "cache");
}

function versionFilePath(storageRoot: string): string {
  return join(cacheDir(storageRoot), "version.json");
}

/** The text's JSON, or `undefined` when it isn't JSON. The cache is rebuildable, so that case is silent. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The file's JSON, or `undefined` when it's missing or not JSON. */
function readJson(path: string): unknown {
  return existsSync(path) ? parseJson(readFileSync(path, "utf8")) : undefined;
}

function readVersionMarker(storageRoot: string): VersionMarker {
  return parseVersionMarker(readJson(versionFilePath(storageRoot))) ?? NO_VERSION;
}

function writeVersionMarker(storageRoot: string, marker: VersionMarker): void {
  writeAtomic(versionFilePath(storageRoot), JSON.stringify(marker));
}

/**
 * Strictly increasing even when two writes land in the same millisecond
 * (common: a write immediately followed by an invalidate, or records and
 * embeddings written back to back) — plain `Date.now()` can't guarantee
 * that, and a version collision would make stale on-disk data look fresh.
 * Roughly wall-clock-ordered across processes (Shared Memory) still, just
 * not strictly monotonic there — an accepted, self-correcting rarity
 * consistent with this codebase's other cross-process races.
 */
let lastIssuedVersion = 0;
function nextVersion(): number {
  lastIssuedVersion = Math.max(Date.now(), lastIssuedVersion + 1);
  return lastIssuedVersion;
}

export interface CacheSlotFile<T> {
  version: number;
  data: T;
}

/** ADR-0036: one line of a slot's append-only log: `op` takes the slot from version `prev` to `version`. */
export interface CacheLogEntry<Op> {
  version: number;
  prev: number;
  op: Op;
}

/** A slot's value together with the version it was read or written at, the starting point for `append`. */
export interface CacheSnapshot<T> {
  version: number;
  data: T;
}

/**
 * One independently-versioned cache slot: a base file holding `{ version, data }`,
 * an append-only log of `{ version, prev, op }` lines next to it (ADR-0036), and
 * a per-process in-memory copy, all checked against the shared `version.json`
 * marker before being trusted. A version of `0` means "no cache has ever been
 * written" and always forces a rebuild.
 *
 * Correctness under Shared Memory's multiple simultaneous writers comes
 * entirely from this version check, not from tracking every writer's call
 * sites: a sibling process's write eventually bumps the marker (directly, or
 * indirectly via `invalidate`), and the next read here notices the mismatch
 * and replays the log toward it, or rebuilds when the log's chain can't
 * reach it — regardless of which process made the change.
 */
function makeCacheSlot<T, Op extends object>(
  fileName: string,
  versionKey: keyof VersionMarker,
  build: (storageRoot: string) => T,
  apply: (current: T, op: Op) => T,
) {
  const inMemory = new Map<string, CacheSnapshot<T>>();
  const filePath = (storageRoot: string) => join(cacheDir(storageRoot), fileName);
  const logPath = (storageRoot: string) => join(cacheDir(storageRoot), fileName.replace(/\.json$/, ".log.jsonl"));
  const sizeOf = (path: string) => (existsSync(path) ? statSync(path).size : 0);

  /** Rewrites the base and empties the log: a full write, and the log's compaction. */
  function write(storageRoot: string, data: T): T {
    const version = nextVersion();
    writeAtomic(filePath(storageRoot), JSON.stringify({ version, data } satisfies CacheSlotFile<T>));
    writeAtomic(logPath(storageRoot), "");
    writeVersionMarker(storageRoot, { ...readVersionMarker(storageRoot), [versionKey]: version });
    inMemory.set(storageRoot, { version, data });
    return data;
  }

  /** Follows the log's chain from `base` to `wantedVersion`, or `undefined` when the chain can't reach it. */
  function replay(storageRoot: string, base: CacheSnapshot<T>, wantedVersion: number): T | undefined {
    if (base.version === wantedVersion) return base.data;
    if (!existsSync(logPath(storageRoot))) return undefined;
    let { version, data } = base;
    for (const line of readFileSync(logPath(storageRoot), "utf8").split("\n")) {
      const entry = parseCacheLogEntry(parseJson(line));
      if (!entry) break; // only the last line can be torn or empty
      if (entry.prev !== version) continue;
      // Envelope-checked only, like a slot file's `data`; this slot wrote the op.
      data = apply(data, entry.op as Op);
      version = entry.version;
      if (version === wantedVersion) return data;
    }
    return undefined;
  }

  function read(storageRoot: string): T {
    return snapshot(storageRoot).data;
  }

  function snapshot(storageRoot: string): CacheSnapshot<T> {
    const wantedVersion = readVersionMarker(storageRoot)[versionKey];
    const memoized = inMemory.get(storageRoot);
    if (wantedVersion !== 0 && memoized?.version === wantedVersion) return memoized;

    if (wantedVersion !== 0) {
      const onDisk = parseCacheSlotFile(readJson(filePath(storageRoot)));
      // Envelope-checked only; see cache-state-schema.ts for why `data` isn't re-validated.
      const data = onDisk && replay(storageRoot, { version: onDisk.version, data: onDisk.data as T }, wantedVersion);
      if (data !== undefined) {
        const replayed = { version: wantedVersion, data };
        inMemory.set(storageRoot, replayed);
        return replayed;
      }
    }

    const data = write(storageRoot, build(storageRoot));
    return inMemory.get(storageRoot) ?? { version: 0, data };
  }

  /**
   * ADR-0036: records `op` on top of `from` as one log line instead of
   * rewriting the slot, so a write costs the size of its change. `from` is
   * a snapshot taken before the caller's own underlying write, whose
   * safety-net invalidation this entry's version supersedes. Once the log
   * would outgrow the base, the write compacts instead.
   */
  function append(storageRoot: string, from: CacheSnapshot<T>, op: Op): T {
    const data = apply(from.data, op);
    const version = nextVersion();
    const line = `${JSON.stringify({ version, prev: from.version, op } satisfies CacheLogEntry<Op>)}\n`;
    if (sizeOf(logPath(storageRoot)) + Buffer.byteLength(line) > sizeOf(filePath(storageRoot))) return write(storageRoot, data);
    appendFileSync(logPath(storageRoot), line, "utf8");
    writeVersionMarker(storageRoot, { ...readVersionMarker(storageRoot), [versionKey]: version });
    inMemory.set(storageRoot, { version, data });
    return data;
  }

  /** Reads (rebuilding if stale/missing), applies `patch`, and writes the result — one write, not one per mutated record. */
  function update(storageRoot: string, patch: (current: T) => T): void {
    write(storageRoot, patch(read(storageRoot)));
  }

  /** Cheap: bumps the version marker only. The next `read` notices the mismatch and does a full rebuild. */
  function invalidate(storageRoot: string): void {
    inMemory.delete(storageRoot);
    writeVersionMarker(storageRoot, { ...readVersionMarker(storageRoot), [versionKey]: nextVersion() });
  }

  return { read, snapshot, write, append, update, invalidate };
}

/** ADR-0036: a records change small enough to log: Memories added or replaced. */
export interface RecordsOp {
  upsertMemories?: Memory[];
}

/** ADR-0036: an embeddings change small enough to log: records added or replaced. */
export interface EmbeddingsOp {
  upsert: PackedEmbeddingIndex;
}

function applyRecordsOp(current: CachedRecords, op: RecordsOp): CachedRecords {
  const upserts = new Map((op.upsertMemories ?? []).map((memory) => [memory.frontmatter.id, memory]));
  const memories = current.memories.map((memory) => {
    const replacement = upserts.get(memory.frontmatter.id);
    upserts.delete(memory.frontmatter.id);
    return replacement ?? memory;
  });
  memories.push(...upserts.values());
  return { memories, conflicts: current.conflicts };
}

function applyEmbeddingsOp(current: PackedEmbeddingIndex, op: EmbeddingsOp): PackedEmbeddingIndex {
  return { ...current, ...op.upsert };
}

function buildFreshRecords(storageRoot: string): CachedRecords {
  return {
    memories: readAllMemories(storageRoot, ALL_MEMORY_KINDS).filter(isActive),
    conflicts: readConflictIndex(storageRoot),
  };
}

const recordsSlot = makeCacheSlot<CachedRecords, RecordsOp>("records.json", "recordsVersion", buildFreshRecords, applyRecordsOp);
const embeddingsSlot = makeCacheSlot<PackedEmbeddingIndex, EmbeddingsOp>("embeddings.json", "embeddingsVersion", readPackedIndex, applyEmbeddingsOp);

export const getCachedRecords = recordsSlot.read;
/**
 * Read-patch-write in one step. Safe for a *replace/remove* patch (feedback,
 * forget, conflict) because the lower-level write it's layered on top of
 * (`writeMemory`/`writeRecord`, see their own doc comments) already bumped
 * the version marker as a safety net — so `read()` here rebuilds fresh from
 * disk, which already reflects that same write, and re-applying an
 * idempotent replace/remove on top changes nothing. NOT safe for an
 * *additive* patch (append/increment): see `writeCachedRecords`.
 */
export const updateCachedRecords = recordsSlot.update;
/**
 * Writes a fully-formed value directly — no read. Required (instead of
 * `updateCachedRecords`) for an additive patch computed from a snapshot
 * fetched *before* the underlying write happened: `remember`/`recall` fetch
 * their snapshot first, perform the real write (which bumps the version
 * marker as a safety net), then write their own precisely-patched snapshot
 * here. Reading again after the write, and appending/incrementing on top,
 * would double the change — the rebuild that read would trigger already
 * includes it.
 */
export const writeCachedRecords = recordsSlot.write;
export const invalidateCachedRecords = recordsSlot.invalidate;
/** The records slot with its version: what `remember`/`recall` take before their own writes, to `append` on top of. */
export const snapshotCachedRecords = recordsSlot.snapshot;
/** ADR-0036: `writeCachedRecords` as one log line; the same before-the-write rule applies, through the snapshot. */
export const appendCachedRecords = recordsSlot.append;

export const getCachedEmbeddings = embeddingsSlot.read;
export const writeCachedEmbeddings = embeddingsSlot.write;
export const snapshotCachedEmbeddings = embeddingsSlot.snapshot;
export const appendCachedEmbeddings = embeddingsSlot.append;
export const invalidateCachedEmbeddings = embeddingsSlot.invalidate;

/**
 * `consolidate`'s end-of-pass refresh: one full rescan, written once,
 * regardless of how many memories the pass touched (promotions, prunes,
 * stales) — never called per-mutation. A no-op-equivalent cost-wise to the
 * cold-start rebuild `read()` already does, just triggered explicitly so the
 * cache is warm again immediately rather than lazily on the next read.
 */
export function rebuildCache(storageRoot: string): void {
  recordsSlot.write(storageRoot, buildFreshRecords(storageRoot));
  embeddingsSlot.write(storageRoot, readPackedIndex(storageRoot));
}

/**
 * For changes this process didn't make itself (a Shared Memory pull) —
 * cheap invalidation only, since there's no way to know precisely what
 * changed. The next reader (in any process) rebuilds from scratch.
 *
 * `storage.ts` (`writeMemory`/`deleteMemory`) and `record-index.ts`
 * (`writeRecord`/`removeRecord`/`writeRecordIfUnchanged`) call the two
 * slot-specific invalidators below directly, as an automatic safety net
 * beneath every writer — including ones this module was never taught about,
 * like a test that pokes storage directly. `remember`/`recall` layer a
 * precise patch on top of that safety net (see `writeCachedRecords`);
 * `forget`/`feedback`/`conflict` just let the safety net's rebuild do the
 * work and apply an idempotent patch on top (see `updateCachedRecords`).
 */
export function invalidateCache(storageRoot: string): void {
  recordsSlot.invalidate(storageRoot);
  embeddingsSlot.invalidate(storageRoot);
}
