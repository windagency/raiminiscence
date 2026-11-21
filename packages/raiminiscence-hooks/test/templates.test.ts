import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

function templatePath(relative: string): string {
  return fileURLToPath(new URL(`../src/templates/${relative}`, import.meta.url));
}

describe("Claude Code settings snippet template", () => {
  it("is valid JSON matching the documented SessionStart hook shape", () => {
    const parsed = JSON.parse(readFileSync(templatePath("claude-code/settings-snippet.json"), "utf8"));

    expect(parsed.hooks.SessionStart[0].hooks[0]).toEqual({
      type: "command",
      command: "npx raiminiscence-hooks-shim",
    });
    expect(parsed.hooks.SessionStart[0].matcher).toContain("startup");
  });

  it("gains a UserPromptSubmit entry invoking the shim command, with no matcher", () => {
    const parsed = JSON.parse(readFileSync(templatePath("claude-code/settings-snippet.json"), "utf8"));

    expect(parsed.hooks.UserPromptSubmit[0].hooks[0]).toEqual({
      type: "command",
      command: "npx raiminiscence-hooks-shim",
    });
    expect(parsed.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
  });

  it("gains a Stop entry invoking the shim command (v13, ADR-0020: the checkpoint nudge)", () => {
    const parsed = JSON.parse(readFileSync(templatePath("claude-code/settings-snippet.json"), "utf8"));

    expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "npx raiminiscence-hooks-shim",
    });
  });

  it("gains PostToolUse and PostToolUseFailure entries invoking the shim command (v18, ADR-0023: Fix Nudge)", () => {
    const parsed = JSON.parse(readFileSync(templatePath("claude-code/settings-snippet.json"), "utf8"));

    expect(parsed.hooks.PostToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "npx raiminiscence-hooks-shim",
    });
    expect(parsed.hooks.PostToolUseFailure[0].hooks[0]).toEqual({
      type: "command",
      command: "npx raiminiscence-hooks-shim",
    });
  });
});

describe("Cursor hooks snippet template", () => {
  it("is valid JSON matching Cursor's documented sessionStart hook shape", () => {
    const parsed = JSON.parse(readFileSync(templatePath("cursor/hooks-snippet.json"), "utf8"));

    expect(parsed.hooks.sessionStart[0]).toEqual({ command: "npx raiminiscence-hooks-shim" });
  });

  it("has no UserPromptSubmit-equivalent key — Cursor's per-turn hook can't inject context", () => {
    const parsed = JSON.parse(readFileSync(templatePath("cursor/hooks-snippet.json"), "utf8"));

    expect(parsed.hooks.UserPromptSubmit).toBeUndefined();
    expect(parsed.hooks.beforeSubmitPrompt).toBeUndefined();
  });

  it("gains a stop entry invoking the shim command (v13, ADR-0020: the checkpoint nudge)", () => {
    const parsed = JSON.parse(readFileSync(templatePath("cursor/hooks-snippet.json"), "utf8"));

    expect(parsed.hooks.stop[0]).toEqual({ command: "npx raiminiscence-hooks-shim" });
  });
});

describe("Codex CLI hooks snippet template", () => {
  it("is valid TOML matching Codex's documented SessionStart hook shape", () => {
    const parsed = parseToml(readFileSync(templatePath("codex/hooks-snippet.toml"), "utf8")) as {
      hooks: { SessionStart: { matcher: string; hooks: { type: string; command: string }[] }[] };
    };

    const sessionStart = parsed.hooks.SessionStart[0]!;
    expect(sessionStart.matcher).toContain("startup");
    expect(sessionStart.hooks[0]!.type).toBe("command");
    expect(sessionStart.hooks[0]!.command).toBe("npx raiminiscence-hooks-shim");
  });

  it("gains a UserPromptSubmit entry invoking the shim command, with no matcher", () => {
    const parsed = parseToml(readFileSync(templatePath("codex/hooks-snippet.toml"), "utf8")) as {
      hooks: { UserPromptSubmit: { matcher?: string; hooks: { type: string; command: string }[] }[] };
    };

    const userPromptSubmit = parsed.hooks.UserPromptSubmit[0]!;
    expect(userPromptSubmit.matcher).toBeUndefined();
    expect(userPromptSubmit.hooks[0]!.type).toBe("command");
    expect(userPromptSubmit.hooks[0]!.command).toBe("npx raiminiscence-hooks-shim");
  });
});

describe("cross-client consistency", () => {
  it("every template invokes the exact same shim command", () => {
    const claudeCode = JSON.parse(readFileSync(templatePath("claude-code/settings-snippet.json"), "utf8"));
    const cursor = JSON.parse(readFileSync(templatePath("cursor/hooks-snippet.json"), "utf8"));
    const codex = parseToml(readFileSync(templatePath("codex/hooks-snippet.toml"), "utf8")) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[] };
    };

    const commands = [
      claudeCode.hooks.SessionStart[0].hooks[0].command,
      cursor.hooks.sessionStart[0].command,
      codex.hooks.SessionStart[0]!.hooks[0]!.command,
    ];

    expect(new Set(commands).size).toBe(1);
    expect(commands[0]).toBe("npx raiminiscence-hooks-shim");
  });
});
