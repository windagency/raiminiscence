import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { remember } from "raiminiscence-mcp";
import type { EmbeddingProvider } from "raiminiscence-mcp";
import { CHECKPOINT_NUDGE_INTERVAL_MS } from "#src/checkpoint-nudge.js";

const SHIM_PATH = fileURLToPath(new URL("../dist/shim.js", import.meta.url));

/**
 * The shim's working directory. A spawned process is out of reach of vitest's model stub, and the
 * default Embedding Provider is resolved from the process's cwd, so this directory's config points it
 * at an Ollama endpoint nothing listens on: the embed call fails at once and recall stays lexical,
 * with no model download.
 */
const SHIM_CWD = mkdtempSync(join(tmpdir(), "raiminiscence-shim-cwd-"));
writeFileSync(
  join(SHIM_CWD, ".raiminiscence.config.json"),
  JSON.stringify({ embeddingProvider: { provider: "ollama", endpoint: "http://127.0.0.1:9" } }),
);
afterAll(() => rmSync(SHIM_CWD, { recursive: true, force: true }));

/** Never resolves — keeps `remember` from making a real network call to a local embedding server that may not be running in CI. */
const noEmbeddingProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

/**
 * Spawns the real, built `dist/shim.js` binary — the seam the unit tests in
 * this directory (`primer.test.ts`, `prompt-recall.test.ts`,
 * `checkpoint-nudge.test.ts`, `templates.test.ts`, `install.test.ts`)
 * structurally cannot cover: argv/stdin parsing and the actual compiled
 * `dist/` output, invoked the same way a real client invokes it (JSON on
 * stdin, a JSON hook-output shape on stdout). `execFileSync` throwing only
 * on a non-zero exit or signal doubles as this suite's exit-code assertion
 * — matching the subprocess convention already used by
 * `packages/raiminiscence-mcp/test/server.test.ts`'s `git()` helper.
 *
 * Requires `pnpm build` to have run first — `dist/shim.js` won't exist
 * otherwise.
 */
function invokeShim(stdin: Record<string, unknown>): unknown {
  if (!existsSync(SHIM_PATH)) {
    throw new Error(`${SHIM_PATH} does not exist — run \`pnpm build\` before running this suite.`);
  }
  const stdout = execFileSync("node", [SHIM_PATH], { cwd: SHIM_CWD, input: JSON.stringify(stdin), encoding: "utf8" });
  return JSON.parse(stdout);
}

async function seedDecisionMemory(storageRoot: string): Promise<void> {
  await remember({
    content: "Decision: use Postgres for the write model.",
    client: "claude-code",
    kind: "decision",
    storageRoot,
    embeddingProvider: noEmbeddingProvider,
  });
}

/**
 * Provenance for every fixture below: confirmed-against-docs. Claude Code's
 * `SessionStart`/`UserPromptSubmit`/`Stop`/`SessionEnd` stdin shapes
 * (`hook_event_name`, `cwd`, `session_id`, `prompt`, `stop_hook_active`) and
 * output contract (`{"hookSpecificOutput":{"additionalContext":...}}` or
 * `{}`; `Stop`'s `{"decision":"block","reason":...}`) come from
 * https://code.claude.com/docs/en/hooks.md, already verified against
 * that source and exercised in production by v10/v13. This is the one
 * client already known to work — a regression baseline, not new discovery.
 */
