import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { smolTomlAdapter, type TomlConfig } from "./adapters/toml-config.js";
import { parseHookConfig, type HookConfig, type HookEntry } from "./hook-config-schema.js";

export type HookClient = "claude-code" | "cursor" | "codex";
export type InstallScope = "project" | "user";

export const HOOK_CLIENTS: HookClient[] = ["claude-code", "cursor", "codex"];

/** Clients whose per-turn hook can inject context back into a turn (Cursor's `beforeSubmitPrompt` can only allow/block). */
export type PromptRecallHookClient = "claude-code" | "codex";

export const PROMPT_RECALL_HOOK_CLIENTS: PromptRecallHookClient[] = ["claude-code", "codex"];

/** v11 (ADR-0017): clients with a documented `SessionEnd` hook event to flush Shared Memory from. */
export type SessionEndHookClient = "claude-code";

export const SESSION_END_HOOK_CLIENTS: SessionEndHookClient[] = ["claude-code"];

/** v13 (ADR-0020): clients whose `Stop`/`stop` hook can still prompt the agent for one more action — Codex CLI's equivalent isn't reliable yet. */
export type StopHookClient = "claude-code" | "cursor";

export const STOP_HOOK_CLIENTS: StopHookClient[] = ["claude-code", "cursor"];

export interface InstallResult {
  configPath: string;
  alreadyInstalled: boolean;
}

/**
 * The shim by absolute path, run by `node`. `npx raiminiscence-hooks-shim` found
 * it only when npm had installed this package globally; a pnpm, Yarn or Bun
 * install left every hook failing. `node` keeps it runnable on Windows, where
 * a `.js` file isn't executable.
 */
const SHIM_COMMAND = `node "${fileURLToPath(new URL("./shim.js", import.meta.url))}"`;

/** A shim command an earlier install wrote: the old `npx` form, or this package's shim at a path it has since left. */
function isPreviousShimCommand(command: unknown): boolean {
  return (
    command !== SHIM_COMMAND &&
    typeof command === "string" &&
    (command === "npx raiminiscence-hooks-shim" || /^node ".*raiminiscence-hooks[\\/](dist|src)[\\/]shim\.js"$/.test(command))
  );
}

/** Points every previous shim command in `entries` at the current one, in place. Whether any changed. */
function updatePreviousShimCommands(entries: HookEntry[]): boolean {
  let changed = false;
  for (const target of entries.flatMap((entry) => [entry, ...(entry.hooks ?? [])])) {
    if (isPreviousShimCommand(target.command)) {
      target.command = SHIM_COMMAND;
      changed = true;
    }
  }
  return changed;
}

/** Each client's own hook config file, relative to the install root (`[directory, filename]`). */
const HOOK_CONFIG_RELATIVE_PATH: Record<HookClient, [string, string]> = {
  "claude-code": [".claude", "settings.json"],
  cursor: [".cursor", "hooks.json"],
  codex: [".codex", "config.toml"],
};

/** Where each client's own hook config file lives, at each install scope. */
export function hookConfigPath(client: HookClient, scope: InstallScope, projectRoot: string = process.cwd()): string {
  const root = scope === "project" ? projectRoot : homedir();
  return join(root, ...HOOK_CONFIG_RELATIVE_PATH[client]);
}

/**
 * The `hookConfigPath` lookup → per-hook installer-map lookup → `InstallResult`
 * dance every public installer wrapper below repeats verbatim except for its
 * own client type and installer map. `C extends HookClient` so this works for
 * both the full `HookClient` union (`installHook`) and each narrower
 * per-feature client union (`installPromptRecallHook` and friends).
 */
function runInstaller<C extends HookClient>(
  map: Record<C, (path: string) => boolean>,
  client: C,
  scope: InstallScope,
  projectRoot: string,
): InstallResult {
  const configPath = hookConfigPath(client, scope, projectRoot);
  const alreadyInstalled = map[client](configPath);
  return { configPath, alreadyInstalled };
}

