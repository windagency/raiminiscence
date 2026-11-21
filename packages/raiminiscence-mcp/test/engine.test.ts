import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall, remember } from "#src/core/engine.js";
import { readMemory } from "#src/core/storage.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

/** Deterministic stand-in for a real Ollama instance — always misses, exercising the lexical fallback path regardless of the local machine's Ollama status. */
const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

describe("remember/recall round-trip", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-engine-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("recalls a remembered memory by query", async () => {
    const remembered = await remember({
      content: "Postgres was chosen for the write model.\nStrongest transactional guarantees for this workload.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });

    expect(remembered.kind).toBe("episodic");
    expect(remembered.confidence).toBe("observed");
    expect(remembered.redacted).toBe(false);
    expect(remembered.embedded).toBe(false);
    expect(remembered.consolidationTriggered).toBe(true);

    const recalled = await recall({ query: "postgres write model", storageRoot, embeddingProvider: unreachableProvider });

    expect(recalled.results).toHaveLength(1);
    expect(recalled.results[0]!.id).toBe(remembered.id);
    expect(recalled.results[0]!.summary).toBe("Postgres was chosen for the write model.");
  });

  it("redacts secret-shaped content before persisting", async () => {
    const remembered = await remember({
      content: "Debugging with api_key: sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa in hand.",
      client: "claude-code",
      storageRoot,
    });

    expect(remembered.redacted).toBe(true);

    const recalled = await recall({ query: "debugging api_key", storageRoot });
    expect(recalled.results[0]!.detail).not.toContain("sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("returns an empty result, not an error, on zero matches", async () => {
    await remember({
      content: "Unrelated observation about frontend routing.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });

    const recalled = await recall({ query: "kubernetes ingress rules", storageRoot, embeddingProvider: unreachableProvider });

    expect(recalled.results).toEqual([]);
  });

  it("survives a fresh process re-reading from disk", async () => {
    const remembered = await remember({ content: "A decision worth remembering later.", client: "claude-code", storageRoot });

    // Simulate a fresh process: recall reads only from disk, no in-memory state carried over.
    const recalled = await recall({ query: "decision worth remembering", storageRoot });

    expect(recalled.results.map((r) => r.id)).toContain(remembered.id);
  });

  it("attaches a writer identity with one sessionId shared across every remember call in the same process", async () => {
    const first = await remember({ content: "First writer-identity observation.", client: "claude-code", storageRoot });
    const second = await remember({ content: "Second writer-identity observation.", client: "claude-code", storageRoot });

    const firstMemory = readMemory(storageRoot, "episodic", first.id)!;
    const secondMemory = readMemory(storageRoot, "episodic", second.id)!;

    expect(firstMemory.frontmatter.writer?.sessionId).toBeTruthy();
    expect(firstMemory.frontmatter.writer?.sessionId).toBe(secondMemory.frontmatter.writer?.sessionId);
  });

  it("still succeeds when the writer identity provider reports no git identity", async () => {
    const remembered = await remember({
      content: "Written with no git identity available.",
      client: "claude-code",
      storageRoot,
      writerIdentityProvider: () => ({ sessionId: "no-git-identity-session" }),
    });

    const memory = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(memory.frontmatter.writer).toEqual({ sessionId: "no-git-identity-session" });
  });
});
