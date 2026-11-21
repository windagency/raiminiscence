import { memoryStoreDir } from "#src/core/storage.js";
import { isSharedMemoryWorktree, SHARED_MEMORY_BRANCH } from "./setup.js";
import { hasStagedChanges, runGit, runGitAsync, type RunGit, type RunGitAsync } from "./git.js";
import { invalidateCache } from "#src/core/recall-cache.js";
import type { ServerLogger } from "#src/adapters/logger.js";

const FLUSH_COMMIT_MESSAGE = "chore: sync memory";

export interface FlushSharedMemoryOptions {
  /**
   * v19 (ADR-0025): default `false` — the final `push` runs fire-and-forget
   * and the returned promise resolves without waiting on it, so a slow or
   * unreachable remote can never block the caller. Set `true` only where a
   * caller must guarantee the push has actually settled before proceeding
   * (the `SessionEnd` hook) — every other caller keeps the non-blocking
   * default.
   */
  awaitPush?: boolean;
  /**
   * Optional because `core/` itself has no logger dependency — threaded in
   * from `server.ts` via `consolidate()`'s own params, mirroring
   * `readOpportunisticConsolidationState`'s convention. When absent (e.g. a
   * caller that predates this option, or a test), a swallowed push failure
   * stays exactly as silent as before.
   */
  logger?: ServerLogger;
}

/** Injectable git dependencies, grouped since they always travel together. */
export interface FlushSharedMemoryDeps {
  git?: RunGit;
  gitAsync?: RunGitAsync;
}

/**
 * v19 (ADR-0025): tracks only the most recently kicked-off push (a single
 * slot, not a queue) — mirrors `opportunistic-consolidation.ts`'s own
 * `pendingOpportunisticConsolidation` pattern. Lets a caller that must not
 * race a *prior*, not-yet-settled push (`SessionEnd`, via
 * `settlePendingSharedMemoryPush`) wait for it before running its own
 * `add`/`commit`/`push` against the same worktree — regardless of whether
 * that prior push's own caller awaited it (most don't, by design).
 */
let pendingPush: Promise<void> | undefined;

/**
 * Always attempted, even when nothing new was just staged/committed —
 * setup's own commits (`.gitattributes`, an initial seed) still need
 * pushing the first time this runs, and a push with nothing new to send is
 * a harmless no-op. Never throws: no remote configured, or unreachable, is
 * swallowed identically to before — Shared Memory still works locally
 * either way.
 */
async function pushWithFallback(worktreeDir: string, gitAsync: RunGitAsync, logger?: ServerLogger): Promise<void> {
  try {
    await gitAsync(worktreeDir, ["push"]);
  } catch {
    // Fallback-expected: the plain push has no upstream configured yet (first
    // push of a freshly created branch) — retried below with `--set-upstream`
    // before treating it as a real failure.
    try {
      await gitAsync(worktreeDir, ["push", "--set-upstream", "origin", SHARED_MEMORY_BRANCH]);
    } catch (error) {
      // No remote configured, or unreachable — Shared Memory still works
      // locally (same-machine concurrency safety doesn't require a remote),
      // but an operator debugging "why did shared memory silently stop
      // syncing" has nothing to look at without this line.
      logger?.warn(
        { worktreeDir, error: error instanceof Error ? error.message : String(error) },
        "shared memory push failed; changes remain local-only until the next successful push",
      );
    }
  }
}

/**
 * v11 (ADR-0017): stages and commits any changes under the Shared Memory
 * worktree, then pushes to the branch's remote tracking ref. Called at the
 * end of every `consolidate()` invocation and from the `SessionEnd` hook —
 * never per `remember`/`recall`, to keep the shared history free of
 * per-write noise. A no-op when this store hasn't opted into Shared Memory
 * (`.raiminiscence/memory/` isn't a worktree).
 *
 * v19 (ADR-0025): `add`/`commit` stay fully synchronous; only `push` moved
 * off the blocking `execFileSync` path (see `RunGitAsync`), since it's the
 * one step with genuinely unbounded latency (a slow or unreachable
 * remote). See `FlushSharedMemoryOptions.awaitPush`.
 */
