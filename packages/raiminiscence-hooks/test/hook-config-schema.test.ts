import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHookConfig } from "#src/hook-config-schema.js";
import { installCodex, installFixNudgeHook, installHook } from "#src/install.js";

describe("parseHookConfig", () => {
  it("keeps every key a client's config already has, hook-related or not", () => {
    const config = {
      model: "opus",
      hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "other", timeout: 5 }] }], Custom: [{ command: "x" }] },
    };
    expect(parseHookConfig(config, "settings.json")).toEqual(config);
  });

  it("accepts a config with no hooks key at all", () => {
    expect(parseHookConfig({ version: 1 }, "hooks.json")).toEqual({ version: 1 });
  });

  it.each([
    ["a non-object config", ["not", "a", "config"]],
    ["a hooks key that isn't an object", { hooks: "SessionStart" }],
    ["a hook event that isn't an array", { hooks: { SessionStart: { command: "x" } } }],
    ["a hook entry that isn't an object", { hooks: { SessionStart: ["npx thing"] } }],
    ["an entry whose nested hooks isn't an array", { hooks: { SessionStart: [{ hooks: "x" }] } }],
  ])("rejects %s, naming the file", (_label, payload) => {
    expect(() => parseHookConfig(payload, "/home/me/.claude/settings.json")).toThrow(/\/home\/me\/\.claude\/settings\.json/);
  });
});

describe("installers on a malformed client config", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hook-config-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it.each([
    ["installHook", () => installHook("claude-code", "project", projectRoot)],
    ["installFixNudgeHook", () => installFixNudgeHook("claude-code", "project", projectRoot)],
  ])("%s refuses to rewrite a Claude Code settings.json whose hooks key is malformed, leaving it unchanged", (_label, install) => {
    const path = join(projectRoot, ".claude", "settings.json");
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    const original = JSON.stringify({ hooks: "broken" });
    writeFileSync(path, original);

    expect(install).toThrow(/unexpected shape/);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("installCodex refuses to rewrite a config.toml whose hook event is malformed, leaving it unchanged", () => {
    const path = join(projectRoot, "config.toml");
    const original = '[hooks]\nSessionStart = "broken"\n';
    writeFileSync(path, original);

    expect(() => installCodex(path)).toThrow(/unexpected shape/);
    expect(readFileSync(path, "utf8")).toBe(original);
  });
});
