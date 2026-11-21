import type { ConflictVerdict, Scope, StorageLocation } from "./types.js";
import { assertMemoryExists } from "./storage.js";
import { OperationalError } from "./errors.js";
import { resolveScope } from "./project-root.js";
import { pairKey } from "./pair-key.js";
import { upsertConflictVerdict } from "./conflict-edge.js";
import { forget } from "./forget.js";
import { defaultWriterIdentityProvider, type WriterIdentityProvider } from "./writer-identity.js";
import { updateCachedRecords } from "./recall-cache.js";

export interface ConflictParams extends StorageLocation {
  memoryId: string;
  otherMemoryId: string;
  verdict: ConflictVerdict;
  /** Required, and must name one of `memoryId`/`otherMemoryId`, iff `verdict === "supersedes"`. */
  retractedId?: string;
  scope?: Scope;
  now?: Date;
  /** Injectable for testing; defaults to the real per-process git-identity + sessionId provider. */
  writerIdentityProvider?: WriterIdentityProvider;
}

export interface ConflictResult {
  memoryId: string;
  otherMemoryId: string;
  verdict: ConflictVerdict;
  alreadyRetracted?: boolean;
}

/**
 * Records an agent's verdict on a pair of Memories — flagged by `recall` as
 * a Conflict Candidate, or simply named directly — reporting whether they
 * `"contradicts"` (both stand, now flagged to each other), `"supersedes"`
 * (the named `retractedId` is retracted via Forget's exact transition, no
 * parallel implementation), or `"no-conflict"` (dismissed). Upsertable: a
 * later call for the same pair overwrites its previously recorded verdict.
 */
export function conflict(params: ConflictParams): ConflictResult {
  const { root: effectiveRoot } = resolveScope(params);

  assertMemoryExists(effectiveRoot, params.memoryId);
  assertMemoryExists(effectiveRoot, params.otherMemoryId);

  if (params.verdict === "supersedes" && params.retractedId !== params.memoryId && params.retractedId !== params.otherMemoryId) {
    throw new OperationalError(
      `"supersedes" requires retractedId to name one of memoryId ("${params.memoryId}") or otherMemoryId ("${params.otherMemoryId}"), got "${params.retractedId}"`,
    );
  }

  const writer = (params.writerIdentityProvider ?? defaultWriterIdentityProvider)();
  upsertConflictVerdict(effectiveRoot, params.memoryId, params.otherMemoryId, params.verdict, writer);

  // v14 (ADR-0021); a "supersedes" verdict's cascade into `forget` below
  // handles removing the retracted side of the pair from the cache itself.
  updateCachedRecords(effectiveRoot, (current) => ({
    ...current,
    conflicts: { ...current.conflicts, [pairKey(params.memoryId, params.otherMemoryId)]: params.verdict },
  }));

  let alreadyRetracted: boolean | undefined;
  if (params.verdict === "supersedes") {
    alreadyRetracted = forget({
      id: params.retractedId!,
      scope: params.scope,
      now: params.now,
      storageRoot: params.storageRoot,
      globalStorageRoot: params.globalStorageRoot,
    }).alreadyRetracted;
  }

  return { memoryId: params.memoryId, otherMemoryId: params.otherMemoryId, verdict: params.verdict, alreadyRetracted };
}
