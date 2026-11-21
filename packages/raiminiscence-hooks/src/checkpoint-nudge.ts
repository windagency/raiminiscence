import { jsonSessionStore, type HookStateStore } from "./hook-state-store.js";
import { logHookError } from "./hook-utils.js";
import { parseCheckpointNudgeState } from "./hook-state-schema.js";

/** ADR-0020: the debounce threshold is 15 minutes or 20 turns, whichever comes first. */
export const CHECKPOINT_NUDGE_INTERVAL_MS = 15 * 60 * 1000;
export const CHECKPOINT_NUDGE_TURN_THRESHOLD = 20;

export type CheckpointNudgeClient = "claude-code" | "cursor";

/** Session-scoped debounce state: elapsed time and turn count since this session's last checkpoint nudge (or session start, if none fired yet). */
export interface CheckpointNudgeState {
  elapsedMs: number;
  turnsSinceNudge: number;
}

/** The hook's stdout shape: `{}` (no-op) or a client-specific soft nudge. Never blocks/forces compliance beyond this one suggestion. */
export interface CheckpointNudgeHookOutput {
  decision?: "block";
  reason?: string;
  followup_message?: string;
}

const NUDGE_MESSAGE =
  'It has been a while (15+ minutes or 20+ turns) since the last checkpoint. Consider calling `remember` with `kind: "checkpoint"` to note what you are currently in the middle of, so continuity survives a session boundary. This is a soft suggestion — proceed as you were if now isn\'t a good moment.';

/**
 * Pure debounce decision (ADR-0020): 15 minutes or 20 turns since the
 * session's last checkpoint nudge, whichever comes first. Never reads a
 * real clock or counter itself — `state` is computed by the caller so this
 * stays deterministic and fast to test.
 */
export function isCheckpointNudgeDue(state: CheckpointNudgeState): boolean {
  return state.elapsedMs >= CHECKPOINT_NUDGE_INTERVAL_MS || state.turnsSinceNudge >= CHECKPOINT_NUDGE_TURN_THRESHOLD;
}

/**
 * The hook's decision output for a given client, given the debounce state.
 * `stopHookActive` (Claude Code only) is Claude Code's own signal that this
 * `Stop` event is itself the continuation from a previous block — nudging
 * again here would recurse, so it's an unconditional no-op regardless of
 * `state`. Cursor has no equivalent field: resetting the debounce state
 * whenever a nudge fires (see `checkpointNudge` below) already keeps its
 * `followup_message`'s own resulting `stop` event from re-triggering
 * immediately, and Cursor's own `loop_limit` bounds runaway follow-ups
 * regardless.
 */
export function checkpointNudgeOutput(
  client: CheckpointNudgeClient,
  state: CheckpointNudgeState,
  options: { stopHookActive?: boolean } = {},
): CheckpointNudgeHookOutput {
  if (options.stopHookActive) return {};
  if (!isCheckpointNudgeDue(state)) return {};
  return client === "claude-code" ? { decision: "block", reason: NUDGE_MESSAGE } : { followup_message: NUDGE_MESSAGE };
}

export interface PersistedNudgeState {
  lastNudgeAt: string;
  turnsSinceNudge: number;
}

/** Injectable for testing: reads/writes this session's persisted turn/time bookkeeping. */
export type NudgeStateStore = HookStateStore<PersistedNudgeState>;

export interface CheckpointNudgeOptions {
  storageRoot: string;
  sessionId: string;
  client: CheckpointNudgeClient;
  now?: Date;
  /** Claude Code only — see `checkpointNudgeOutput`. */
  stopHookActive?: boolean;
  /** Injectable for testing; defaults to a real on-disk per-session state file under storageRoot. */
  stateStore?: NudgeStateStore;
}

/** This turn's debounce state: a session with no prior record starts implicitly at "now, zero elapsed". */
function stateThisTurn(persisted: PersistedNudgeState | undefined, now: Date): CheckpointNudgeState {
  if (!persisted) return { elapsedMs: 0, turnsSinceNudge: 1 };
  return { elapsedMs: now.getTime() - new Date(persisted.lastNudgeAt).getTime(), turnsSinceNudge: persisted.turnsSinceNudge + 1 };
}

/** What to persist after this turn: a fired nudge resets the bookkeeping so the next one waits a full debounce interval. */
function persistedAfterTurn(
  persisted: PersistedNudgeState | undefined,
  state: CheckpointNudgeState,
  now: Date,
  nudged: boolean,
): PersistedNudgeState {
  if (nudged) return { lastNudgeAt: now.toISOString(), turnsSinceNudge: 0 };
  return { lastNudgeAt: persisted?.lastNudgeAt ?? now.toISOString(), turnsSinceNudge: state.turnsSinceNudge };
}

/**
 * The `Stop`/`stop` hook's production entrypoint: loads this session's
 * persisted turn/time bookkeeping (a session with no prior record starts
 * implicitly at "now, zero elapsed"), advances the turn count by one,
 * decides via `checkpointNudgeOutput`, and — only when a nudge actually
 * fires — resets the bookkeeping so the next nudge waits a full debounce
 * interval again. Never throws: any failure here is swallowed, matching
 * every other hook step's fail-open contract.
 */
export function checkpointNudge(options: CheckpointNudgeOptions): CheckpointNudgeHookOutput {
  try {
    const now = options.now ?? new Date();
    const store = options.stateStore ?? jsonSessionStore(options.storageRoot, "checkpoint-nudge", parseCheckpointNudgeState);
    const persisted = store.read(options.sessionId);
    const state = stateThisTurn(persisted, now);

    const output = checkpointNudgeOutput(options.client, state, { stopHookActive: options.stopHookActive });

    const nudged = output.decision === "block" || output.followup_message !== undefined;
    store.write(options.sessionId, persistedAfterTurn(persisted, state, now, nudged));

    return output;
  } catch (error) {
    logHookError("checkpoint-nudge", `failed to compute or persist nudge state for session ${options.sessionId}; skipping this nudge`, error);
    return {};
  }
}
