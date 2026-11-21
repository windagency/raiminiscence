import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectQuery, recall, remember } from "#src/core/engine.js";
import { writeRecord } from "#src/core/record-index.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

/** Fixed vectors per phrase, so the dense half of the fused score is known exactly. */
function stubProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    identity: { provider: "stub", model: "stub" },
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

const NO_CONSOLIDATION = { triggerConsolidation: false } as const;

const query = "kafka consumer lag";
const target = "Kafka consumer lag alert threshold";
const linked = "Broker partition rebalancing notes";
const plain = "Broker partition sizing notes";
const floor = "Lunch menu for the team offsite";
const provider = stubProvider({ [query]: [1, 0], [target]: [1, 0], [linked]: [0.6, 0.8], [plain]: [0.6, 0.8], [floor]: [0, 1] });

describe("Co-access Edges and Spreading Activation are removed (ADR-0037)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-coaccess-removed-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  async function rememberAll(): Promise<string[]> {
    const ids: string[] = [];
    for (const content of [target, linked, plain, floor]) {
      ids.push((await remember({ content, client: "claude-code", storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION })).id);
    }
    return ids;
  }

  /** What an older version left on disk: a heavy Co-access Edge record. */
  function plantLegacyEdge(a: string, b: string): void {
    writeRecord(storageRoot, "co-access", [a, b].sort().join("|"), { weight: 400, updatedAt: new Date().toISOString() });
  }

  it("writes no Co-access Edge when a recall selects part of the pool", async () => {
    await rememberAll();

    await recall({ query, k: 2, storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });

    expect(existsSync(join(storageRoot, ".raiminiscence", "memory", "co-access"))).toBe(false);
  });

  it("ignores edge records an older version left on disk when scoring", async () => {
    const [targetId, linkedId, plainId] = await rememberAll();
    plantLegacyEdge(targetId!, linkedId!);

    const result = await recall({ query, k: 4, storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const score = (id: string) => result.results.find((r) => r.id === id)!.score;

    expect(score(linkedId!)).toBeCloseTo(score(plainId!), 9);
  });

  it("never surfaces a Memory through a connection: every result is a match", async () => {
    const [targetId, , , floorId] = await rememberAll();
    plantLegacyEdge(targetId!, floorId!);

    const recalled = await recall({ query, k: 4, minScore: 0.1, storageRoot, embeddingProvider: provider, ...NO_CONSOLIDATION });
    const inspected = await inspectQuery({ query, minScore: 0.1, storageRoot, embeddingProvider: provider });

    for (const { results } of [recalled, inspected]) {
      expect(results.map((r) => r.id)).not.toContain(floorId);
      expect(results.every((r) => r.surfacedVia === "match")).toBe(true);
    }
  });
});