export function flushSharedMemory(storageRoot: string, options: FlushSharedMemoryOptions = {}, deps: FlushSharedMemoryDeps = {}): Promise<void> {
  if (!isSharedMemoryWorktree(storageRoot)) return Promise.resolve();
  const git = deps.git ?? runGit;
  const gitAsync = deps.gitAsync ?? runGitAsync;
  const worktreeDir = memoryStoreDir(storageRoot);

  git(worktreeDir, ["add", "-A"]);
  if (hasStagedChanges(worktreeDir, git)) {
    git(worktreeDir, ["commit", "-m", FLUSH_COMMIT_MESSAGE]);
  }

  // v19 (ADR-0025): the default (unawaited) case is otherwise invisible —
  // the caller's own promise resolves before this push even settles, so
  // without this line nothing in the logs marks that one was dispatched at
  // all until (if ever) `pushWithFallback`'s own failure warning fires.
  options.logger?.debug({ worktreeDir, awaitPush: Boolean(options.awaitPush) }, "shared memory push dispatched");

  const pushDone = pushWithFallback(worktreeDir, gitAsync, options.logger);
  pendingPush = pushDone;
  return options.awaitPush ? pushDone : Promise.resolve();
}

/**
 * v19 (ADR-0025): lets a caller that must not race a not-yet-settled push
 * (`SessionEnd`) wait for whatever `flushSharedMemory` push is currently in
 * flight — from this call or an earlier one, awaited or not — before
 * running its own `git` commands against the same worktree.
 */
export async function settlePendingSharedMemoryPush(): Promise<void> {
  await pendingPush;
}

export interface SharedMemoryPullResult {
  /** Whether HEAD moved at all (a fast-forward counts, and stays silent). */
  pulled: boolean;
  /** Files the merge driver actually had two differing sides to reconcile for — empty for a fast-forward. */
  autoResolvedFiles: string[];
}

const NO_PULL: SharedMemoryPullResult = { pulled: false, autoResolvedFiles: [] };

/**
 * v11 (ADR-0017): the `SessionStart`-hook pull step — `git fetch` + `git
 * merge` on the worktree's branch, explicit and never silent-in-the-
 * background. A fast-forward (or nothing to reconcile) reports
 * `autoResolvedFiles: []`; an actual merge invokes the registered recency-
 * keyed driver, and the files it had to resolve are reported so the caller
 * can surface them. A no-op when this store hasn't opted into Shared Memory,
 * or when there's no reachable remote (offline is silent, not an error).
 */
export function pullSharedMemory(storageRoot: string, git: RunGit = runGit, logger?: ServerLogger): SharedMemoryPullResult {
  if (!isSharedMemoryWorktree(storageRoot)) return NO_PULL;
  const worktreeDir = memoryStoreDir(storageRoot);

  try {
    git(worktreeDir, ["fetch", "origin", SHARED_MEMORY_BRANCH]);
  } catch (error) {
    // No reachable remote (offline) is expected and stays silent-to-the-
    // caller — but not invisible: without this, an unreachable remote fails
    // to pull forever with nothing in production logs to explain why.
    logger?.warn(
      { storageRoot, worktreeDir, error: error instanceof Error ? error.message : String(error) },
      "shared memory pull failed to fetch; continuing with local-only state",
    );
    return NO_PULL;
  }

  const beforeHead = git(worktreeDir, ["rev-parse", "HEAD"]).trim();
  let mergeOutput: string;
  try {
    mergeOutput = git(worktreeDir, ["merge", `origin/${SHARED_MEMORY_BRANCH}`, "--no-edit"]);
  } catch (error) {
    throw new Error(`Shared Memory pull failed to merge: ${error instanceof Error ? error.message : String(error)}`);
  }
  const afterHead = git(worktreeDir, ["rev-parse", "HEAD"]).trim();
  if (beforeHead === afterHead) return NO_PULL;

  // v14 (ADR-0021): a pull can change the underlying files from outside
  // this process entirely — cheap invalidation only, since there's no way
  // to know precisely what changed; the next reader rebuilds from scratch.
  invalidateCache(storageRoot);

  // git prints "Auto-merging <path>" for exactly the files where both sides
  // changed the same path since diverging — the ones a merge strategy (our
  // custom driver, for a path its .gitattributes scope covers) actually had
  // to reconcile. A file only one side touched merges in cleanly with no
  // such line, so diffing the two parents' final trees (which would list
  // every file *either* side touched) would over-report ordinary,
  // non-conflicting merges as "resolved."
  // The capture group is mandatory, so match[1] is always set.
  const autoResolvedFiles = [...mergeOutput.matchAll(/^\s*Auto-merging (.+)$/gm)].map((match) => match[1]!);
  return { pulled: true, autoResolvedFiles };
}
