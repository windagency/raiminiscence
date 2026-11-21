import { mkdtempSync, readFileSync, rmSync, type RmOptions } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CORPUS_DIR = join(import.meta.dirname, "corpus");

/**
 * Creates a fresh `mkdtempSync` directory under `prefix`, runs `fn` against
 * it, and always removes it afterward — the `mkdtempSync` -> `try`/`finally`
 * -> `rmSync` shape that used to repeat verbatim across this directory's
 * runners. `rmOptions` merges into (and can override) the default
 * `{ recursive: true, force: true }` cleanup, for the one call site
 * (`consolidation-contention-runner.ts`'s `sharedRoot`) that needs
 * `maxRetries`/`retryDelay` to survive a real race with git's own worktree
 * bookkeeping.
 */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => T | Promise<T>, rmOptions?: RmOptions): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, ...rmOptions });
  }
}

/** Reads and parses a JSON fixture from `benchmarks/corpus/`. */
export function loadCorpusFile<T>(filename: string): T {
  return JSON.parse(readFileSync(join(CORPUS_DIR, filename), "utf8")) as T;
}
