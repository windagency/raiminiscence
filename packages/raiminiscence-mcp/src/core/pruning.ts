import { ALL_MEMORY_KINDS, type Memory, type MemoryKind } from "./types.js";
import { readAllMemories } from "./storage.js";
import { computeStrength } from "./decay.js";

export const PRUNE_STRENGTH_THRESHOLD = 0.05;

export function eligibleForPruning(storageRoot: string, now: Date): { kind: MemoryKind; memory: Memory }[] {
  const eligible: { kind: MemoryKind; memory: Memory }[] = [];
  for (const kind of ALL_MEMORY_KINDS) {
    for (const memory of readAllMemories(storageRoot, [kind])) {
      if (computeStrength(memory.frontmatter, now) < PRUNE_STRENGTH_THRESHOLD) {
        eligible.push({ kind, memory });
      }
    }
  }
  return eligible;
}
