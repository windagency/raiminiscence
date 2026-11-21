import { jsonSessionStore, type HookStateStore } from "./hook-state-store.js";
import { logHookError } from "./hook-utils.js";
import { parseOpenFailureState } from "./hook-state-schema.js";

/** v18 (ADR-0023): the tail-truncation length for stored/injected stderr — the actionable summary lives at the end, not the start. */
export const FIX_NUDGE_STDERR_TAIL_LINES = 40;

/** A Watched Command pattern's most recent failing invocation, kept only until that pattern next succeeds. */
export interface OpenFailureRecord {
  command: string;
  stderrTail: string;
}

/** Per-session Open Failure state, keyed by Watched Command pattern so several patterns coexist independently. */
export type OpenFailureState = Record<string, OpenFailureRecord>;

/** Injectable for testing: reads/writes this session's persisted Open Failure state, matching `NudgeStateStore`'s shape. */
export type FixNudgeStateStore = HookStateStore<OpenFailureState>;

/**
 * Truncates `stderr` to its last `maxLines` lines, kept whole when at or
 * under that length. The tail, not the head, since compiler/test-runner
 * output puts its actionable summary at the end.
 */
export function truncateStderrTail(stderr: string, maxLines: number = FIX_NUDGE_STDERR_TAIL_LINES): string {
  const lines = stderr.split("\n");
  return lines.length <= maxLines ? stderr : lines.slice(-maxLines).join("\n");
}

/**
 * Pure matching: every configured Watched Command pattern that `command`
 * matches (zero, one, or several — each tracked independently by the
 * caller). A pattern is tried as a regex first (so `"tsc.*--noEmit"` works),
 * falling back to a plain substring test when it isn't valid regex syntax.
 */
export function matchWatchedCommands(command: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => {
    try {
      return new RegExp(pattern).test(command);
    } catch {
      return command.includes(pattern);
    }
  });
}

export interface CommandOutcome {
  command: string;
  exitCode: number;
  stderr: string;
}

/** What a fired nudge needs to say: the failed command and its captured stderr; the caller supplies the now-succeeding command name. */
export interface FixNudgeContent {
  failedCommand: string;
  stderrTail: string;
}

export interface FixNudgeTransitionResult {
  /** This pattern's new Open Failure record — `undefined` clears it (success, or no prior failure). */
  record: OpenFailureRecord | undefined;
  /** Present exactly on a failure→success transition for this pattern. */
  nudge: FixNudgeContent | undefined;
}

/**
 * Pure transition (ADR-0023): a nudge fires exactly on a failure→success
 * transition for this one pattern. failure→failure updates the record to
 * the latest failure's details without nudging; success→success and
 * no-prior-state→failure clear/set the record but never nudge.
 */
export function fixNudgeTransition(previous: OpenFailureRecord | undefined, outcome: CommandOutcome): FixNudgeTransitionResult {
  if (outcome.exitCode === 0) {
    return previous
      ? { record: undefined, nudge: { failedCommand: previous.command, stderrTail: previous.stderrTail } }
      : { record: undefined, nudge: undefined };
  }
  return { record: { command: outcome.command, stderrTail: truncateStderrTail(outcome.stderr) }, nudge: undefined };
}

/** The nudge's injected text: names both commands, carries the truncated stderr, and instructs `remember` with `isError: true` (ADR-0023, so Error Amplification applies). */
export function fixNudgeText(content: FixNudgeContent, succeededCommand: string): string {
  return (
    `The watched command \`${content.failedCommand}\` previously failed, and \`${succeededCommand}\` has now succeeded. ` +
    `Consider calling \`remember\` with \`isError: true\` to capture the root cause and fix, before the details are lost. ` +
    `The failed command's captured stderr (last ${FIX_NUDGE_STDERR_TAIL_LINES} lines):\n\n${content.stderrTail}`
  );
}

export interface FixNudgeOptions {
  storageRoot: string;
  sessionId: string;
  watchedCommands: string[];
  command: string;
  exitCode: number;
  stderr: string;
  /** Injectable for testing; defaults to a real on-disk per-session state file under storageRoot. */
  stateStore?: FixNudgeStateStore;
}

/** The hook's stdout shape: `{}` (no-op) or a soft `additionalContext` suggestion. Never blocks/forces compliance. */
export interface FixNudgeHookOutput {
  hookSpecificOutput?: { additionalContext: string };
}

/**
 * The `PostToolUse`/`PostToolUseFailure` hooks' production entrypoint for
 * one Bash invocation: matches `command` against the configured Watched
 * Commands, applies `fixNudgeTransition` to each matched pattern's stored
 * record, persists the updated state, and returns a combined nudge when any
 * pattern just transitioned failure→success. Never throws: any failure here
 * is swallowed, matching every other hook step's fail-open contract.
 */
export function fixNudge(options: FixNudgeOptions): FixNudgeHookOutput {
  try {
    const patterns = matchWatchedCommands(options.command, options.watchedCommands);
    if (patterns.length === 0) return {};

    const store = options.stateStore ?? jsonSessionStore(options.storageRoot, "fix-nudge", parseOpenFailureState);
    const state = { ...(store.read(options.sessionId) ?? {}) };
    const nudgeTexts: string[] = [];

    for (const pattern of patterns) {
      const { record, nudge } = fixNudgeTransition(state[pattern], {
        command: options.command,
        exitCode: options.exitCode,
        stderr: options.stderr,
      });
      if (record) {
        state[pattern] = record;
      } else {
        delete state[pattern];
      }
      if (nudge) {
        nudgeTexts.push(fixNudgeText(nudge, options.command));
      }
    }

    store.write(options.sessionId, state);

    return nudgeTexts.length > 0 ? { hookSpecificOutput: { additionalContext: nudgeTexts.join("\n\n") } } : {};
  } catch (error) {
    logHookError("fix-nudge", `failed to compute or persist Open Failure state for session ${options.sessionId}; skipping this nudge`, error);
    return {};
  }
}