/**
 * Every public per-feature installer below (`installHook`,
 * `installPromptRecallHook`, ...) is this same `(client, scope?, projectRoot?)
 * => runInstaller(map, client, scope, projectRoot)` shape, differing only in
 * which installer map it closes over — so each is this factory applied to
 * its own map, instead of five hand-written, verbatim-except-for-the-map
 * function bodies.
 */
function makeInstaller<C extends HookClient>(
  map: Record<C, (path: string) => boolean>,
): (client: C, scope?: InstallScope, projectRoot?: string) => InstallResult {
  return (client: C, scope: InstallScope = "project", projectRoot: string = process.cwd()) => runInstaller(map, client, scope, projectRoot);
}

function readJsonConfig(path: string): HookConfig {
  return existsSync(path) ? parseHookConfig(JSON.parse(readFileSync(path, "utf8")), path) : {};
}

function writeJsonConfig(path: string, config: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Whether any entry in a hook array already invokes the shim command — each
 * client shapes its entries differently (a flat `command` field for Cursor,
 * a nested `hooks[].command` for Claude Code/Codex), so the caller supplies
 * `commandsOf` to extract that entry's command(s).
 */
function containsShimCommand(entries: HookEntry[], commandsOf: (entry: HookEntry) => unknown[]): boolean {
  return entries.some((entry) => commandsOf(entry).includes(SHIM_COMMAND));
}

/** `commandsOf` for Claude Code's and Codex's shared nested shape: an entry's `hooks[]` array, each with its own `command` field. */
function nestedHookCommandsOf(entry: HookEntry): unknown[] {
  return (entry.hooks ?? []).map((hook) => hook.command);
}

/**
 * The read-config → ensure `eventKey`'s hook array exists → check via
 * `commandsOf` → push `entry` → write dance every JSON-based, single-array
 * client installer below repeats verbatim except for its config shape.
 * `configure` runs first, for a caller (Cursor) that must also stamp a
 * top-level field like `version` unconditionally, installed or not.
 */
function registerHookEntry(
  path: string,
  eventKey: string,
  entry: HookEntry,
  commandsOf: (entry: HookEntry) => unknown[],
  configure?: (config: HookConfig) => void,
): boolean {
  const config = readJsonConfig(path);
  configure?.(config);
  config.hooks ??= {};
  const entries = (config.hooks[eventKey] ??= []);
  const updated = updatePreviousShimCommands(entries);

  if (containsShimCommand(entries, commandsOf)) {
    if (updated) writeJsonConfig(path, config);
    return !updated;
  }

  entries.push(entry);
  writeJsonConfig(path, config);
  return false;
}

/**
 * TOML counterpart to `registerHookEntry` for Codex's config shape — same
 * dance, but read/written via the injected `TomlConfig` adapter instead of
 * `JSON.parse`/`JSON.stringify`, since Codex can't unify with the two
 * JSON-based clients without distorting one shape or the other.
 */
function registerTomlHookEntry(
  path: string,
  eventKey: string,
  entry: HookEntry,
  commandsOf: (entry: HookEntry) => unknown[],
  toml: TomlConfig,
): boolean {
  const config = existsSync(path) ? parseHookConfig(toml.parse(readFileSync(path, "utf8")), path) : {};
  config.hooks ??= {};
  const entries = config.hooks[eventKey] ?? [];
  const updated = updatePreviousShimCommands(entries);
  const installed = containsShimCommand(entries, commandsOf);
  if (installed && !updated) {
    return true;
  }

  config.hooks[eventKey] = installed ? entries : [...entries, entry];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toml.stringify(config), "utf8");
  return false;
}

/**
 * Merges the SessionStart hook registration into an existing Claude Code
 * `settings.json` (or creates one) without disturbing any other key
 * already there. Idempotent: a second install call is a no-op.
 */
function installClaudeCode(path: string): boolean {
  return registerHookEntry(
    path,
    "SessionStart",
    { matcher: "startup|resume|clear|compact|fork", hooks: [{ type: "command", command: SHIM_COMMAND }] },
    nestedHookCommandsOf,
  );
}