describe("shim binary contract: Claude Code (confirmed-against-docs, regression baseline)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-shim-contract-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("SessionStart with no standing memories returns the {} no-op shape", () => {
    const output = invokeShim({ hook_event_name: "SessionStart", cwd: storageRoot, source: "startup", session_id: "s1" });
    expect(output).toEqual({});
  });

  it("SessionStart with a standing memory returns hookSpecificOutput.additionalContext", async () => {
    await seedDecisionMemory(storageRoot);

    const output = invokeShim({ hook_event_name: "SessionStart", cwd: storageRoot, source: "startup", session_id: "s1" }) as {
      hookSpecificOutput: { additionalContext: string };
    };

    expect(output.hookSpecificOutput.additionalContext).toContain("Postgres");
  });

  it("UserPromptSubmit with no matching memories returns the {} no-op shape", () => {
    const output = invokeShim({ hook_event_name: "UserPromptSubmit", cwd: storageRoot, prompt: "what database are we using?", session_id: "s1" });
    expect(output).toEqual({});
  });

  it("UserPromptSubmit with a matching memory returns hookSpecificOutput.additionalContext", async () => {
    await seedDecisionMemory(storageRoot);

    const output = invokeShim({
      hook_event_name: "UserPromptSubmit",
      cwd: storageRoot,
      prompt: "what database write model are we using",
      session_id: "s1",
    }) as { hookSpecificOutput: { additionalContext: string } };

    expect(output.hookSpecificOutput.additionalContext).toContain("Postgres");
  });

  it("SessionEnd returns the literal {} no-op shape", () => {
    const output = invokeShim({ hook_event_name: "SessionEnd", cwd: storageRoot, session_id: "s1" });
    expect(output).toEqual({});
  });

  it("Stop returns {} on the not-yet-due debounce path (a session's first Stop event)", () => {
    const output = invokeShim({ hook_event_name: "Stop", cwd: storageRoot, session_id: "s1" });
    expect(output).toEqual({});
  });

  it("Stop returns the block/reason shape on the due path (nudge-state file pre-seeded past the debounce threshold)", () => {
    const sessionId = "s1";
    const statePath = join(storageRoot, ".raiminiscence", "hooks-state", "checkpoint-nudge", `${sessionId}.json`);
    mkdirSync(dirname(statePath), { recursive: true });
    const overdueLastNudge = new Date(Date.now() - CHECKPOINT_NUDGE_INTERVAL_MS - 1000).toISOString();
    writeFileSync(statePath, JSON.stringify({ lastNudgeAt: overdueLastNudge, turnsSinceNudge: 0 }));

    const output = invokeShim({ hook_event_name: "Stop", cwd: storageRoot, session_id: sessionId }) as {
      decision: string;
      reason: string;
    };

    expect(output.decision).toBe("block");
    expect(output.reason).toMatch(/checkpoint/i);
  });

  it("PostToolUseFailure for a non-matching Bash command returns the {} no-op shape (no Watched Command configured)", () => {
    const output = invokeShim({
      hook_event_name: "PostToolUseFailure",
      cwd: storageRoot,
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "grep foo bar.txt" },
      error: "Exit code 1\nno match",
    });
    expect(output).toEqual({});
  });

  it("PostToolUse for a non-Bash tool returns the {} no-op shape, even with a matching watchedCommands config", () => {
    writeFileSync(join(storageRoot, ".raiminiscence.config.json"), JSON.stringify({ watchedCommands: ["tsc"] }));

    const output = invokeShim({
      hook_event_name: "PostToolUse",
      cwd: storageRoot,
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: "/tmp/x.ts" },
      tool_response: { filePath: "/tmp/x.ts", type: "create" },
    });
    expect(output).toEqual({});
  });

  it("malformed JSON falls back to the {} no-op shape without throwing", () => {
    const stdout = execFileSync("node", [SHIM_PATH], { cwd: SHIM_CWD, input: "{not valid json", encoding: "utf8" });
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("schema-invalid JSON (tool_input as a string instead of an object) falls back to the {} no-op shape", () => {
    writeFileSync(join(storageRoot, ".raiminiscence.config.json"), JSON.stringify({ watchedCommands: ["tsc"] }));

    const stdout = execFileSync("node", [SHIM_PATH], {
      cwd: SHIM_CWD,
      input: JSON.stringify({
        hook_event_name: "PostToolUseFailure",
        cwd: storageRoot,
        session_id: "s1",
        tool_name: "Bash",
        tool_input: "tsc --noEmit",
        error: "Exit code 2\nsomething broke",
      }),
      encoding: "utf8",
    });

    expect(JSON.parse(stdout)).toEqual({});
  });

  it("a Watched Command's failure (PostToolUseFailure) then success (PostToolUse) injects the isError:true nudge via additionalContext", () => {
    writeFileSync(join(storageRoot, ".raiminiscence.config.json"), JSON.stringify({ watchedCommands: ["tsc"] }));
    const sessionId = "s1";

    const failureOutput = invokeShim({
      hook_event_name: "PostToolUseFailure",
      cwd: storageRoot,
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "tsc --noEmit" },
      error: "Exit code 2\nTS2322: Type 'string' is not assignable to type 'number'.",
    });
    expect(failureOutput).toEqual({});

    const successOutput = invokeShim({
      hook_event_name: "PostToolUse",
      cwd: storageRoot,
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "tsc --noEmit" },
      tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false },
    }) as { hookSpecificOutput: { additionalContext: string } };

    expect(successOutput.hookSpecificOutput.additionalContext).toContain("tsc --noEmit");
    expect(successOutput.hookSpecificOutput.additionalContext).toContain("TS2322");
    expect(successOutput.hookSpecificOutput.additionalContext).toContain("isError: true");
  });
});

