import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookConfigPath } from "#src/install.js";
import { runInstallCli } from "#src/run-install-cli.js";

/** The installer names the shim by absolute path, so it runs however the package was installed; from source, that is `src/`. */
const SHIM_COMMAND = `node "${fileURLToPath(new URL("../src/shim.js", import.meta.url))}"`;

describe("runInstallCli", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-install-cli-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("claude-code: registers every supported hook in one run", () => {
    runInstallCli(["--client=claude-code"], projectRoot);

    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    const written = JSON.parse(readFileSync(configPath, "utf8"));

    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.SessionEnd[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.Stop[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.PostToolUseFailure[0].hooks[0].command).toBe(SHIM_COMMAND);
  });

  it("cursor: registers sessionStart and stop only, with no attempt at prompt-recall/SessionEnd/Fix-Nudge-shaped writes", () => {
    const lines = runInstallCli(["--client=cursor"], projectRoot);

    const configPath = hookConfigPath("cursor", "project", projectRoot);
    const written = JSON.parse(readFileSync(configPath, "utf8"));

    expect(written.hooks.sessionStart[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.stop[0].command).toBe(SHIM_COMMAND);
    expect(written.hooks.UserPromptSubmit).toBeUndefined();
    expect(written.hooks.SessionEnd).toBeUndefined();
    expect(written.hooks.PostToolUse).toBeUndefined();

    expect(lines.some((line) => line.includes("prompt-recall hook not supported for cursor"))).toBe(true);
    expect(lines.some((line) => line.includes("SessionEnd hook not supported for cursor"))).toBe(true);
    expect(lines.some((line) => line.includes("Fix Nudge hook not supported for cursor"))).toBe(true);
  });

  it("codex: registers SessionStart and UserPromptSubmit only, with no Stop/Fix-Nudge entries", () => {
    const lines = runInstallCli(["--client=codex"], projectRoot);

    const configPath = hookConfigPath("codex", "project", projectRoot);
    const written = parseToml(readFileSync(configPath, "utf8")) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[]; UserPromptSubmit: { hooks: { command: string }[] }[] };
    };

    expect(written.hooks.SessionStart[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
    expect(written.hooks.UserPromptSubmit[0]!.hooks[0]!.command).toBe(SHIM_COMMAND);
    expect((written.hooks as Record<string, unknown>).Stop).toBeUndefined();

    expect(lines.some((line) => line.includes("Stop hook not supported for codex"))).toBe(true);
    expect(lines.some((line) => line.includes("Fix Nudge hook not supported for codex"))).toBe(true);
  });

  it("is idempotent: a second run against an already-fully-installed project reports every hook already installed and makes no file changes", () => {
    runInstallCli(["--client=claude-code"], projectRoot);
    const configPath = hookConfigPath("claude-code", "project", projectRoot);
    const beforeSecondRun = readFileSync(configPath, "utf8");

    const secondRunLines = runInstallCli(["--client=claude-code"], projectRoot);

    expect(secondRunLines.every((line) => line.includes("already installed"))).toBe(true);
    expect(readFileSync(configPath, "utf8")).toBe(beforeSecondRun);
  });

  it("never writes a config file for a client's unsupported hooks", () => {
    runInstallCli(["--client=cursor"], projectRoot);

    expect(existsSync(join(projectRoot, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(projectRoot, ".codex", "config.toml"))).toBe(false);
  });
});
