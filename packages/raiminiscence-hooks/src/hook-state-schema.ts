import { z } from "zod";
import type { PersistedNudgeState } from "./checkpoint-nudge.js";
import type { OpenFailureState } from "./fix-nudge.js";

/**
 * The per-session state files `hook-state-store.ts` reads back. Only this
 * package writes them, but they sit on disk between hook processes, so a
 * hand edit or a shape change across versions must degrade to "no prior
 * state" rather than reach the hook as a wrongly typed value.
 */
const persistedNudgeStateSchema = z.object({ lastNudgeAt: z.string(), turnsSinceNudge: z.number() });

const openFailureStateSchema = z.record(z.object({ command: z.string(), stderrTail: z.string() }));

/** Checkpoint's debounce bookkeeping, or `undefined` when the JSON isn't that shape. */
export function parseCheckpointNudgeState(json: unknown): PersistedNudgeState | undefined {
  const parsed = persistedNudgeStateSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** Fix Nudge's Open Failure records, or `undefined` when the JSON isn't that shape. */
export function parseOpenFailureState(json: unknown): OpenFailureState | undefined {
  const parsed = openFailureStateSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
