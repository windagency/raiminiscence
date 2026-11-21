import { recordUpdatedAt } from "#src/core/record-schema.js";

export interface MergeDriverInput {
  /** %A: the current branch's version of the file (already on disk at the target path). */
  currentContent: string;
  /** %B: the other branch's version of the file being merged in. */
  otherContent: string;
}

function parseUpdatedAt(raw: string): string | undefined {
  try {
    return recordUpdatedAt(JSON.parse(raw));
  } catch {
    // Not JSON at all (e.g. a Memory's Markdown file): no recency to compare.
    return undefined;
  }
}

/**
 * v11 (ADR-0017): the recency-keyed merge driver's actual resolution logic,
 * kept as a pure function so it's directly readable/testable in isolation —
 * `merge-driver-cli.ts` is the thin file-I/O wrapper git actually invokes.
 * Given both conflicting sides of a record file, parses each side's
 * `updatedAt` (ISO timestamps compare correctly as plain strings) and keeps
 * whichever is later, discarding the other entirely — never a field-level
 * union merge, never raw conflict markers. Falls back to keeping
 * `currentContent` (ours) unchanged when either side doesn't parse as JSON
 * or lacks `updatedAt` (e.g. a Memory file, which has no such field) —
 * still a real conflict `git merge`'s own "Auto-merging" output reports to
 * the caller (see `pullSharedMemory`), just resolved by a simpler rule than
 * recency since this record type doesn't support one.
 */
export function resolveMergeDriverConflict(input: MergeDriverInput): string {
  if (input.currentContent === input.otherContent) return input.currentContent;

  const currentUpdatedAt = parseUpdatedAt(input.currentContent);
  const otherUpdatedAt = parseUpdatedAt(input.otherContent);
  if (currentUpdatedAt === undefined || otherUpdatedAt === undefined) {
    return input.currentContent;
  }

  return otherUpdatedAt > currentUpdatedAt ? input.otherContent : input.currentContent;
}