/**
 * Provenance for `sessionStart`: structurally-reasoned, not independently
 * confirmed against a live Cursor install — Cursor's `sessionStart` hook is
 * shell-command-only and fire-and-forget, the same shape as Claude Code's
 * `SessionStart`, per ADR-0005 and `packages/raiminiscence-hooks/README.md`'s
 * Cursor section; this fixture assumes the same `cwd`/`hook_event_name`
 * stdin shape `shim.ts` already expects, since no primary doc pins down
 * Cursor's exact field names the way Claude Code's docs do.
 *
 * Provenance for `stop`: checked against Cursor's own published hooks
 * documentation (`hook_event_name`, `conversation_id`, `loop_count`,
 * `followup_message`, `loop_limit` default `5`), per
 * `packages/raiminiscence-hooks/README.md`'s Cursor section — a stronger
 * footing than `sessionStart` above.
 */
describe("shim binary contract: Cursor", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-shim-contract-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("sessionStart with no standing memories returns the {} no-op shape", () => {
    const output = invokeShim({ hook_event_name: "sessionStart", cwd: storageRoot });
    expect(output).toEqual({});
  });

  it("sessionStart with a standing memory returns hookSpecificOutput.additionalContext", async () => {
    await seedDecisionMemory(storageRoot);

    const output = invokeShim({ hook_event_name: "sessionStart", cwd: storageRoot }) as {
      hookSpecificOutput: { additionalContext: string };
    };

    expect(output.hookSpecificOutput.additionalContext).toContain("Postgres");
  });

  it("stop returns {} on the not-yet-due debounce path (a conversation's first stop event)", () => {
    const output = invokeShim({ hook_event_name: "stop", cwd: storageRoot, conversation_id: "c1" });
    expect(output).toEqual({});
  });

  it("stop returns the followup_message shape (no decision/reason) on the due path", () => {
    const conversationId = "c1";
    const statePath = join(storageRoot, ".raiminiscence", "hooks-state", "checkpoint-nudge", `${conversationId}.json`);
    mkdirSync(dirname(statePath), { recursive: true });
    const overdueLastNudge = new Date(Date.now() - CHECKPOINT_NUDGE_INTERVAL_MS - 1000).toISOString();
    writeFileSync(statePath, JSON.stringify({ lastNudgeAt: overdueLastNudge, turnsSinceNudge: 0 }));

    const output = invokeShim({ hook_event_name: "stop", cwd: storageRoot, conversation_id: conversationId }) as {
      decision?: string;
      reason?: string;
      followup_message?: string;
    };

    expect(output.followup_message).toMatch(/checkpoint/i);
    expect(output.decision).toBeUndefined();
    expect(output.reason).toBeUndefined();
  });
});

/**
 * Provenance for both fixtures below: mostly structurally-reasoned, not
 * doc-confirmed — Codex CLI's own docs warn its `SessionStart` hook may run
 * before an MCP server is ready (hence this project's deliberate choice of
 * the plain `command` handler, not `mcp_tool`, per ADR-0005), but
 * don't pin down the exact stdin JSON field names the way Claude Code's
 * docs do. Both fixtures assume the same `hook_event_name`/`cwd`/`prompt`/
 * `session_id` shape `shim.ts` already expects for these two event names —
 * the same generic shape Claude Code sends, per ADR-0005's finding that the
 * shim mechanism is identical across clients bar config format.
 */
describe("shim binary contract: Codex CLI", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-shim-contract-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("SessionStart with no standing memories returns the {} no-op shape", () => {
    const output = invokeShim({ hook_event_name: "SessionStart", cwd: storageRoot, session_id: "s1" });
    expect(output).toEqual({});
  });

  it("SessionStart with a standing memory returns hookSpecificOutput.additionalContext", async () => {
    await seedDecisionMemory(storageRoot);

    const output = invokeShim({ hook_event_name: "SessionStart", cwd: storageRoot, session_id: "s1" }) as {
      hookSpecificOutput: { additionalContext: string };
    };

    expect(output.hookSpecificOutput.additionalContext).toContain("Postgres");
  });

  it("UserPromptSubmit with no matching memories returns the {} no-op shape", () => {
    const output = invokeShim({ hook_event_name: "UserPromptSubmit", cwd: storageRoot, prompt: "what database are we using?", session_id: "s1" });
    expect(output).toEqual({});
  });

  it("UserPromptSubmit with a matching memory returns hookSpecificOutput.additionalContext", async () => {
    await seedDecisionMemory(storageRoot);

    const output = invokeShim({
      hook_event_name: "UserPromptSubmit",
      cwd: storageRoot,
      prompt: "what database write model are we using",
      session_id: "s1",
    }) as { hookSpecificOutput: { additionalContext: string } };

    expect(output.hookSpecificOutput.additionalContext).toContain("Postgres");
  });
});
