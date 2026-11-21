import type { Scope, StorageLocation } from "./types.js";
import { mutateMemoryById } from "./storage.js";
import { resolveScope } from "./project-root.js";
import { updateCachedRecords } from "./recall-cache.js";

export interface FeedbackParams extends StorageLocation {
  id: string;
  wasHelpful: boolean;
  scope?: Scope;
}

export interface FeedbackResult {
  id: string;
  wasHelpful: boolean;
}

/**
 * Outcome Feedback: reinforces (or fades) a Memory's effective Half-life
 * based on whether it actually proved useful, never touching Confidence
 * Tier. Accepted regardless of current tier (including stale/retracted) —
 * a real tool error is reserved for a genuinely nonexistent id.
 */
export function feedback(params: FeedbackParams): FeedbackResult {
  const { root: effectiveRoot } = resolveScope(params);
  const memory = mutateMemoryById(effectiveRoot, params.id, (memory) => {
    if (params.wasHelpful) {
      memory.frontmatter.positiveFeedbackCount += 1;
    } else {
      memory.frontmatter.negativeFeedbackCount += 1;
    }
    return memory;
  });

  // v14 (ADR-0021): reuses the already-mutated Memory object directly — a
  // no-op if it's not in the cache (e.g. stale/retracted, which feedback
  // accepts but the cache never holds), correctly leaving nothing to patch.
  updateCachedRecords(effectiveRoot, (current) => ({
    ...current,
    memories: current.memories.map((m) => (m.frontmatter.id === params.id ? memory : m)),
  }));

  return { id: params.id, wasHelpful: params.wasHelpful };
}
