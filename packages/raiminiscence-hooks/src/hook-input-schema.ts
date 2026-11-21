import { z } from "zod";

export interface HookInput {
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  /** Claude Code's `Stop` hook: this session's id. */
  session_id?: string;
  /** Cursor's `stop` hook: this conversation's id — Cursor's equivalent of a session id. */
  conversation_id?: string;
  /** Claude Code's `Stop` hook: true when this event is itself the continuation from a previous block. */
  stop_hook_active?: boolean;
  /** Claude Code's `PostToolUse`/`PostToolUseFailure` hooks: which tool ran. */
  tool_name?: string;
  /** Claude Code's `PostToolUse`/`PostToolUseFailure` hooks: the arguments sent to the tool — for `Bash`, its `command`. */
  tool_input?: { command?: string };
  /** Claude Code's `PostToolUse` hook: the tool's result — for `Bash`, only present because the command exited zero. */
  tool_response?: { stdout?: string; stderr?: string };
  /** Claude Code's `PostToolUseFailure` hook: for `Bash`, `"Exit code N"` followed by the command's combined stdout+stderr. */
  error?: string;
  /** Claude Code's `PostToolUseFailure` hook: true when the failure reached Claude Code as an abort rather than a reported error. */
  is_interrupt?: boolean;
}

/**
 * Mirrors `HookInput` exactly — every field optional, since each client/event
 * populates a different subset. Guards against a client-side format change
 * reaching business logic unchecked, per `CODING_RULES/05-backend-api.md`'s
 * Zod rule (written for API request bodies, applied here because hook stdin
 * is the same class of untrusted external input).
 */
const hookInputSchema = z.object({
  cwd: z.string().optional(),
  hook_event_name: z.string().optional(),
  prompt: z.string().optional(),
  session_id: z.string().optional(),
  conversation_id: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
  tool_name: z.string().optional(),
  tool_input: z.object({ command: z.string().optional() }).optional(),
  tool_response: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).optional(),
  error: z.string().optional(),
  is_interrupt: z.boolean().optional(),
});

/** The hook's stdin JSON as a `HookInput`, or the validation error when a field has the wrong type. */
export function validateHookInput(json: unknown): { success: true; data: HookInput } | { success: false; error: Error } {
  const result = hookInputSchema.safeParse(json);
  return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
}
