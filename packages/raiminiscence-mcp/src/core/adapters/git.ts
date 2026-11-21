import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The one module allowed to import `node:child_process` for git purposes —
 * every git-shelling call in this codebase (`core/git.ts`,
 * `core/writer-identity.ts`, `core/shared-memory/git.ts`) goes through
 * `runGitSync`/`runGitAsyncRaw` instead of calling `child_process` directly,
 * per the adapter-pattern non-negotiable (`CODING_RULES/04-architecture.md`).
 * Purely a containment seam: each caller keeps its own exact prior `stdio`
 * (some ignore stderr, some pipe it), `cwd`, and argument shape, passed
 * through unchanged.
 */
export interface GitCallOptions {
  cwd?: string;
  stdio: ["ignore", "pipe", "ignore"] | ["ignore", "pipe", "pipe"];
}

export function runGitSync(args: string[], options: GitCallOptions): string {
  return execFileSync("git", args, { cwd: options.cwd, encoding: "utf8", stdio: options.stdio });
}

export async function runGitAsyncRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
