import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hookConfigPath,
  installCodex,
  installFixNudgeHook,
  installHook,
  installPromptRecallHook,
  installSessionEndHook,
  installStopHook,
  type FixNudgeHookClient,
  type PromptRecallHookClient,
} from "#src/install.js";
import type { TomlConfig } from "#src/adapters/toml-config.js";

/** The installer names the shim by absolute path, so it runs however the package was installed; from source, that is `src/`. */
const SHIM_COMMAND = `node "${fileURLToPath(new URL("../src/shim.js", import.meta.url))}"`;

describe("installHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hooks-install-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes the SessionStart hook into a fresh Claude Code settings.json", () => {
    const result = installHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.configPath).toBe(join(projectRoot, ".claude", "settings.json"));
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.SessionStart[0].hooks[0]).toEqual({ type: "command", command: SHIM_COMMAND });
    expect(written.hooks.SessionStart[0].matcher).toContain("startup");
  });

  it("is idempotent: a second install reports alreadyInstalled and doesn't duplicate the entry", () => {
    installHook("claude-code", "project", projectRoot);
    const second = installHook("claude-code", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
    const written = JSON.parse(readFileSync(second.configPath, "utf8"));
    expect(written.hooks.SessionStart).toHaveLength(1);
  });

  it("merges into an existing settings.json without disturbing unrelated keys", () => {
    const configDir = join(projectRoot, ".claude");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "settings.json");
    writeFileSync(configPath, JSON.stringify({ someOtherSetting: true, hooks: { PreToolUse: [] } }, null, 2));

    installHook("claude-code", "project", projectRoot);

    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.someOtherSetting).toBe(true);
    expect(written.hooks.PreToolUse).toEqual([]);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(SHIM_COMMAND);
  });

  it("writes the sessionStart hook into a fresh Cursor hooks.json", () => {
    const result = installHook("cursor", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.sessionStart).toEqual([{ command: SHIM_COMMAND }]);
  });

  it("writes a valid TOML SessionStart hook into a fresh Codex config.toml", () => {
    const result = installHook("codex", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    expect(existsSync(result.configPath)).toBe(true);
    const written = parseToml(readFileSync(result.configPath, "utf8")) as {
      hooks: { SessionStart: { matcher: string; hooks: { type: string; command: string }[] }[] };
    };
    expect(written.hooks.SessionStart[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
  });

  it("is idempotent for Codex's TOML config too", () => {
    installHook("codex", "project", projectRoot);
    const second = installHook("codex", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
  });

  it("resolves the user-scoped config path under the home directory, distinct from the project path", () => {
    const projectPath = hookConfigPath("claude-code", "project", projectRoot);
    const userPath = hookConfigPath("claude-code", "user", projectRoot);

    expect(projectPath).not.toBe(userPath);
    expect(projectPath.startsWith(projectRoot)).toBe(true);
  });

  it("installCodex uses an injected TomlConfig adapter instead of the real smol-toml module", () => {
    const configPath = join(projectRoot, ".codex", "config.toml");
    const store = new Map<string, unknown>();
    const fakeToml: TomlConfig = {
      parse: (text) => store.get(text),
      stringify: (value) => {
        const token = `fake-toml:${store.size}`;
        store.set(token, value);
        return token;
      },
    };

    const result = installCodex(configPath, fakeToml);

    expect(result).toBe(false);
    const written = readFileSync(configPath, "utf8");
    const config = store.get(written) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } };
    expect(config.hooks.SessionStart[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
  });
});

describe("installPromptRecallHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hooks-install-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes the UserPromptSubmit hook into a fresh Claude Code settings.json, with no matcher", () => {
    const result = installPromptRecallHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.configPath).toBe(join(projectRoot, ".claude", "settings.json"));
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.UserPromptSubmit[0].hooks[0]).toEqual({ type: "command", command: SHIM_COMMAND });
    expect(written.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
  });

  it("is idempotent for Claude Code: a second install reports alreadyInstalled and doesn't duplicate the entry", () => {
    installPromptRecallHook("claude-code", "project", projectRoot);
    const second = installPromptRecallHook("claude-code", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
    const written = JSON.parse(readFileSync(second.configPath, "utf8"));
    expect(written.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("merges the Claude Code UserPromptSubmit entry without disturbing unrelated keys, including the existing SessionStart hook", () => {
    installHook("claude-code", "project", projectRoot);
    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(configPath, "utf8")), someOtherSetting: true }, null, 2));

    installPromptRecallHook("claude-code", "project", projectRoot);

    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.someOtherSetting).toBe(true);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toBe(SHIM_COMMAND);
  });

  it("writes a valid TOML UserPromptSubmit hook into a fresh Codex config.toml, with no matcher", () => {
    const result = installPromptRecallHook("codex", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    expect(existsSync(result.configPath)).toBe(true);
    const written = parseToml(readFileSync(result.configPath, "utf8")) as {
      hooks: { UserPromptSubmit: { matcher?: string; hooks: { type: string; command: string; statusMessage?: string }[] }[] };
    };
    expect(written.hooks.UserPromptSubmit[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
    expect(written.hooks.UserPromptSubmit[0]!.matcher).toBeUndefined();
    expect(written.hooks.UserPromptSubmit[0]!.hooks[0]!.statusMessage).toBe("Recalling relevant memory");
  });

  it("is idempotent for Codex's TOML config too", () => {
    installPromptRecallHook("codex", "project", projectRoot);
    const second = installPromptRecallHook("codex", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
  });

  it("merges the Codex UserPromptSubmit entry without disturbing the existing SessionStart hook", () => {
    installHook("codex", "project", projectRoot);

    installPromptRecallHook("codex", "project", projectRoot);

    const configPath = hookConfigPath("codex", "project", projectRoot);
    const written = parseToml(readFileSync(configPath, "utf8")) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[]; UserPromptSubmit: { hooks: { command: string }[] }[] };
    };
    expect(written.hooks.SessionStart[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
    expect(written.hooks.UserPromptSubmit[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
  });

  it("merges into an existing Codex config.toml without disturbing an unrelated top-level key", () => {
    const configPath = hookConfigPath("codex", "project", projectRoot);
    mkdirSync(join(projectRoot, ".codex"), { recursive: true });
    writeFileSync(configPath, "someOtherSetting = true\n");

    installPromptRecallHook("codex", "project", projectRoot);

    const written = parseToml(readFileSync(configPath, "utf8")) as {
      someOtherSetting: boolean;
      hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] };
    };
    expect(written.someOtherSetting).toBe(true);
    expect(written.hooks.UserPromptSubmit[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
  });

  it("never writes to Cursor's hooks.json", () => {
    installPromptRecallHook("claude-code", "project", projectRoot);
    installPromptRecallHook("codex", "project", projectRoot);

    expect(existsSync(join(projectRoot, ".cursor", "hooks.json"))).toBe(false);
  });

  it("rejects 'cursor' as a client at the type level", () => {
    // @ts-expect-error "cursor" is not a PromptRecallHookClient
    const client: PromptRecallHookClient = "cursor";
    expect(client).toBe("cursor");
  });
});

describe("installSessionEndHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hooks-install-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes the SessionEnd hook into a fresh Claude Code settings.json", () => {
    const result = installSessionEndHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.SessionEnd[0].hooks[0]).toEqual({ type: "command", command: SHIM_COMMAND });
  });

  it("is idempotent: a second install reports alreadyInstalled and doesn't duplicate the entry", () => {
    installSessionEndHook("claude-code", "project", projectRoot);
    const second = installSessionEndHook("claude-code", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
    const written = JSON.parse(readFileSync(second.configPath, "utf8"));
    expect(written.hooks.SessionEnd).toHaveLength(1);
  });

  it("merges alongside the existing SessionStart hook without disturbing it", () => {
    installHook("claude-code", "project", projectRoot);

    installSessionEndHook("claude-code", "project", projectRoot);

    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.SessionEnd[0].hooks[0].command).toBe(SHIM_COMMAND);
  });
});

describe("installStopHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hooks-install-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes the Stop hook into a fresh Claude Code settings.json", () => {
    const result = installStopHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.Stop[0].hooks[0]).toEqual({ type: "command", command: SHIM_COMMAND });
  });

  it("is idempotent for Claude Code: a second install reports alreadyInstalled and doesn't duplicate the entry", () => {
    installStopHook("claude-code", "project", projectRoot);
    const second = installStopHook("claude-code", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
    const written = JSON.parse(readFileSync(second.configPath, "utf8"));
    expect(written.hooks.Stop).toHaveLength(1);
  });

  it("writes the stop hook into a fresh Cursor hooks.json", () => {
    const result = installStopHook("cursor", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.stop[0]).toEqual({ command: SHIM_COMMAND });
  });

  it("is idempotent for Cursor: a second install reports alreadyInstalled and doesn't duplicate the entry", () => {
    installStopHook("cursor", "project", projectRoot);
    const second = installStopHook("cursor", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
    const written = JSON.parse(readFileSync(second.configPath, "utf8"));
    expect(written.hooks.stop).toHaveLength(1);
  });

  it("merges alongside the existing SessionStart hook without disturbing it", () => {
    installHook("claude-code", "project", projectRoot);
    installStopHook("claude-code", "project", projectRoot);

    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.Stop[0].hooks[0].command).toBe(SHIM_COMMAND);
  });
});

