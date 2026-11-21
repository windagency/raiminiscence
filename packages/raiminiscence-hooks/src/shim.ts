#!/usr/bin/env node
// ADR-0039: only the light recall client and this file's own helpers load up front. Each event's
// handler, and through it the engine, is imported when that event arrives, so a per-turn prompt
// answered by a running server never loads the engine.
import { resolveStorageRoot } from "raiminiscence-mcp/recall-client";
import type { CheckpointNudgeClient } from "./checkpoint-nudge.js";
import { logHookError } from "./hook-utils.js";
import { validateHookInput, type HookInput } from "./hook-input-schema.js";

/** Fallback session id when a client sends no `session_id`/`conversation_id` at all — kept as one constant so `fixNudgeFromHookInput` and `checkpointNudgeFromHookInput` can't drift apart on the literal. */
const UNKNOWN_SESSION_ID = "unknown-session";

/** v13 (ADR-0020): `Stop` (Claude Code) / `stop` (Cursor) only — Codex CLI is intentionally not wired here yet. */
const STOP_HOOK_EVENT_CLIENTS: Record<string, CheckpointNudgeClient> = { Stop: "claude-code", stop: "cursor" };

/** v18 (ADR-0023): Fix Nudge's `PostToolUse`/`PostToolUseFailure` — Claude Code only, mirroring `STOP_HOOK_EVENT_CLIENTS`'s per-event/per-client shape; there is no single event covering both a Bash command's success and failure, unlike `Stop`/`stop`. Cursor and Codex CLI aren't wired to either event here yet. */
const FIX_NUDGE_HOOK_EVENT_CLIENTS: Record<string, "claude-code"> = { PostToolUse: "claude-code", PostToolUseFailure: "claude-code" };

/**
 * Claude Code's `PostToolUseFailure.error` for Bash leads with an
 * `"Exit code N"` line, then the command's combined stdout+stderr as one
 * block — there's no separate `stderr` field the way `PostToolUse.tool_response`
 * has one. A bare failure message (the shell itself couldn't start) has no
 * such line; that's still a failure, so it's treated as exit code 1.
 */
function parseBashFailure(error: string) {
  const match = error.match(/^Exit code (-?\d+)\n?/);
  return match ? { exitCode: Number(match[1]), stderr: error.slice(match[0].length) } : { exitCode: 1, stderr: error };
}

function bashSuccess(input: HookInput): { exitCode: number; stderr: string } {
  return { exitCode: 0, stderr: input.tool_response?.stderr ?? "" };
}

/**
 * Translates one `PostToolUse`/`PostToolUseFailure` invocation into
 * `fixNudge`'s client-agnostic outcome shape and delegates to it entirely —
 * matching/transition/truncation/nudge-content all live there. Restricted
 * to `tool_name: "Bash"` (only its input/result carries a shell command and
 * exit code) and skips an aborted `PostToolUseFailure` (`is_interrupt`),
 * since a Ctrl-C isn't a genuine command failure worth tracking.
 */
async function fixNudgeFromHookInput(input: HookInput, storageRoot: string) {
  if (input.tool_name !== "Bash") return {};
  const command = input.tool_input?.command;
  if (!command) return {};

  const isFailure = input.hook_event_name === "PostToolUseFailure";
  if (isFailure && input.is_interrupt) return {};

  const { exitCode, stderr } = isFailure ? parseBashFailure(input.error ?? "") : bashSuccess(input);

  const [{ fixNudge }, { resolveWatchedCommands }] = await Promise.all([import("./fix-nudge.js"), import("./mcp-engine.js")]);
  return fixNudge({
    storageRoot,
    sessionId: input.session_id ?? UNKNOWN_SESSION_ID,
    watchedCommands: resolveWatchedCommands(input.cwd),
    command,
    exitCode,
    stderr,
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", (error) => {
      logHookError("hook-shim", "stdin read error; proceeding with whatever input was received before the error", error);
      resolve(data);
    });
  });
}

function parseHookInput(raw: string): HookInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logHookError("hook-shim", "failed to parse hook input as JSON; treating this invocation as empty input", error);
    return {};
  }
  const result = validateHookInput(parsed);
  if (!result.success) {
    logHookError("hook-shim", "hook input failed schema validation; treating this invocation as empty input", result.error);
    return {};
  }
  return result.data;
}

async function checkpointNudgeFromHookInput(input: HookInput, storageRoot: string, client: CheckpointNudgeClient) {
  const sessionId = client === "claude-code" ? input.session_id : input.conversation_id;
  const { checkpointNudge } = await import("./checkpoint-nudge.js");
  return checkpointNudge({
    storageRoot,
    sessionId: sessionId ?? UNKNOWN_SESSION_ID,
    client,
    stopHookActive: input.stop_hook_active,
  });
}

/** `UserPromptSubmit` injects recalled Memories; every other event (SessionStart) injects the primer plus any Shared Memory note. */
async function contextInjectionFromHookInput(input: HookInput, storageRoot: string) {
  const text =
    input.hook_event_name === "UserPromptSubmit" ? await promptRecallContext(input, storageRoot) : await sessionStartContext(input, storageRoot);
  return text ? { hookSpecificOutput: { additionalContext: text } } : {};
}

async function promptRecallContext(input: HookInput, storageRoot: string): Promise<string> {
  const { promptRecallText } = await import("./prompt-recall.js");
  return promptRecallText({ storageRoot, prompt: input.prompt ?? "" });
}

async function sessionStartContext(input: HookInput, storageRoot: string): Promise<string> {
  const [{ primerText }, { sharedMemorySessionStartNote }] = await Promise.all([import("./primer.js"), import("./shared-memory-sync.js")]);
  return [await primerText({ storageRoot }), sharedMemorySessionStartNote({ storageRoot, cwd: input.cwd })].filter(Boolean).join("\n");
}

async function hookOutput(input: HookInput, storageRoot: string): Promise<object> {
  const event = input.hook_event_name;
  if (event === "SessionEnd") {
    const { runSharedMemorySessionEnd } = await import("./shared-memory-sync.js");
    await runSharedMemorySessionEnd({ storageRoot });
    return {};
  }

  const fixNudgeClient = event ? FIX_NUDGE_HOOK_EVENT_CLIENTS[event] : undefined;
  if (fixNudgeClient) return fixNudgeFromHookInput(input, storageRoot);

  const stopClient = event ? STOP_HOOK_EVENT_CLIENTS[event] : undefined;
  if (stopClient) return checkpointNudgeFromHookInput(input, storageRoot, stopClient);

  return contextInjectionFromHookInput(input, storageRoot);
}

async function main(): Promise<void> {
  const input = parseHookInput(await readStdin());
  process.stdout.write(JSON.stringify(await hookOutput(input, resolveStorageRoot(input.cwd))));
}

main().catch((error) => {
  // Never surface an error from a hook: fail silently, no injected context.
  logHookError("hook-shim", "unhandled failure in the shim's main(); emitting the empty no-op hook output", error);
  process.stdout.write("{}");
});