function installCursor(path: string): boolean {
  return registerHookEntry(
    path,
    "sessionStart",
    { command: SHIM_COMMAND },
    (entry) => [entry.command],
    (config) => {
      config.version ??= 1;
    },
  );
}

export function installCodex(path: string, toml: TomlConfig = smolTomlAdapter): boolean {
  return registerTomlHookEntry(
    path,
    "SessionStart",
    { matcher: "startup|resume", hooks: [{ type: "command", command: SHIM_COMMAND, statusMessage: "Loading rAIminiscence memory primer" }] },
    nestedHookCommandsOf,
    toml,
  );
}

const INSTALLERS: Record<HookClient, (path: string) => boolean> = {
  "claude-code": installClaudeCode,
  cursor: installCursor,
  codex: installCodex,
};

/**
 * Writes the SessionStart hook registration directly into the target
 * client's own config file, so a developer never hand-merges the snippet
 * themselves. Safe to call repeatedly: an existing registration for the
 * shim command is left untouched rather than duplicated.
 */
export const installHook = makeInstaller(INSTALLERS);

/**
 * Merges the per-turn auto-recall `UserPromptSubmit` hook registration into
 * an existing Claude Code `settings.json` (or creates one) without
 * disturbing any other key already there. Unlike `SessionStart`, no
 * `matcher` is used — `UserPromptSubmit` fires unconditionally on every
 * prompt. Idempotent: a second install call is a no-op.
 */
function installClaudeCodePromptRecall(path: string): boolean {
  return registerHookEntry(path, "UserPromptSubmit", { hooks: [{ type: "command", command: SHIM_COMMAND }] }, nestedHookCommandsOf);
}

export function installCodexPromptRecall(path: string, toml: TomlConfig = smolTomlAdapter): boolean {
  return registerTomlHookEntry(
    path,
    "UserPromptSubmit",
    { hooks: [{ type: "command", command: SHIM_COMMAND, statusMessage: "Recalling relevant memory" }] },
    nestedHookCommandsOf,
    toml,
  );
}

const PROMPT_RECALL_INSTALLERS: Record<PromptRecallHookClient, (path: string) => boolean> = {
  "claude-code": installClaudeCodePromptRecall,
  codex: installCodexPromptRecall,
};

/**
 * Writes the per-turn auto-recall `UserPromptSubmit` hook registration into
 * the target client's own config file. Restricted to `PromptRecallHookClient`
 * (`"claude-code" | "codex"`) at the type level — Cursor has no per-turn
 * hook capable of injecting context, so a caller can't even attempt to
 * install this one for Cursor. Idempotent, matching `installHook`.
 */
export const installPromptRecallHook = makeInstaller(PROMPT_RECALL_INSTALLERS);

/**
 * Merges the v11 (ADR-0017) `SessionEnd` hook registration — flushes Shared
 * Memory (commit + push) at session end — into an existing Claude Code
 * `settings.json` (or creates one). Idempotent, matching `installHook`.
 */
function installClaudeCodeSessionEnd(path: string): boolean {
  return registerHookEntry(path, "SessionEnd", { hooks: [{ type: "command", command: SHIM_COMMAND }] }, nestedHookCommandsOf);
}

const SESSION_END_INSTALLERS: Record<SessionEndHookClient, (path: string) => boolean> = {
  "claude-code": installClaudeCodeSessionEnd,
};

/**
 * Writes the `SessionEnd` hook registration into the target client's own
 * config file. Restricted to `SessionEndHookClient` (`"claude-code"` only)
 * at the type level — no other client's `SessionEnd` (or equivalent) hook
 * support is confirmed. Idempotent, matching `installHook`.
 */
export const installSessionEndHook = makeInstaller(SESSION_END_INSTALLERS);

/**
 * Merges the v13 (ADR-0020) `Stop` hook registration — the debounced
 * checkpoint nudge — into an existing Claude Code `settings.json` (or
 * creates one). Idempotent, matching `installHook`.
 */
function installClaudeCodeStop(path: string): boolean {
  return registerHookEntry(path, "Stop", { hooks: [{ type: "command", command: SHIM_COMMAND }] }, nestedHookCommandsOf);
}

