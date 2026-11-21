import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consolidate, recall, remember } from "#src/core/engine.js";
import { readPackedIndex } from "#src/core/embeddings/packed-index.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";
import { awaitPendingEmbeds, settlePendingEmbeds } from "#src/core/pending-embeds.js";
import { readAllMemories, readMemory } from "#src/core/storage.js";
import { createRefreshingWriterIdentity } from "#src/core/writer-identity.js";
import type { MemoryWriter } from "#src/core/types.js";

const IDENTITY = { provider: "stub", model: "stub" };
const writer = () => ({ sessionId: "background-session" });

/** Embeds from a fixed table; while `gate` is set, every embed waits for it first. */
function gatedProvider(vectors: Record<string, number[]>) {
  let release: () => void = () => {};
  let gate: Promise<void> | undefined;
  const provider: EmbeddingProvider = {
    identity: IDENTITY,
    async embed(text: string) {
      if (gate) await gate;
      return vectors[text] ?? null;
    },
  };
  return {
    provider,
    hold() {
      gate = new Promise((resolve) => (release = resolve));
    },
    release() {
      gate = undefined;
      release();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("remember with embedInBackground (ADR-0041)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-background-embed-"));
  });

  afterEach(async () => {
    await settlePendingEmbeds(1_000);
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("answers once the Memory is on disk, before its vector, and writes the vector after", async () => {
    const content = "Kafka consumer lag spikes after deploys.";
    const embeds = gatedProvider({ [content]: [1, 0] });
    embeds.hold();

    const remembered = await remember({
      content,
      client: "claude-code",
      storageRoot,
      embeddingProvider: embeds.provider,
      embedInBackground: true,
      triggerConsolidation: false,
      writerIdentityProvider: writer,
    });

    expect(remembered.embedded).toBe("pending");
    expect(readMemory(storageRoot, remembered.kind, remembered.id)?.body).toBe(content);
    expect(readPackedIndex(storageRoot)[remembered.id]).toBeUndefined();

    embeds.release();
    await awaitPendingEmbeds(storageRoot);
    expect(readPackedIndex(storageRoot)[remembered.id]?.vector).toEqual([1, 0]);
  });

  it("makes a recall in the same process wait for the pending vector, so the new Memory ranks by it", async () => {
    const lexicalMatch = "Notes on the deploy pipeline query.";
    const newMemory = "Kafka consumer lag spikes.";
    const query = "deploy pipeline query";
    const embeds = gatedProvider({ [lexicalMatch]: [0, 1], [newMemory]: [1, 0], [query]: [1, 0] });
    await remember({ content: lexicalMatch, client: "claude-code", storageRoot, embeddingProvider: embeds.provider, triggerConsolidation: false });
    embeds.hold();
    const remembered = await remember({
      content: newMemory,
      client: "claude-code",
      storageRoot,
      embeddingProvider: embeds.provider,
      embedInBackground: true,
      triggerConsolidation: false,
      writerIdentityProvider: writer,
    });

    const recalled = recall({ storageRoot, query, k: 2, embeddingProvider: embeds.provider, triggerConsolidation: false });
    await settle();
    embeds.release();

    expect((await recalled).results[0]?.id).toBe(remembered.id);
  });

  it("makes Consolidation wait for the pending vector before it clusters", async () => {
    const first = "Retry backoff doubles on every 503.";
    const second = "Retry backoff doubles after each 503.";
    const embeds = gatedProvider({ [first]: [1, 0], [second]: [0.99, 0.01] });
    await remember({ content: first, client: "claude-code", storageRoot, embeddingProvider: embeds.provider, triggerConsolidation: false });
    embeds.hold();
    await remember({
      content: second,
      client: "claude-code",
      storageRoot,
      embeddingProvider: embeds.provider,
      embedInBackground: true,
      triggerConsolidation: false,
      writerIdentityProvider: writer,
    });

    const consolidated = consolidate({ storageRoot, embeddingProvider: embeds.provider });
    await settle();
    embeds.release();
    await consolidated;

    expect(readAllMemories(storageRoot, ["semantic"])).toHaveLength(1);
  });

  it("logs a failed background embed and keeps the Memory", async () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const unreachable: EmbeddingProvider = { identity: IDENTITY, embed: async () => null };

    const remembered = await remember({
      content: "An observation the embedder never sees.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachable,
      embedInBackground: true,
      triggerConsolidation: false,
      writerIdentityProvider: writer,
      logger,
    });
    await awaitPendingEmbeds(storageRoot);

    expect(readMemory(storageRoot, remembered.kind, remembered.id)).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ id: remembered.id }), expect.any(String));
  });

  it("stops waiting for pending vectors once its timeout passes", async () => {
    const embeds = gatedProvider({});
    embeds.hold();
    await remember({
      content: "Never released.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: embeds.provider,
      embedInBackground: true,
      triggerConsolidation: false,
      writerIdentityProvider: writer,
    });

    const started = Date.now();
    await settlePendingEmbeds(50);
    expect(Date.now() - started).toBeLessThan(1_000);
    embeds.release();
  });
});

describe("the refreshing writer identity (ADR-0041)", () => {
  it("reads once, then answers from its last read and refreshes for the next call", async () => {
    const reads: MemoryWriter[] = [
      { gitName: "Ada", sessionId: "s" },
      { gitName: "Grace", sessionId: "s" },
    ];
    const read = vi.fn(async () => reads.shift() ?? { gitName: "Linus", sessionId: "s" });
    const identity = createRefreshingWriterIdentity(read);

    expect(await identity()).toEqual({ gitName: "Ada", sessionId: "s" });
    expect(await identity()).toEqual({ gitName: "Ada", sessionId: "s" });
    await settle();
    expect(await identity()).toEqual({ gitName: "Grace", sessionId: "s" });
  });
});
