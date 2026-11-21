import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import type { ServerLogger } from "#src/adapters/logger.js";
import { parseOpportunisticConsolidationState } from "./cache-state-schema.js";

/**
 * v19 (ADR-0025): per-storage-root, local-only debounce bookkeeping for
 * Opportunistic Consolidation — a derived, rebuildable artifact, never
 * Memory content and never synced via Shared Memory. Lives under
 * `.raiminiscence/cache/`, the same sibling-to-`memory/` location
 * `recall-cache.ts` already uses for exactly that reason (a Shared Memory
 * `git add -A` is scoped to `.raiminiscence/memory/` and never sees it).
 *
 * Unlike the hooks package's session-scoped `hook-state-store.ts` (one file
 * per session, since each hook invocation is a fresh process with nothing
 * to carry forward), this is store-level: one file per storage root, since
 * the debounce is a property of that store's own remember/recall traffic
 * across every session and every process that touches it.
 *
 * Reuses `recall-cache.ts`'s atomic-write-then-rename approach, factored out
 * as the shared `atomic-write.ts` helper, but deliberately not its
 * independently-versioned-slot machinery (`version.json` plus a per-slot
 * in-memory cache): there's only ever one value here, read fresh from disk
 * on every check, with no in-memory copy to keep in sync across processes —
 * the versioning that pattern exists for has nothing to coordinate in a
 * single-file, single-writer-at-a-time state.
 */
export interface OpportunisticConsolidationState {
  /** ISO timestamp of the last real (non-`dryRun`) Consolidation pass to complete for this storage root. */
  lastPassAt: string;
  /** Calls to `triggerOpportunisticConsolidation` since that pass, including ones that didn't fire. */
  callsSinceLastPass: number;
}

/** ADR-0025: mirrors Checkpoint's own 15-minute/20-turn debounce precedent (ADR-0020) at comparable order. */
export const OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS = 15 * 60 * 1000;
export const OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD = 20;

function statePath(storageRoot: string): string {
  return join(storageRoot, ".raiminiscence", "cache", "opportunistic-consolidation.json");
}

/**
 * A missing file is the expected "no pass yet" case and stays silent. A
 * present-but-corrupt file is not expected, and — since this state is
 * store-level, not session-scoped — a corrupt file would otherwise keep
 * silently forcing every future call back onto "always due" with nothing
 * in production logs to explain why. `logger` is optional because `core/`
 * itself has no logger dependency — it's threaded in from `server.ts` via
 * `recall`/`remember`'s own params and `triggerOpportunisticConsolidation`.
 */
export function readOpportunisticConsolidationState(storageRoot: string, logger?: ServerLogger): OpportunisticConsolidationState | undefined {
  const path = statePath(storageRoot);
  if (!existsSync(path)) return undefined;
  try {
    const state = parseOpportunisticConsolidationState(JSON.parse(readFileSync(path, "utf8")));
    if (!state)
      logger?.warn({ storageRoot, path }, "opportunistic consolidation state file has an unexpected shape; treating as absent (fresh debounce)");
    return state;
  } catch (error) {
    logger?.warn(
      { storageRoot, path, error: error instanceof Error ? error.message : String(error) },
      "opportunistic consolidation state file exists but failed to parse; treating as absent (fresh debounce)",
    );
    return undefined;
  }
}

export function writeOpportunisticConsolidationState(storageRoot: string, state: OpportunisticConsolidationState): void {
  writeAtomic(statePath(storageRoot), JSON.stringify(state));
}

/**
 * Absent state — no real pass has ever completed for this storage root —
 * is always due: a fresh store shouldn't wait a full debounce window for
 * its very first Opportunistic Consolidation pass.
 */
export function isOpportunisticConsolidationDue(state: OpportunisticConsolidationState | undefined, now: Date): boolean {
  if (!state) return true;
  const elapsedMs = now.getTime() - new Date(state.lastPassAt).getTime();
  return elapsedMs >= OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS || state.callsSinceLastPass >= OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD;
}

/**
 * Called by `consolidate()` as a side effect of completing any real
 * (non-`dryRun`) pass, regardless of what triggered it — the opportunistic
 * trigger, an explicit `consolidate` tool call, and the `SessionEnd` forced
 * pass all keep this one clock honest with no per-call-site duplication.
 */
export function resetOpportunisticConsolidationState(storageRoot: string, now: Date): void {
  writeOpportunisticConsolidationState(storageRoot, { lastPassAt: now.toISOString(), callsSinceLastPass: 0 });
}
