import { runGitSync } from "./adapters/git.js";

/**
 * Every git-tracked file's most-recent-commit timestamp (ISO string, keyed
 * by repo-root-relative path), computed once per `consolidate` pass rather
 * than once per eligible Memory. Injected into Invalidation so its core
 * logic stays pure/fixture-driven in tests, with this as the real,
 * git-backed default; each Memory's own `createdAt` cutoff is compared
 * against this shared map at the call site instead of asked of git
 * per-Memory.
 */
export type FileChangeTimestamps = (storageRoot: string) => Record<string, string>;

// git's own escape for a literal NUL byte in its output — passed to git as
// this four-character text, distinct from the real `\0` char git then
// emits into stdout, which is what the parser below actually checks for.
const MARKER_FORMAT_ESCAPE = "%x00";
const OUTPUT_MARKER = "\0";

/** Never throws: a non-repo or unreachable git binary simply yields no known changes. */
export const gitFileChangeTimestamps: FileChangeTimestamps = (storageRoot) => {
  try {
    const output = runGitSync(["log", `--format=${MARKER_FORMAT_ESCAPE}%cI`, "--name-only"], {
      cwd: storageRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const timestamps: Record<string, string> = {};
    let currentTimestamp: string | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith(OUTPUT_MARKER)) {
        currentTimestamp = line.slice(OUTPUT_MARKER.length).trim();
        continue;
      }
      const path = line.trim();
      if (!path || currentTimestamp === null) continue;
      // git log is newest-first, so the first time a path is seen already carries its most recent change.
      if (!(path in timestamps)) timestamps[path] = currentTimestamp;
    }
    return timestamps;
  } catch {
    // Fallback-expected, per this function's own doc comment: a non-repo or
    // unreachable git binary simply yields no known changes, never a throw.
    return {};
  }
};

/**
 * Every commit's timestamp (ISO string) and subject line, newest-first,
 * queried once per `consolidate` pass and shared across every eligible
 * Memory — mirrors `FileChangeTimestamps`'s own injection shape so Commit
 * Invalidation's core logic stays pure/fixture-driven in tests. Reads only
 * the commit timestamp and subject line, never a diff or message body.
 */
export type CommitSubjects = (storageRoot: string) => Array<{ timestamp: string; subject: string }>;

const SUBJECT_FIELD_DELIMITER = "\x01";

/** Never throws: a non-repo or unreachable git binary simply yields no known commits. */
export const gitCommitSubjects: CommitSubjects = (storageRoot) => {
  try {
    const output = runGitSync(["log", `--format=%cI${SUBJECT_FIELD_DELIMITER}%s`], {
      cwd: storageRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });

    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const delimiterIndex = line.indexOf(SUBJECT_FIELD_DELIMITER);
        return { timestamp: line.slice(0, delimiterIndex), subject: line.slice(delimiterIndex + SUBJECT_FIELD_DELIMITER.length) };
      });
  } catch {
    // Fallback-expected, per this function's own doc comment: a non-repo or
    // unreachable git binary simply yields no known commits, never a throw.
    return [];
  }
};
