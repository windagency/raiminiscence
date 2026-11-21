#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolveMergeDriverConflict } from "./merge-driver.js";

/**
 * The actual command git invokes as `merge.<name>.driver`, registered by
 * `ensureSharedMemoryWorktree` as `node <this file> %O %A %B`. Git expands
 * `%O`/`%A`/`%B` to three temp file paths (ancestor, current/ours, other/
 * theirs) in that order; the resolved content is written back over `%A`
 * (`currentPath`), which is what git reads back as the merge result. The
 * ancestor (`%O`) is unused — this driver's rule is a pairwise recency
 * comparison, not a three-way diff.
 */
function main(): void {
  const [, , , currentPath, otherPath] = process.argv;
  if (currentPath === undefined || otherPath === undefined) {
    throw new Error("usage: merge-driver-cli <ancestor> <current> <other>");
  }
  const currentContent = readFileSync(currentPath, "utf8");
  const otherContent = readFileSync(otherPath, "utf8");
  const content = resolveMergeDriverConflict({ currentContent, otherContent });
  writeFileSync(currentPath, content, "utf8");
}

main();
