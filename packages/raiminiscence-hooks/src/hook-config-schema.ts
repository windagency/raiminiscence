import { z } from "zod";

/** One command inside a Claude Code/Codex hook entry's nested `hooks` array. */
export interface HookCommand {
  command?: unknown;
  [key: string]: unknown;
}

/** One entry in a hook event's array: a flat `command` (Cursor) or a nested `hooks` array (Claude Code, Codex). */
export interface HookEntry {
  command?: unknown;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

/** A client's own hook config file: hook events under `hooks`, every other key the client's own business. */
export interface HookConfig {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

/**
 * Only the path the installers walk is checked: `hooks` is an object, each
 * event an array of objects, each nested `hooks` an array of objects.
 * `.passthrough()` everywhere keeps every other key, so the client's own
 * settings survive the installer's rewrite untouched. `command` stays
 * `unknown`: the installers only compare it against the shim command.
 */
const hookCommandSchema = z.object({}).passthrough();
const hookEntrySchema = z.object({ hooks: z.array(hookCommandSchema).optional() }).passthrough();
const hookConfigSchema = z.object({ hooks: z.record(z.array(hookEntrySchema)).optional() }).passthrough();

/**
 * The client config at `path`, or a thrown error naming it when the hook path
 * is malformed, so the installer stops before overwriting a file it doesn't
 * understand.
 */
export function parseHookConfig(json: unknown, path: string): HookConfig {
  const parsed = hookConfigSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") || "top level";
    throw new Error(`${path} has an unexpected shape at ${where}; fix it by hand, then re-run the installer`);
  }
  return parsed.data;
}
