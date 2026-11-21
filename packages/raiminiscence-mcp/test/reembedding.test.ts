import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remember } from "#src/core/engine.js";
import { createFrontmatter } from "#src/core/create-frontmatter.js";
import { upsertVector, readPackedIndex } from "#src/core/embeddings/packed-index.js";
import { identitiesCompatible, UNSPECIFIED_IDENTITY } from "#src/core/embeddings/provider.js";
import { mismatchedEmbeddings, reembedMismatched } from "#src/core/reembedding.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";
import type { Memory } from "#src/core/types.js";
import { writeLegacyEmbeddingMissingIdentity } from "./legacy-embedding-fixture.js";

/** A Memory fixture built via the same `createFrontmatter` helper `remember` uses, with `id` overridden to match a caller-chosen value — only `frontmatter.id` and `body` are actually read by `mismatchedEmbeddings`. */
function memoryFixture(id: string, body: string): Memory {
  return {
    frontmatter: {
      ...createFrontmatter({
        kind: "episodic",
        confidence: "observed",
        createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
        source: { client: "test" },
        scope: "project",
      }),
      id,
    },
    body,
  };
}

const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

function stubProvider(identity: { provider: string; model: string }, vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    identity,
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

describe("reembedding: mismatchedEmbeddings + reembedMismatched", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-reembedding-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("flags a Memory whose stored identity doesn't match the current provider, and heals it", async () => {
    const content = "Observation about retry backoff.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0], { provider: "old", model: "old-model" });

    const newProvider = stubProvider({ provider: "new", model: "new-model" }, { [content]: [0, 1] });
    const memories = [memoryFixture(a.id, content)];

    const mismatched = mismatchedEmbeddings(memories, readPackedIndex(storageRoot), newProvider);
    expect(mismatched).toHaveLength(1);

    const reembedded = await reembedMismatched(storageRoot, mismatched, newProvider);
    expect(reembedded).toBe(1);

    const healed = readPackedIndex(storageRoot)[a.id]!;
    expect(healed.vector).toEqual([0, 1]);
    expect(healed.identity).toEqual({ provider: "new", model: "new-model" });
  });

  it("leaves a Memory whose identity already matches the provider completely untouched", async () => {
    const content = "Observation already on the current provider.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0], { provider: "new", model: "new-model" });

    const newProvider = stubProvider({ provider: "new", model: "new-model" }, { [content]: [0, 1] });
    const memories = [memoryFixture(a.id, content)];

    const mismatched = mismatchedEmbeddings(memories, readPackedIndex(storageRoot), newProvider);
    expect(mismatched).toHaveLength(0);

    const untouched = readPackedIndex(storageRoot)[a.id]!;
    expect(untouched.vector).toEqual([1, 0]);
  });

  it("leaves a mismatched Memory's old vector/identity in place when the provider is unreachable", async () => {
    const content = "Observation that can't be re-embedded right now.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0], { provider: "old", model: "old-model" });

    const memories = [memoryFixture(a.id, content)];
    const mismatched = mismatchedEmbeddings(memories, readPackedIndex(storageRoot), unreachableProvider);
    expect(mismatched).toHaveLength(1);

    const reembedded = await reembedMismatched(storageRoot, mismatched, unreachableProvider);
    expect(reembedded).toBe(0);

    const stillOld = readPackedIndex(storageRoot)[a.id]!;
    expect(stillOld.vector).toEqual([1, 0]);
    expect(stillOld.identity).toEqual({ provider: "old", model: "old-model" });
  });

  it("flags a Memory with no stored embedding at all, and gives it one (ADR-0041)", async () => {
    const content = "Observation whose embed never landed.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    const provider = stubProvider({ provider: "new", model: "new-model" }, { [content]: [0, 1] });

    const mismatched = mismatchedEmbeddings([memoryFixture(a.id, content)], readPackedIndex(storageRoot), provider);
    expect(mismatched).toHaveLength(1);

    expect(await reembedMismatched(storageRoot, mismatched, provider)).toBe(1);
    expect(readPackedIndex(storageRoot)[a.id]?.vector).toEqual([0, 1]);
  });

  it("stops at the first failed embed, so an unreachable provider costs one attempt per pass, not one per Memory", async () => {
    const embed = vi.fn(async () => null);
    const unreachable: EmbeddingProvider = { identity: { provider: "new", model: "new-model" }, embed };
    const memories = [memoryFixture("never-embedded-a", "a"), memoryFixture("never-embedded-b", "b")];

    expect(await reembedMismatched(storageRoot, mismatchedEmbeddings(memories, {}, unreachable), unreachable)).toBe(0);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("normalizes a legacy on-disk record with no identity key to UNSPECIFIED_IDENTITY, rather than crashing", () => {
    writeLegacyEmbeddingMissingIdentity(storageRoot, "legacy-id", [1, 0]);

    const record = readPackedIndex(storageRoot)["legacy-id"]!;
    expect(record.identity).toEqual(UNSPECIFIED_IDENTITY);
    expect(() => identitiesCompatible(record.identity, { provider: "new", model: "new-model" })).not.toThrow();
    expect(identitiesCompatible(record.identity, { provider: "new", model: "new-model" })).toBe(true);
  });

  it("excludes a legacy record with no stored identity from the mismatched pool, since it's compatible with everything", () => {
    writeLegacyEmbeddingMissingIdentity(storageRoot, "legacy-id", [1, 0]);

    const provider = stubProvider({ provider: "new", model: "new-model" }, {});
    const memories = [memoryFixture("legacy-id", "text")];

    const mismatched = mismatchedEmbeddings(memories, readPackedIndex(storageRoot), provider);
    expect(mismatched).toHaveLength(0);
  });

  it("re-embeds a nomic vector stored without task prefixes, as a document (ADR-0042)", async () => {
    const content = "Observation about retry backoff.";
    const a = await remember({ content, client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
    upsertVector(storageRoot, a.id, [1, 0], { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" });
    const embed = vi.fn(async () => [0, 1]);
    const prefixed: EmbeddingProvider = {
      identity: { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1", prompt: "nomic-task-prefix" },
      embed,
    };

    const mismatched = mismatchedEmbeddings([memoryFixture(a.id, content)], readPackedIndex(storageRoot), prefixed);
    expect(mismatched).toHaveLength(1);

    await reembedMismatched(storageRoot, mismatched, prefixed);
    expect(embed).toHaveBeenCalledWith(content, "document");
    expect(readPackedIndex(storageRoot)[a.id]?.identity).toEqual(prefixed.identity);
    expect(mismatchedEmbeddings([memoryFixture(a.id, content)], readPackedIndex(storageRoot), prefixed)).toHaveLength(0);
  });
});

describe("identitiesCompatible (ADR-0042)", () => {
  const plain = { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" };

  it("tells a prefixed vector apart from a bare one of the same model", () => {
    expect(identitiesCompatible(plain, { ...plain, prompt: "nomic-task-prefix" })).toBe(false);
    expect(identitiesCompatible({ ...plain, prompt: "nomic-task-prefix" }, { ...plain, prompt: "nomic-task-prefix" })).toBe(true);
  });
});
