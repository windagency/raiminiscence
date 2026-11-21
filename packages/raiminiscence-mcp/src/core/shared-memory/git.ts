import { runGitAsyncRaw, runGitSync } from "#src/core/adapters/git.js";

/**
 * v11 (ADR-0017): the git plumbing seam every Shared Memory operation runs
 * through — mirrors `git.ts`'s `FileChangeTimestamps`/`CommitSubjects`
 * injection pattern so setup/sync stay stubbable in tests. Unlike those,
 * this is allowed to throw: sharing genuinely cannot work without git, so
 * the caller (`ensureSharedMemoryWorktree`) surfaces a clear error instead
 * of silently falling back to an empty result.
 */
export type RunGit = (cwd: string, args: string[]) => string;

export const runGit: RunGit = (cwd, args) => runGitSync(args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

/**
 * v19 (ADR-0025): async counterpart to `runGit`, used only for the one
 * Shared Memory operation that must never block the Node.js event loop —
 * `flushSharedMemory`'s final `push`. `add`/`commit` stay on `runGit`
 * (`execFileSync`) untouched; only `push` needed to move off the
 * synchronous path.
 */
export type RunGitAsync = (cwd: string, args: string[]) => Promise<string>;

export const runGitAsync: RunGitAsync = (cwd, args) => runGitAsyncRaw(cwd, args);

/** Shared by `sync.ts`'s flush and `setup.ts`'s `commitIfChanged`: `git diff --cached --quiet` exits non-zero iff the index has staged changes. */
export function hasStagedChanges(worktreeDir: string, git: RunGit): boolean {
  try {
    git(worktreeDir, ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}
