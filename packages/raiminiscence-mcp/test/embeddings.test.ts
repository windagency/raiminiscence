import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall, remember } from "#src/core/engine.js";
import { invalidateCachedEmbeddings } from "#src/core/recall-cache.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";
import { cosineSimilarity } from "#src/core/embeddings/packed-index.js";
import { writeLegacyEmbeddingMissingIdentity } from "./legacy-embedding-fixture.js";

/**
 * Deterministic stub provider standing in for a live Ollama instance:
 * each known phrase maps to a fixed vector so semantic-vs-lexical
 * ranking behavior can be asserted without a network dependency.
 */
function stubProvider(vectors: Record<string, number[]>, identity = { provider: "stub", model: "stub" }): EmbeddingProvider {
  return {
    identity,
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

describe("embedding-based recall", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-embeddings-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("ranks a semantically-close-but-lexically-different memory above a lexically-similar-but-semantically-unrelated one", async () => {
    const query = "database write durability";
    const semanticMatch = "Postgres chosen for transactional guarantees";
    const lexicalDecoy = "database migration script for the write-only audit log";

    const provider = stubProvider({
      [query]: [1, 0],
      [semanticMatch]: [0.95, 0.05],
      [lexicalDecoy]: [0, 1],
    });

    await remember({ content: semanticMatch, client: "claude-code", storageRoot, embeddingProvider: provider });
    await remember({ content: lexicalDecoy, client: "claude-code", storageRoot, embeddingProvider: provider });

    const result = await recall({ query, storageRoot, embeddingProvider: provider });

    expect(result.usedFallback).toBe(false);
    expect(result.results[0]!.summary).toBe(semanticMatch);
  });

  it("falls back to lexical scoring and reports usedFallback: true when no provider is reachable", async () => {
    await remember({ content: "A note about caching strategy.", client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });

    const result = await recall({ query: "caching strategy", storageRoot, embeddingProvider: unreachableProvider });

    expect(result.usedFallback).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("remember succeeds with embedded: false when the provider is unreachable", async () => {
    const result = await remember({
      content: "Still written even if embeddings are unavailable.",
      client: "claude-code",
      storageRoot,
      embeddingProvider: unreachableProvider,
    });

    expect(result.embedded).toBe(false);
    expect(result.id).toBeTruthy();
  });
});

describe("v17: a stored embedding's Provider/model identity", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-embeddings-identity-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("a Memory remembered under one provider is treated as unembedded (lexical fallback) once the query is embedded under a different provider", async () => {
    const query = "abc";
    const content = "xyz has nothing in common lexically with the query";

    const rememberingProvider = stubProvider({ [content]: [1, 0] }, { provider: "ollama", model: "nomic-embed-text" });
    const queryingProvider = stubProvider({ [query]: [1, 0] }, { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" });

    await remember({ content, client: "claude-code", storageRoot, embeddingProvider: rememberingProvider });

    const result = await recall({ query, storageRoot, embeddingProvider: queryingProvider });

    // Cosine similarity between the two identical [1, 0] vectors would be 1
    // if compared directly; the mismatched identity instead forces naive
    // lexical scoring, which finds no overlap at all between "abc" and the
    // content, so nothing clears minScore.
    expect(result.usedFallback).toBe(false);
    expect(result.results).toEqual([]);
  });

  it("a legacy on-disk record with no stored identity key is treated as always-compatible and cosine-scored, not pushed onto lexical fallback", async () => {
    const query = "abc";
    const content = "xyz has nothing in common lexically with the query";
    const queryingProvider = stubProvider({ [query]: [1, 0] }, { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" });

    const remembered = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });

    // Written straight to disk (not through `writeRecord`), so the corpus
    // cache is invalidated explicitly below — mirroring a fresh process
    // picking up a pre-existing legacy store rather than an artifact of this
    // test's single warm process.
    writeLegacyEmbeddingMissingIdentity(storageRoot, remembered.id, [1, 0]);
    invalidateCachedEmbeddings(storageRoot);

    const result = await recall({ query, storageRoot, embeddingProvider: queryingProvider });

    // Both vectors are [1, 0]; cosine similarity is 1 if compared. If this
    // legacy record were instead pushed onto lexical fallback, "abc" and the
    // content share no tokens and nothing would clear minScore.
    expect(result.usedFallback).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.summary).toBe(content);
  });

  it("a Memory remembered under, and queried under, the same provider still scores by similarity", async () => {
    const query = "abc";
    const content = "xyz has nothing in common lexically with the query";
    const identity = { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" };

    const provider = stubProvider({ [query]: [1, 0], [content]: [1, 0] }, identity);

    await remember({ content, client: "claude-code", storageRoot, embeddingProvider: provider });

    const result = await recall({ query, storageRoot, embeddingProvider: provider });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.summary).toBe(content);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
