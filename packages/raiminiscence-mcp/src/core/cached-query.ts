import { ALL_MEMORY_KINDS, type Memory, type MemoryKind, type Scope, type StorageLocation } from "./types.js";
import { resolveScope } from "./project-root.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { defaultProvider } from "./embeddings/default-provider.js";
import type { PackedEmbeddingIndex } from "./embeddings/packed-index.js";
import type { ConflictIndex } from "./conflict-edge.js";
import { getCachedEmbeddings, snapshotCachedRecords, type CacheSnapshot, type CachedRecords } from "./recall-cache.js";
import { scoreCandidatesForQuery, type ScoreCandidatesResult } from "./query-scoring.js";
import { awaitPendingEmbeds } from "./pending-embeds.js";

/** ADR-0034: three results cost a fraction of ten whole bodies (ADR-0033). */
const DEFAULT_K = 3;

/** The query inputs `recall` and Inspect's `inspectQuery` share. */
export interface CachedQueryParams extends StorageLocation {
  query: string;
  kind?: MemoryKind;
  scope?: Scope;
  k?: number;
  minScore?: number;
  embeddingProvider?: EmbeddingProvider;
  now?: Date;
}

export interface CachedQueryResult extends ScoreCandidatesResult {
  scope: Scope;
  effectiveRoot: string;
  now: Date;
  kinds: MemoryKind[];
  k: number;
  provider: EmbeddingProvider;
  usedFallback: boolean;
  index: PackedEmbeddingIndex;
  cachedMemories: Memory[];
  conflictIndex: ConflictIndex;
  /** ADR-0036: the records slot as read, with its version, for `recall` to append its writeback on top of. */
  recordsSnapshot: CacheSnapshot<CachedRecords>;
}

/**
 * Resolves a query's defaults, embeds it, and scores the v14 corpus cache
 * (ADR-0021) through `scoreCandidatesForQuery` (ADR-0022). Returns the cache
 * snapshots too, since `recall` patches them back after its own writes.
 */
export async function scoreQueryAgainstCache(params: CachedQueryParams): Promise<CachedQueryResult> {
  const now = params.now ?? new Date();
  const { scope, root: effectiveRoot } = resolveScope(params);
  const kinds: MemoryKind[] = params.kind ? [params.kind] : ALL_MEMORY_KINDS;
  const kindSet = new Set(kinds);

  const provider = params.embeddingProvider ?? defaultProvider();
  // ADR-0041: waits for vectors `remember` is still writing to this root, while the query embeds.
  const [queryVector] = await Promise.all([provider.embed(params.query, "query"), awaitPendingEmbeds(effectiveRoot)]);
  const index = getCachedEmbeddings(effectiveRoot);
  const recordsSnapshot = snapshotCachedRecords(effectiveRoot);
  const { memories: cachedMemories, conflicts: conflictIndex } = recordsSnapshot.data;

  const scoring = scoreCandidatesForQuery({
    query: params.query,
    queryVector,
    queryIdentity: provider.identity,
    pool: cachedMemories.filter((memory) => kindSet.has(memory.frontmatter.kind)),
    now,
    index,
    minScore: params.minScore ?? 0,
  });

  return {
    ...scoring,
    scope,
    effectiveRoot,
    now,
    kinds,
    k: params.k ?? DEFAULT_K,
    provider,
    usedFallback: queryVector === null,
    index,
    cachedMemories,
    conflictIndex,
    recordsSnapshot,
  };
}
