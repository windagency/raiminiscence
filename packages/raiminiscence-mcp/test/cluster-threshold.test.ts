import { describe, expect, it } from "vitest";
import { clusterEpisodicMemories } from "#src/core/clustering.js";
import { createFrontmatter } from "#src/core/create-frontmatter.js";
import type { PackedEmbeddingIndex } from "#src/core/embeddings/packed-index.js";
import type { EmbeddingProviderIdentity } from "#src/core/embeddings/provider.js";
import { computeConflictFields } from "#src/core/query-scoring.js";
import type { Memory } from "#src/core/types.js";

const BARE = { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" };
const PREFIXED = { ...BARE, prompt: "nomic-task-prefix" };

function episodic(id: string): Memory {
  const frontmatter = createFrontmatter({
    kind: "episodic",
    confidence: "observed",
    createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
    source: { client: "test" },
    scope: "project",
  });
  return { frontmatter: { ...frontmatter, id }, body: id };
}

/** Two unit vectors whose cosine similarity is exactly `similarity`. */
function pairAt(similarity: number, identity: EmbeddingProviderIdentity): PackedEmbeddingIndex {
  const updatedAt = "2024-01-01T00:00:00.000Z";
  return {
    a: { vector: [1, 0], identity, updatedAt },
    b: { vector: [similarity, Math.sqrt(1 - similarity ** 2)], identity, updatedAt },
  };
}

// ADR-0042: task prefixes lift every nomic similarity, so prefixed vectors need a higher bar than bare ones.
describe.each([
  ["bare", BARE, 0.85, true],
  ["prefixed", PREFIXED, 0.85, false],
  ["prefixed", PREFIXED, 0.88, true],
])("the similarity threshold for %s vectors at %s", (_label, identity, similarity, joins) => {
  const index = pairAt(similarity, identity);

  it(joins ? "clusters the pair" : "keeps the pair apart", () => {
    expect(clusterEpisodicMemories([episodic("a"), episodic("b")], index, {}).clusters).toHaveLength(joins ? 1 : 0);
  });

  it(joins ? "flags the pair as a conflict candidate" : "does not flag the pair", () => {
    const { conflictCandidateWith } = computeConflictFields(["a", "b"], {}, index, () => "episodic");
    expect(conflictCandidateWith.has("a")).toBe(joins);
  });
});
