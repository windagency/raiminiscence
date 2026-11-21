import type { Memory } from "./types.js";
import { readAllMemories } from "./storage.js";
import { isActive } from "./memory-view.js";
import type { FileChangeTimestamps } from "./git.js";

/**
 * Invalidation candidates: any active (non-stale, non-retracted) Memory
 * whose `relatedFiles` includes at least one file touched by a git commit
 * since the Memory's `createdAt`. A Memory with no `relatedFiles` is never
 * a candidate. `fileChangeTimestamps` is queried once for the whole pass,
 * not once per Memory — each Memory's own `createdAt` cutoff is applied
 * here, against that one shared map.
 */
export function eligibleForInvalidation(
  storageRoot: string,
  fileChangeTimestamps: FileChangeTimestamps,
): { memory: Memory; triggeringFiles: string[] }[] {
  const changedAt = fileChangeTimestamps(storageRoot);
  const eligible: { memory: Memory; triggeringFiles: string[] }[] = [];
  for (const memory of readAllMemories(storageRoot)) {
    if (!isActive(memory)) continue;
    const relatedFiles = memory.frontmatter.relatedFiles;
    if (!relatedFiles || relatedFiles.length === 0) continue;

    const createdAt = new Date(memory.frontmatter.createdAt);
    const triggeringFiles = relatedFiles.filter((file) => {
      const changedTimestamp = changedAt[file];
      return changedTimestamp !== undefined && new Date(changedTimestamp) > createdAt;
    });
    if (triggeringFiles.length > 0) eligible.push({ memory, triggeringFiles });
  }
  return eligible;
}
