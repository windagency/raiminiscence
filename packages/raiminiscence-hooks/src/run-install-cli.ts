import {
  FIX_NUDGE_HOOK_CLIENTS,
  HOOK_CLIENTS,
  PROMPT_RECALL_HOOK_CLIENTS,
  SESSION_END_HOOK_CLIENTS,
  STOP_HOOK_CLIENTS,
  installFixNudgeHook,
  installHook,
  installPromptRecallHook,
  installSessionEndHook,
  installStopHook,
  type HookClient,
  type InstallResult,
  type InstallScope,
} from "./install.js";
import { flag, parseAllowedValue } from "raiminiscence-argv";

const INSTALL_SCOPES: InstallScope[] = ["project", "user"];

/** Validates a `--name=value` flag (or its default) against a fixed set of allowed values. Mirrors raiminiscence-cli's args.ts `parseEnumFlag`. */
function parseEnumFlag<T extends string>(argv: string[], name: string, allowed: readonly T[], fallback: T): T {
  const raw = flag(argv, name) ?? fallback;
  const value = parseAllowedValue(raw, allowed);
  if (value === undefined) {
    throw new Error(`Unknown --${name} "${raw}" — expected one of ${allowed.join(", ")}.`);
  }
  return value;
}

function parseArgs(argv: string[]): { client: HookClient; scope: InstallScope } {
  return {
    client: parseEnumFlag(argv, "client", HOOK_CLIENTS, "claude-code"),
    scope: parseEnumFlag(argv, "scope", INSTALL_SCOPES, "project"),
  };
}

interface HookInstaller {
  name: string;
  attempt(client: string, scope: InstallScope, projectRoot: string): string;
}

/**
 * Wraps one `install*Hook` function together with its own client allowlist,
 * so the "is this client supported?" check and the narrowing of `client`
 * from `string` down to that installer's own client union happen in the
 * same place, atomically — never a check in one closure and a same-shaped
 * cast trusted to match it in another.
 */
function makeHookInstaller<C extends HookClient>(
  name: string,
  clients: readonly C[],
  install: (client: C, scope: InstallScope, projectRoot: string) => InstallResult,
): HookInstaller {
  const allowed: ReadonlySet<string> = new Set(clients);
  return {
    name,
    attempt(client, scope, projectRoot) {
      if (!allowed.has(client)) {
        return `raiminiscence-hooks: ${name} hook not supported for ${client}, skipped`;
      }
      const { configPath, alreadyInstalled } = install(client as C, scope, projectRoot);
      return alreadyInstalled
        ? `raiminiscence-hooks: ${name} hook already installed in ${configPath}`
        : `raiminiscence-hooks: installed ${name} hook into ${configPath}`;
    },
  };
}

/**
 * Every hook `raiminiscence-hooks-install` ships, in the order attempted.
 * Adding a new hook in a future version means adding one entry here — the
 * single place `main()`'s hook list lives, so a new `install*Hook` function
 * can't again go unwired the way prompt-recall/SessionEnd/Stop/Fix Nudge did.
 */
const HOOK_INSTALLERS: HookInstaller[] = [
  makeHookInstaller("SessionStart", HOOK_CLIENTS, installHook),
  makeHookInstaller("prompt-recall", PROMPT_RECALL_HOOK_CLIENTS, installPromptRecallHook),
  makeHookInstaller("SessionEnd", SESSION_END_HOOK_CLIENTS, installSessionEndHook),
  makeHookInstaller("Stop", STOP_HOOK_CLIENTS, installStopHook),
  makeHookInstaller("Fix Nudge", FIX_NUDGE_HOOK_CLIENTS, installFixNudgeHook),
];

/**
 * `raiminiscence-hooks-install`'s actual work, factored out of the bin entry
 * point so it's callable against a fixture project root in tests without
 * spawning a real process. Attempts every hook this client supports in one
 * run; a hook unsupported by the resolved client is reported and skipped,
 * never an error.
 */
export function runInstallCli(argv: string[], projectRoot: string = process.cwd()): string[] {
  const { client, scope } = parseArgs(argv);
  return HOOK_INSTALLERS.map((hook) => hook.attempt(client, scope, projectRoot));
}
