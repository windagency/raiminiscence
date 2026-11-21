import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall, remember } from "#src/core/engine.js";
import { upsertConflictVerdict } from "#src/core/conflict-edge.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

function stubProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    identity: { provider: "stub", model: "stub" },
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

describe("recall: Conflict Candidate / confirmed Conflict flagging", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-recall-conflicts-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("flags a cosine-similar pair with no recorded verdict as conflictCandidateWith on both items", async () => {
    const query = "database write model decision";
    const contentA = "Decision: use Postgres for the write model.";
    const contentB = "Decision: use MySQL for the write model.";

    const provider = stubProvider({
      [query]: [1, 0],
      [contentA]: [1, 0],
      [contentB]: [1, 0],
    });

    const a = await remember({ content: contentA, client: "claude-code", storageRoot, embeddingProvider: provider });
    const b = await remember({ content: contentB, client: "claude-code", storageRoot, embeddingProvider: provider });

    const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

    const entryA = result.results.find((r) => r.id === a.id);
    const entryB = result.results.find((r) => r.id === b.id);
    expect(entryA?.conflictCandidateWith).toEqual([b.id]);
    expect(entryB?.conflictCandidateWith).toEqual([a.id]);
    expect(entryA?.conflictsWith).toBeUndefined();
    expect(entryB?.conflictsWith).toBeUndefined();
  });

  it("flags a pair with a recorded contradicts verdict as conflictsWith instead of conflictCandidateWith", async () => {
    const query = "database write model decision";
    const contentA = "Decision: use Postgres for the write model, take two.";
    const contentB = "Decision: use MySQL for the write model, take two.";

    const provider = stubProvider({
      [query]: [1, 0],
      [contentA]: [1, 0],
      [contentB]: [1, 0],
    });

    const a = await remember({ content: contentA, client: "claude-code", storageRoot, embeddingProvider: provider });
    const b = await remember({ content: contentB, client: "claude-code", storageRoot, embeddingProvider: provider });
    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

    const entryA = result.results.find((r) => r.id === a.id);
    const entryB = result.results.find((r) => r.id === b.id);
    expect(entryA?.conflictsWith).toEqual([b.id]);
    expect(entryB?.conflictsWith).toEqual([a.id]);
    expect(entryA?.conflictCandidateWith).toBeUndefined();
    expect(entryB?.conflictCandidateWith).toBeUndefined();
  });

  it.each(["supersedes", "no-conflict"] as const)('neither field is populated for a pair with a recorded "%s" verdict', async (verdict) => {
    const query = "database write model decision";
    const contentA = `Decision: use Postgres for the write model, take ${verdict}.`;
    const contentB = `Decision: use MySQL for the write model, take ${verdict}.`;

    const provider = stubProvider({
      [query]: [1, 0],
      [contentA]: [1, 0],
      [contentB]: [1, 0],
    });

    const a = await remember({ content: contentA, client: "claude-code", storageRoot, embeddingProvider: provider });
    const b = await remember({ content: contentB, client: "claude-code", storageRoot, embeddingProvider: provider });
    upsertConflictVerdict(storageRoot, a.id, b.id, verdict);

    const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

    const entryA = result.results.find((r) => r.id === a.id);
    const entryB = result.results.find((r) => r.id === b.id);
    expect(entryA?.conflictCandidateWith).toBeUndefined();
    expect(entryA?.conflictsWith).toBeUndefined();
    expect(entryB?.conflictCandidateWith).toBeUndefined();
    expect(entryB?.conflictsWith).toBeUndefined();
  });

  it("neither field is populated for a pair below the similarity threshold, even with no recorded verdict", async () => {
    const query = "shared topic";
    const contentA = "Note leaning toward topic A.";
    const contentC = "Note leaning toward topic C.";

    const provider = stubProvider({
      [query]: [1, 1],
      [contentA]: [1, 0.2],
      [contentC]: [0.2, 1],
    });

    const a = await remember({ content: contentA, client: "claude-code", storageRoot, embeddingProvider: provider });
    const c = await remember({ content: contentC, client: "claude-code", storageRoot, embeddingProvider: provider });

    const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

    expect(result.results).toHaveLength(2);
    const entryA = result.results.find((r) => r.id === a.id);
    const entryC = result.results.find((r) => r.id === c.id);
    expect(entryA?.conflictCandidateWith).toBeUndefined();
    expect(entryC?.conflictCandidateWith).toBeUndefined();
  });

  it("bounds the comparison to the final returned result set, not the full pre-filter candidate pool", async () => {
    const query = "database write model decision";
    const strongMatch = "Decision: use Postgres for the write model, take three.";
    const weakerButSimilar = "Decision: consider Postgres-like options for the write model.";

    const provider = stubProvider({
      [query]: [1, 0],
      [strongMatch]: [1, 0],
      [weakerButSimilar]: [0.9, 0.436],
    });

    const strong = await remember({ content: strongMatch, client: "claude-code", storageRoot, embeddingProvider: provider });
    await remember({ content: weakerButSimilar, client: "claude-code", storageRoot, embeddingProvider: provider });

    // k: 1 keeps only the top-scoring candidate in the final result set, even
    // though the excluded candidate independently qualifies and is
    // cosine-similar enough to the kept one to otherwise be flagged.
    const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1, k: 1 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe(strong.id);
    expect(result.results[0]!.conflictCandidateWith).toBeUndefined();
  });

  describe("v13 (ADR-0020): Checkpoints are never a Conflict Candidate", () => {
    it("never populates conflictCandidateWith for two cosine-similar Checkpoints", async () => {
      const query = "checkpoint on the migration";
      const contentA = "Checkpoint: migrating the write model to Postgres.";
      const contentB = "Checkpoint: still migrating the write model to Postgres.";

      const provider = stubProvider({
        [query]: [1, 0],
        [contentA]: [1, 0],
        [contentB]: [1, 0],
      });

      const a = await remember({ content: contentA, kind: "checkpoint", client: "claude-code", storageRoot, embeddingProvider: provider });
      const b = await remember({ content: contentB, kind: "checkpoint", client: "claude-code", storageRoot, embeddingProvider: provider });

      const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

      const entryA = result.results.find((r) => r.id === a.id);
      const entryB = result.results.find((r) => r.id === b.id);
      expect(entryA?.conflictCandidateWith).toBeUndefined();
      expect(entryB?.conflictCandidateWith).toBeUndefined();
    });

    it("never populates conflictCandidateWith on the Checkpoint's side of a pair with a non-Checkpoint Memory", async () => {
      const query = "checkpoint on the migration";
      const checkpointContent = "Checkpoint: migrating the write model to Postgres.";
      const episodicContent = "Observation: migrating the write model to Postgres.";

      const provider = stubProvider({
        [query]: [1, 0],
        [checkpointContent]: [1, 0],
        [episodicContent]: [1, 0],
      });

      const checkpoint = await remember({
        content: checkpointContent,
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        embeddingProvider: provider,
      });
      const episodic = await remember({ content: episodicContent, client: "claude-code", storageRoot, embeddingProvider: provider });

      const result = await recall({ query, storageRoot, embeddingProvider: provider, minScore: 0.1 });

      const checkpointEntry = result.results.find((r) => r.id === checkpoint.id);
      const episodicEntry = result.results.find((r) => r.id === episodic.id);
      expect(checkpointEntry?.conflictCandidateWith).toBeUndefined();
      expect(episodicEntry?.conflictCandidateWith).toBeUndefined();
    });
  });
});
