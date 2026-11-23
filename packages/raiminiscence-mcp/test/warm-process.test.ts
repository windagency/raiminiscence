import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";
import { createWarmEmbeddingProvider } from "#src/core/embeddings/warm-embed.js";
import { PACKAGE_VERSION } from "#src/core/package-version.js";
import { recall } from "#src/core/recall.js";
import { requestServedRecall, startRecallServer, type RecallServer } from "#src/core/recall-socket.js";
import { remember } from "#src/core/remember.js";
import { runWarmProcess, type WarmProcessOptions } from "#src/core/warm-process.js";

const isWindows = process.platform === "win32";

/** A tiny bag-of-words provider: identical for the warm process and the caller, and deterministic. */
function bagOfWords(identity = { provider: "stub", model: "bag-of-words" }): EmbeddingProvider {
  return {
    identity,
    async embed(text: string) {
      const lower = text.toLowerCase();
      return ["kafka", "lag", "postgres", "retry"].map((word) => (lower.includes(word) ? 1 : 0.01));
    },
  };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(isWindows)("the warm process (ADR-0040)", () => {
  let dir: string;
  let storageRoot: string;
  let recallSocket: string;
  let embedSocket: string;
  let other: RecallServer | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rai-warm-proc-"));
    storageRoot = join(dir, "project");
    recallSocket = join(dir, "r.sock");
    embedSocket = join(dir, "e.sock");
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "");
    for (const content of ["Kafka consumer lag spikes after deploys.", "Postgres chosen for the write model."]) {
      await remember({ content, client: "claude-code", storageRoot, embeddingProvider: bagOfWords() });
    }
  });

  afterEach(async () => {
    await other?.close();
    other = undefined;
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function run(overrides: Partial<WarmProcessOptions> = {}) {
    return runWarmProcess({
      storageRoot,
      embeddingProvider: bagOfWords(),
      recallSocketPath: recallSocket,
      embedSocketPath: embedSocket,
      idleMs: 300,
      checkMs: 25,
      ...overrides,
    });
  }

  function ask(packageVersion = PACKAGE_VERSION) {
    return requestServedRecall({
      socketPath: recallSocket,
      storageRoot,
      identity: bagOfWords().identity,
      packageVersion,
      query: "kafka lag",
      k: 10,
      timeoutMs: 2000,
    });
  }

  it("serves the same recall as a local one while it runs", async () => {
    const running = run();
    await vi.waitFor(() => expect(existsSync(recallSocket)).toBe(true));
    const local = await recall({ storageRoot, query: "kafka lag", k: 10, embeddingProvider: bagOfWords(), triggerConsolidation: false });

    expect((await ask())?.map(({ id }) => id)).toEqual(local.results.map(({ id }) => id));
    await running;
  });

  it("exits after its idle time and leaves no socket behind", async () => {
    expect(await run()).toBe("idle");
    expect(existsSync(recallSocket)).toBe(false);
  });

  it("stays up while requests keep coming", async () => {
    const running = run();
    await vi.waitFor(() => expect(existsSync(recallSocket)).toBe(true));
    // Four requests 150 ms apart span 600 ms, twice the 300 ms idle time: each is answered only if the
    // earlier ones kept it up. Not a wall-clock bound: timers fire off the loop's cached clock, so a busy
    // runner measures them a few ms short.
    const answers = [];
    for (let i = 0; i < 4; i++) {
      await settle(150);
      answers.push(await ask());
    }

    expect(answers.every((answer) => answer !== null)).toBe(true);
    expect(await running).toBe("idle");
  });

  it("exits at once when another server already serves the recall", async () => {
    other = await startRecallServer(
      { storageRoot, identity: bagOfWords().identity, packageVersion: PACKAGE_VERSION, recall: async () => [] },
      recallSocket,
    );

    expect(await run({ idleMs: 60_000 })).toBe("not-serving");
    expect(await ask()).toEqual([]);
  });

  it("exits after answering a client of another release, so that release can start its own", async () => {
    const running = run({ idleMs: 60_000 });
    await vi.waitFor(() => expect(existsSync(recallSocket)).toBe(true));

    expect(await ask("0.0.0-other")).toBeNull();
    expect(await running).toBe("other-release");
    expect(existsSync(recallSocket)).toBe(false);
  });

  it("exits when another server replaces its socket, and leaves that socket alone", async () => {
    const running = run({ idleMs: 60_000 });
    await vi.waitFor(() => expect(existsSync(recallSocket)).toBe(true));
    rmSync(recallSocket);
    other = await startRecallServer(
      { storageRoot, identity: bagOfWords().identity, packageVersion: PACKAGE_VERSION, recall: async () => [] },
      recallSocket,
    );

    expect(await running).toBe("replaced");
    expect(await ask()).toEqual([]);
  });

  it("also serves an Embedded Provider's vectors, and removes that socket on exit", async () => {
    const embedded = bagOfWords({ provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" });
    const running = run({ embeddingProvider: embedded });
    await vi.waitFor(() => expect(existsSync(embedSocket)).toBe(true));
    const unreachable: EmbeddingProvider = { identity: embedded.identity, embed: async () => null };

    expect(await createWarmEmbeddingProvider(unreachable, embedSocket).embed("kafka", "query")).toEqual([1, 0.01, 0.01, 0.01]);
    expect(await running).toBe("idle");
    expect(existsSync(embedSocket)).toBe(false);
  });

  it("serves nothing when RAIMINISCENCE_WARM_EMBED is off", async () => {
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "off");

    expect(await run()).toBe("not-serving");
  });
});
