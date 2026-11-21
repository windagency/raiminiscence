import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { remember } from "#src/core/engine.js";
import { readMemory } from "#src/core/storage.js";
import { createAsyncWriterIdentityProvider, createWriterIdentityProvider } from "#src/core/writer-identity.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

/**
 * A machine with no git identity configured (a fresh CI runner, a new
 * laptop) is the normal case this provider has to survive. Pointing git at
 * an empty global config, disabling the system one, and pointing GIT_DIR at
 * a directory that isn't a repository (so the checkout's own .git/config is
 * never read) makes `user.name`/`user.email` unset regardless of the machine
 * or clone running the test.
 */
describe("writer identity with no git user configured", () => {
  let scratch: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "raiminiscence-writer-identity-"));
    const emptyConfig = join(scratch, "empty.gitconfig");
    writeFileSync(emptyConfig, "");
    process.env.GIT_CONFIG_GLOBAL = emptyConfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_DIR = scratch;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(scratch, { recursive: true, force: true });
  });

  it("leaves gitName/gitEmail out entirely rather than setting them to undefined", () => {
    const identity = createWriterIdentityProvider("no-identity-session")();

    expect(Object.keys(identity)).toEqual(["sessionId"]);
  });

  it("lets remember write a Memory with the default provider", async () => {
    const storageRoot = join(scratch, "store");

    const remembered = await remember({
      content: "Writes still succeed on a machine with no git identity.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
      writerIdentityProvider: createWriterIdentityProvider("no-identity-session"),
    });

    const memory = readMemory(storageRoot, remembered.kind, remembered.id);
    expect(memory?.frontmatter.writer).toEqual({ sessionId: "no-identity-session" });
  });
});

describe("remember's writer identity read (write cost)", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "raiminiscence-writer-identity-async-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("reads the writer identity while the embed runs, not after it", async () => {
    let identityStarted!: () => void;
    const identityHasStarted = new Promise<void>((resolve) => (identityStarted = resolve));
    let embedStarted!: () => void;
    const embedHasStarted = new Promise<void>((resolve) => (embedStarted = resolve));
    const waitsForIdentity: EmbeddingProvider = {
      identity: { provider: "stub", model: "stub" },
      async embed() {
        embedStarted();
        await identityHasStarted;
        return [1, 0];
      },
    };

    const remembered = await remember({
      content: "The writer identity and the embed overlap.",
      client: "claude-code",
      storageRoot: scratch,
      embeddingProvider: waitsForIdentity,
      triggerConsolidation: false,
      writerIdentityProvider: async () => {
        identityStarted();
        await embedHasStarted;
        return { gitName: "Ada", sessionId: "overlap-session" };
      },
    });

    expect(readMemory(scratch, remembered.kind, remembered.id)?.frontmatter.writer).toEqual({ gitName: "Ada", sessionId: "overlap-session" });
    expect(remembered.embedded).toBe(true);
  });

  it("reads the same identity asynchronously as the synchronous provider does", async () => {
    const sync = createWriterIdentityProvider("same-session");
    const async = createAsyncWriterIdentityProvider("same-session");

    expect(await async()).toEqual(sync());
  });
});
