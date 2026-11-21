import { generateId } from "./adapters/id.js";
import { runGitAsyncRaw, runGitSync } from "./adapters/git.js";
import type { MemoryWriter } from "./types.js";

export type WriterIdentityProvider = () => MemoryWriter;
/** `remember`'s provider: it reads the identity while its embed runs, so either shape works there. */
export type AsyncWriterIdentityProvider = () => MemoryWriter | Promise<MemoryWriter>;

function gitConfigValue(key: string): string | undefined {
  try {
    return nonEmpty(runGitSync(["config", key], { stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    // Fallback-expected: no git installed, or `key` unset in git config —
    // both normal, non-error states this identity is simply left blank for.
    return undefined;
  }
}

async function gitConfigValueAsync(key: string): Promise<string | undefined> {
  try {
    return nonEmpty(await runGitAsyncRaw(process.cwd(), ["config", key]));
  } catch {
    // Fallback-expected, as in `gitConfigValue`.
    return undefined;
  }
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toWriter(gitName: string | undefined, gitEmail: string | undefined, sessionId: string): MemoryWriter {
  // An unset field is omitted, never set to `undefined`: the frontmatter YAML
  // dump rejects `undefined` values and the whole Memory write would fail.
  return {
    ...(gitName !== undefined && { gitName }),
    ...(gitEmail !== undefined && { gitEmail }),
    sessionId,
  };
}

/**
 * A provider that reads `gitName`/`gitEmail` fresh on every call (git
 * identity can change mid-session) but always reports the same
 * `sessionId` — generate one `sessionId` once per process and reuse it.
 */
export function createWriterIdentityProvider(sessionId: string = generateId()): WriterIdentityProvider {
  return () => toWriter(gitConfigValue("user.name"), gitConfigValue("user.email"), sessionId);
}

/**
 * The same identity, read without blocking the event loop. The two `git
 * config` calls cost about 9 ms back to back and 26 ms after an idle
 * spell; `remember` runs them while its embed does, so a write no longer
 * pays them on top of the embed.
 */
export function createAsyncWriterIdentityProvider(sessionId: string = generateId()): () => Promise<MemoryWriter> {
  return async () => {
    const [gitName, gitEmail] = await Promise.all([gitConfigValueAsync("user.name"), gitConfigValueAsync("user.email")]);
    return toWriter(gitName, gitEmail, sessionId);
  };
}

/** Computed once per process on first import — every write in this process shares one `sessionId`. */
const processSessionId = generateId();
export const defaultWriterIdentityProvider: WriterIdentityProvider = createWriterIdentityProvider(processSessionId);
export const defaultAsyncWriterIdentityProvider = createAsyncWriterIdentityProvider(processSessionId);

/**
 * ADR-0041: answers from the last read and starts the next one, so a write
 * that answers before its embed doesn't wait on `git config`. Only the
 * first call waits for a read. A git identity changed mid-session reaches
 * the second write after the change. `read` must not reject.
 */
export function createRefreshingWriterIdentity(read: () => Promise<MemoryWriter>): () => Promise<MemoryWriter> {
  let last: Promise<MemoryWriter> | undefined;
  return () => {
    if (last === undefined) {
      last = read();
      return last;
    }
    const answer = last;
    // Spawning `git` is synchronous work on this thread; the next turn of the event loop keeps it off the write.
    setImmediate(() => void read().then((writer) => (last = Promise.resolve(writer))));
    return answer;
  };
}

export const defaultRefreshingWriterIdentity = createRefreshingWriterIdentity(defaultAsyncWriterIdentityProvider);
