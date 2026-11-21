import {
  consolidate,
  ensureSharedMemoryWorktree,
  pullSharedMemory,
  resolveSharedMemory,
  settleOpportunisticConsolidation,
  settlePendingSharedMemoryPush,
  type ConsolidateParams,
  type ConsolidateResult,
} from "raiminiscence-mcp";
import { logHookError } from "./hook-utils.js";

export interface SharedMemorySessionStartOptions {
  storageRoot: string;
  cwd?: string;
  /** Injectable for testing; defaults to the real config-driven check. */
  sharedMemoryEnabled?: (cwd: string | undefined) => boolean;
  /** Injectable for testing; defaults to the real worktree setup. */
  ensureWorktree?: (storageRoot: string) => void;
  /** Injectable for testing; defaults to the real pull. */
  pull?: (storageRoot: string) => { pulled: boolean; autoResolvedFiles: string[] };
}

/**
 * v11 (ADR-0017): the `SessionStart`-hook step that runs after the existing
 * primer — one-time worktree setup (idempotent, only attempted when the
 * project has actually opted in) followed by an explicit pull. Returns a
 * short note naming any files the merge driver had to auto-resolve, or ""
 * for the common case (sharing disabled, or nothing to reconcile). Never
 * throws: any failure here is swallowed, matching every other SessionStart
 * step's "never blocks, never breaks session start" contract.
 */
export function sharedMemorySessionStartNote(options: SharedMemorySessionStartOptions): string {
  const sharedMemoryEnabled = options.sharedMemoryEnabled ?? resolveSharedMemory;
  const ensureWorktree = options.ensureWorktree ?? ensureSharedMemoryWorktree;
  const pull = options.pull ?? pullSharedMemory;

  try {
    if (!sharedMemoryEnabled(options.cwd)) return "";

    ensureWorktree(options.storageRoot);
    const result = pull(options.storageRoot);
    if (result.autoResolvedFiles.length === 0) return "";

    return `[Shared Memory] Auto-resolved a merge conflict in: ${result.autoResolvedFiles.join(", ")}`;
  } catch (error) {
    logHookError("shared-memory-sync", "failed during SessionStart shared-memory worktree setup/pull; skipping the shared-memory note", error);
    return "";
  }
}

export interface SharedMemorySessionEndOptions {
  storageRoot: string;
  now?: Date;
  /** Injectable for testing; defaults to the real `consolidate()` engine call. */
  consolidate?: (params: ConsolidateParams) => Promise<ConsolidateResult>;
  /** Injectable for testing; defaults to the real in-process settle. */
  settleOpportunisticConsolidation?: () => Promise<void>;
  /** Injectable for testing; defaults to the real pending-push settle. */
  settlePendingSharedMemoryPush?: () => Promise<void>;
}

/**
 * v19 (ADR-0025): the `SessionEnd`-hook step — replaces the old
 * Shared-Memory-only flush with an unconditional, forced, fully-awaited
 * `consolidate()` pass: this now runs (and delivers its local
 * Pruning/Promotion/Promotion Audit/Commit Invalidation/Invalidation
 * benefit) for every project, not only ones with Shared Memory enabled.
 * The Shared Memory flush `consolidate()` runs internally stays a no-op
 * when that feature isn't on, exactly as before.
 *
 * Bypasses Opportunistic Consolidation's debounce entirely (an explicit
 * pass, like the `consolidate` tool call) and resets its clock as a side
 * effect, per `consolidate()`'s own reset-on-any-real-pass behaviour.
 * `awaitPush: true` guarantees the shared git push actually settles before
 * this hook (and the shim process) exits.
 *
 * Two settles run first, in order, so an opportunistic pass already in
 * flight in this same process can't race this forced one for a second,
 * concurrent `git` invocation against the same Shared Memory worktree:
 * `settleOpportunisticConsolidation` waits for that pass's own local
 * work (and the kickoff of its push, since opportunistic passes always run
 * with `awaitPush: false`), then `settlePendingSharedMemoryPush` waits for
 * that just-kicked-off push itself to actually settle — awaiting the first
 * alone would let this step's own `add`/`commit` run while that push is
 * still in flight. Never throws — matching every other hook step's
 * fail-open contract, a failed or unreachable git push included.
 */
export async function runSharedMemorySessionEnd(options: SharedMemorySessionEndOptions): Promise<void> {
  const runConsolidate = options.consolidate ?? consolidate;
  const settlePass = options.settleOpportunisticConsolidation ?? settleOpportunisticConsolidation;
  const settlePush = options.settlePendingSharedMemoryPush ?? settlePendingSharedMemoryPush;
  try {
    await settlePass();
    await settlePush();
    await runConsolidate({ storageRoot: options.storageRoot, now: options.now, awaitPush: true });
  } catch (error) {
    // Never surface an error from a hook.
    logHookError(
      "shared-memory-sync",
      "failed during SessionEnd consolidate/push — local Consolidation and/or the shared-memory git push may not have completed",
      error,
    );
  }
}
