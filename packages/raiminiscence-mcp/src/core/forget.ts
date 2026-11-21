import type { Scope, StorageLocation } from "./types.js";
import { mutateMemoryById } from "./storage.js";
import { resolveScope } from "./project-root.js";
import { updateCachedRecords } from "./recall-cache.js";
import { retractMemory } from "./confidence-tier-fsm.js";

export interface ForgetParams extends StorageLocation {
  id: string;
  reason?: string;
  scope?: Scope;
  now?: Date;
}

export interface ForgetResult {
  id: string;
  alreadyRetracted: boolean;
}

export function forget(params: ForgetParams): ForgetResult {
  const now = params.now ?? new Date();
  const { root: effectiveRoot } = resolveScope(params);
  const alreadyRetracted = mutateMemoryById(effectiveRoot, params.id, (memory) => {
    const { alreadyRetracted } = retractMemory(memory, now, params.reason ?? null);
    return alreadyRetracted;
  });

  if (!alreadyRetracted) {
    // v14 (ADR-0021): the cache only ever holds active Memories, so a
    // retraction removes it rather than patching it in place.
    updateCachedRecords(effectiveRoot, (current) => ({
      ...current,
      memories: current.memories.filter((memory) => memory.frontmatter.id !== params.id),
    }));
  }

  return { id: params.id, alreadyRetracted };
}