describe("installFixNudgeHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hooks-install-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes both the PostToolUse and PostToolUseFailure hooks into a fresh Claude Code settings.json", () => {
    const result = installFixNudgeHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.hooks.PostToolUse[0].hooks[0]).toEqual({ type: "command", command: SHIM_COMMAND });
    expect(written.hooks.PostToolUseFailure[0].hooks[0]).toEqual({ type: "command", command: SHIM_COMMAND });
  });

  it("is idempotent: a second install reports alreadyInstalled and doesn't duplicate either entry", () => {
    installFixNudgeHook("claude-code", "project", projectRoot);
    const second = installFixNudgeHook("claude-code", "project", projectRoot);

    expect(second.alreadyInstalled).toBe(true);
    const written = JSON.parse(readFileSync(second.configPath, "utf8"));
    expect(written.hooks.PostToolUse).toHaveLength(1);
    expect(written.hooks.PostToolUseFailure).toHaveLength(1);
  });

  it("merges alongside the existing SessionStart hook without disturbing it", () => {
    installHook("claude-code", "project", projectRoot);
    installFixNudgeHook("claude-code", "project", projectRoot);

    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.PostToolUseFailure[0].hooks[0].command).toBe(SHIM_COMMAND);
  });

  it("never writes to Cursor's or Codex's config files", () => {
    installFixNudgeHook("claude-code", "project", projectRoot);

    expect(existsSync(join(projectRoot, ".cursor", "hooks.json"))).toBe(false);
    expect(existsSync(join(projectRoot, ".codex", "config.toml"))).toBe(false);
  });

  it("rejects 'cursor' as a client at the type level", () => {
    // @ts-expect-error "cursor" is not a FixNudgeHookClient
    const client: FixNudgeHookClient = "cursor";
    expect(client).toBe("cursor");
  });
});

