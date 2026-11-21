import type { Scope, StorageLocation } from "./types.js";
import { consolidate as runConsolidate } from "./consolidate.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { effectiveStorageRoot } from "./project-root.js";
import {
  isOpportunisticConsolidationDue,
  readOpportunisticConsolidationState,
  writeOpportunisticConsolidationState,
} from "./opportunistic-consolidation-state.js";
import type { ServerLogger } from "#src/adapters/logger.js";

/** In-process/test-only opt-out; never exposed via the MCP tool layer. Defaults to `true`. */
export interface OpportunisticConsolidationOptIn {
  triggerConsolidation?: boolean;
}

/**
 * Tracks only the most recently scheduled opportunistic pass (a single
 * slot, not a queue): `setImmediate` callbacks run strictly in scheduling
 * order and each runs fully synchronously, so awaiting the latest one
 * guarantees every earlier one has already settled too.
 */
let pendingOpportunisticConsolidation: Promise<void> | undefined;

/**
 * Race guard (fix): the persisted debounce clock (`opportunistic-consolidation-state.ts`)
 * is only reset once a real pass *completes* — so a call landing while a
 * scheduled pass is still in flight would otherwise still read the
 * pre-pass, stale "due" state and fire a second, concurrent
 * `runConsolidate` on top of the one already running, reintroducing the
 * exact same-thread contention the debounce exists to prevent. This flag
 * closes that window: it flips to `true` synchronously the moment a pass
 * is scheduled (before the `setImmediate` callback even runs, since a
 * later call could otherwise land in that gap) and back to `false` only
 * once that pass's `runConsolidate` has fully settled. Deliberately
 * in-process/in-memory, not persisted: unlike the debounce clock itself
 * (a store-level, cross-restart, cross-process concern), "is a pass
 * currently running" is a property of this one Node process's own event
 * loop, which no other process's copy of this flag could answer for it.
 */
let opportunisticConsolidationInFlight = false;

/**
 * Best-effort, non-blocking: deferred past the current call's return (via
 * `setImmediate`) so a caller never waits on a full Clustering/Pruning pass,
 * and failures are swallowed since this is opportunistic, not the explicit
 * `consolidate` tool call. Disabled via `enabled: false` only by in-process
 * callers (never the MCP tool layer) that need deterministic state — see
 * `settleOpportunisticConsolidation`.
 *
 * v19 (ADR-0025): gated by a persisted, per-storage-root debounce — skips
 * firing (and just records this call against the running count) unless a
 * fixed time interval or fixed call count has elapsed since the last real
 * pass, whichever comes first. A storage root with no real pass on record
 * yet is always due, so a fresh store still gets its first opportunistic
 * pass immediately rather than waiting out a full debounce window. The
 * debounce clock itself is only ever reset by `consolidate()` completing a
 * real pass (see `resetOpportunisticConsolidationState`), never by this
 * function firing — so, absent `opportunisticConsolidationInFlight` below,
 * a call landing while a pass is still in flight (not yet reset) would
 * keep re-reading the same stale "due" state and fire a second, concurrent
 * pass. That flag closes exactly this window: due-or-not, a call is
 * skipped outright while a previously scheduled pass hasn't settled yet.
 *
 * A failure here must never surface to (or reject) the caller — this runs
 * detached, past the current call's return — but it must not be invisible
 * either: `logger`, when a caller has one reachable, receives it via
 * `warn`/`error` instead of a bare swallow. Optional because `core/` itself
 * has no logger dependency — `recall`/`remember` accept one on their own
 * params and pass it straight through, threaded from `server.ts`'s
 * `createServer`, the only place a real one is actually constructed.
 */
export function triggerOpportunisticConsolidation(
  scope: Scope,
  location: StorageLocation,
  now: Date | undefined,
  enabled: boolean,
  embeddingProvider: EmbeddingProvider,
  logger?: ServerLogger,
): boolean {
  if (!enabled) return false;

  const effectiveRoot = effectiveStorageRoot(scope, location);
  const resolvedNow = now ?? new Date();
  const state = readOpportunisticConsolidationState(effectiveRoot, logger);

  if (state && !isOpportunisticConsolidationDue(state, resolvedNow)) {
    writeOpportunisticConsolidationState(effectiveRoot, { ...state, callsSinceLastPass: state.callsSinceLastPass + 1 });
    logger?.debug(
      { scope, effectiveRoot, callsSinceLastPass: state.callsSinceLastPass + 1 },
      "opportunistic consolidation skipped: debounce not due yet",
    );
    return false;
  }

  // Race guard (fix): a pass scheduled by an earlier call is still running
  // and hasn't reset the debounce clock yet — firing another one now would
  // run it concurrently with the one already in flight, exactly the
  // contention the debounce exists to prevent. Skip unconditionally; the
  // in-flight pass's own reset will make the next call's due-check accurate
  // again once it settles.
  if (opportunisticConsolidationInFlight) {
    logger?.debug({ scope, effectiveRoot }, "opportunistic consolidation skipped: a previously scheduled pass is still in flight");
    return false;
  }

  opportunisticConsolidationInFlight = true;
  pendingOpportunisticConsolidation = new Promise<void>((resolve) => {
    setImmediate(() => {
      runConsolidate({ scope, ...location, now, embeddingProvider, logger })
        .catch((error: unknown) => {
          // Opportunistic only; a failure here must never surface to the
          // caller — but it must still be visible somewhere, hence the log.
          logger?.error(
            { scope, effectiveRoot, error: error instanceof Error ? error.message : String(error) },
            "opportunistic consolidation pass failed",
          );
        })
        .finally(() => {
          opportunisticConsolidationInFlight = false;
          resolve();
        });
    });
  });
  return true;
}

/**
 * Lets an in-process caller (test code, not the MCP tool layer) wait for
 * whatever opportunistic consolidation is currently in flight to settle,
 * instead of bypassing `remember`/`recall` entirely to get determinism.
 */
export async function settleOpportunisticConsolidation(): Promise<void> {
  await pendingOpportunisticConsolidation;
}
