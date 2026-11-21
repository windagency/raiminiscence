import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write-then-rename so a reader never observes a partially-written file —
 * shared by every derived, rebuildable on-disk artifact under
 * `.raiminiscence/cache/` (`recall-cache.ts`, `opportunistic-consolidation-state.ts`).
 */
export function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, path);
}