describe("the shim command an install writes", () => {
  const LEGACY = "npx raiminiscence-hooks-shim";
  const STALE = 'node "/old/prefix/lib/node_modules/raiminiscence-hooks/dist/shim.js"';
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hooks-install-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeClaudeSettings(config: unknown): string {
    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  it.each([
    ["the npx command earlier versions wrote", LEGACY],
    ["an absolute path from an earlier install", STALE],
  ])("replaces %s in place, rather than adding a second entry", (_label, previous) => {
    const configPath = writeClaudeSettings({ hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: previous }] }] } });

    const result = installHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.hooks.SessionStart).toEqual([{ matcher: "startup", hooks: [{ type: "command", command: SHIM_COMMAND }] }]);
  });

  it("replaces the npx command in Cursor's flat entries", () => {
    const configPath = hookConfigPath("cursor", "project", projectRoot);
    mkdirSync(join(projectRoot, ".cursor"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: LEGACY }] } }));

    installHook("cursor", "project", projectRoot);

    expect(JSON.parse(readFileSync(configPath, "utf8")).hooks.sessionStart).toEqual([{ command: SHIM_COMMAND }]);
  });

  it("replaces the npx command in Codex's TOML config", () => {
    const configPath = hookConfigPath("codex", "project", projectRoot);
    mkdirSync(join(projectRoot, ".codex"), { recursive: true });
    writeFileSync(
      configPath,
      `[[hooks.SessionStart]]\nmatcher = "startup|resume"\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "${LEGACY}"\n`,
    );

    installHook("codex", "project", projectRoot);

    const written = parseToml(readFileSync(configPath, "utf8")) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } };
    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.SessionStart[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
  });

  it("replaces the npx command in both Fix Nudge events", () => {
    const legacyEntry = { hooks: [{ type: "command", command: LEGACY }] };
    const configPath = writeClaudeSettings({ hooks: { PostToolUse: [legacyEntry], PostToolUseFailure: [legacyEntry] } });

    const result = installFixNudgeHook("claude-code", "project", projectRoot);

    expect(result.alreadyInstalled).toBe(false);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.hooks.PostToolUse).toEqual([{ hooks: [{ type: "command", command: SHIM_COMMAND }] }]);
    expect(written.hooks.PostToolUseFailure).toEqual([{ hooks: [{ type: "command", command: SHIM_COMMAND }] }]);
  });

  it("leaves another tool's hook command alone", () => {
    const other = { hooks: [{ type: "command", command: 'node "/somewhere/else/dist/shim.js"' }] };
    const configPath = writeClaudeSettings({ hooks: { SessionStart: [other] } });

    installHook("claude-code", "project", projectRoot);

    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.hooks.SessionStart[0]).toEqual(other);
    expect(written.hooks.SessionStart[1].hooks[0].command).toBe(SHIM_COMMAND);
  });

  it("from the built package, names the built shim, which exists", () => {
    execFileSync(process.execPath, [fileURLToPath(new URL("../dist/install-cli.js", import.meta.url)), "--client=claude-code"], { cwd: projectRoot });

    const written = JSON.parse(readFileSync(hookConfigPath("claude-code", "project", projectRoot), "utf8"));
    const command: string = written.hooks.SessionStart[0].hooks[0].command;
    const shimPath = /^node "(.+)"$/.exec(command)?.[1];
    expect(shimPath).toBe(fileURLToPath(new URL("../dist/shim.js", import.meta.url)));
    expect(existsSync(shimPath!)).toBe(true);
  });
});
