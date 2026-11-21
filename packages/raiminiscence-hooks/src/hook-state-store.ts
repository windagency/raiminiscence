import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureGitignoreEntry } from "raiminiscence-mcp";
import { logHookError } from "./hook-utils.js";

/** Shared shape every hook's injectable, per-session on-disk JSON state store follows. */
export interface HookStateStore<T> {
  read(sessionId: string): T | undefined;
  write(sessionId: string, state: T): void;
}

/**
 * The real on-disk store shared by every hook that needs per-session
 * bookkeeping (Checkpoint's debounce state, Fix Nudge's Open Failure
 * records, ...): one small JSON file per session under
 * `<storageRoot>/.raiminiscence/hooks-state/<subdir>/<sessionId>.json`,
 * since each hook invocation is a fresh process with no in-memory state to
 * carry forward. Each hook keeps its own `subdir` and JSON shape `T` —
 * only this read/write/gitignore plumbing is shared.
 */
export function jsonSessionStore<T>(storageRoot: string, subdir: string, parse: (json: unknown) => T | undefined): HookStateStore<T> {
  const stateFilePath = (sessionId: string) => join(storageRoot, ".raiminiscence", "hooks-state", subdir, `${encodeURIComponent(sessionId)}.json`);

  return {
    read(sessionId) {
      const path = stateFilePath(sessionId);
      if (!existsSync(path)) return undefined;
      try {
        const state = parse(JSON.parse(readFileSync(path, "utf8")));
        if (state === undefined)
          logHookError("hook-state-store", `state file ${path} has an unexpected shape; treating this session as having no prior state`, undefined);
        return state;
      } catch (error) {
        logHookError("hook-state-store", `failed to read/parse state file ${path}; treating this session as having no prior state`, error);
        return undefined;
      }
    },
    write(sessionId, state) {
      const path = stateFilePath(sessionId);
      mkdirSync(dirname(path), { recursive: true });
      ensureGitignoreEntry(storageRoot);
      writeFileSync(path, JSON.stringify(state), "utf8");
    },
  };
}