/**
 * Merges the v13 (ADR-0020) `stop` hook registration into an existing
 * Cursor `hooks.json` (or creates one). Idempotent, matching `installHook`.
 */
function installCursorStop(path: string): boolean {
  return registerHookEntry(
    path,
    "stop",
    { command: SHIM_COMMAND },
    (entry) => [entry.command],
    (config) => {
      config.version ??= 1;
    },
  );
}

const STOP_INSTALLERS: Record<StopHookClient, (path: string) => boolean> = {
  "claude-code": installClaudeCodeStop,
  cursor: installCursorStop,
};

/**
 * Writes the `Stop`/`stop` hook registration (v13, ADR-0020: the debounced
 * checkpoint nudge) into the target client's own config file. Restricted to
 * `StopHookClient` (`"claude-code" | "cursor"`) at the type level — Codex
 * CLI's `Stop`-hook continuation isn't reliable yet, mirroring
 * `PromptRecallHookClient`'s own client restriction. Idempotent, matching
 * `installHook`.
 */
export const installStopHook = makeInstaller(STOP_INSTALLERS);

/** v18 (ADR-0023): Fix Nudge's `PostToolUse`/`PostToolUseFailure` hooks — Claude Code only; Cursor's and Codex CLI's equivalents aren't confirmed yet. */
export type FixNudgeHookClient = "claude-code";

export const FIX_NUDGE_HOOK_CLIENTS: FixNudgeHookClient[] = ["claude-code"];

/**
 * Merges the v18 (ADR-0023) `PostToolUse`/`PostToolUseFailure` hook
 * registrations — Fix Nudge — into an existing Claude Code `settings.json`
 * (or creates one). Unlike `SessionStart`, no `matcher` is used: Fix Nudge
 * itself restricts to the `Bash` tool internally (`shim.ts`), so every tool
 * call still reaches the shim, which then no-ops on anything else. Two
 * events, not one, since Claude Code has no single event covering both a
 * Bash command's success and failure. Idempotent, matching `installHook`.
 *
 * Not expressed via `registerHookEntry`: its already-installed check ANDs
 * both arrays together and its write is one atomic file write covering
 * both, which two independent `registerHookEntry` calls (two separate
 * reads/writes, two independent booleans) can't reproduce without changing
 * that behaviour.
 */
function installClaudeCodePostToolUse(path: string): boolean {
  const config = readJsonConfig(path);
  config.hooks ??= {};
  config.hooks.PostToolUse ??= [];
  config.hooks.PostToolUseFailure ??= [];
  const postToolUse = config.hooks.PostToolUse;
  const postToolUseFailure = config.hooks.PostToolUseFailure;
  const updated = [postToolUse, postToolUseFailure].map(updatePreviousShimCommands).includes(true);

  const postToolUseInstalled = containsShimCommand(postToolUse, nestedHookCommandsOf);
  const postToolUseFailureInstalled = containsShimCommand(postToolUseFailure, nestedHookCommandsOf);

  if (postToolUseInstalled && postToolUseFailureInstalled && !updated) return true;

  if (!postToolUseInstalled) {
    postToolUse.push({ hooks: [{ type: "command", command: SHIM_COMMAND }] });
  }
  if (!postToolUseFailureInstalled) {
    postToolUseFailure.push({ hooks: [{ type: "command", command: SHIM_COMMAND }] });
  }
  writeJsonConfig(path, config);
  return false;
}

const FIX_NUDGE_INSTALLERS: Record<FixNudgeHookClient, (path: string) => boolean> = {
  "claude-code": installClaudeCodePostToolUse,
};

/**
 * Writes the `PostToolUse`/`PostToolUseFailure` hook registrations (v18,
 * ADR-0023: Fix Nudge) into the target client's own config file. Restricted
 * to `FixNudgeHookClient` (`"claude-code"` only) at the type level — Cursor
 * and Codex CLI installs are completely unaffected, so picking up support
 * for either later doesn't require re-deriving what already works here.
 * Idempotent, matching `installHook`.
 */
export const installFixNudgeHook = makeInstaller(FIX_NUDGE_INSTALLERS);
