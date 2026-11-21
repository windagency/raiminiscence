import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall, remember } from "#src/core/engine.js";
import { readMemory, writeMemory } from "#src/core/storage.js";

describe("recall: decay/Strength-aware ranking", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-recall-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("includes strength alongside score in results", async () => {
    await remember({ content: "Postgres chosen for the write model.", client: "claude-code", storageRoot });

    const result = await recall({ query: "postgres write model", storageRoot });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.strength).toBeGreaterThan(0);
    expect(result.results[0]!.strength).toBeLessThanOrEqual(1);
  });

  it("resets the decay anchor and increments recallCount on recall", async () => {
    const remembered = await remember({ content: "A pattern worth recalling twice.", client: "claude-code", storageRoot });

    await recall({ query: "pattern worth recalling", storageRoot });
    const afterFirstRecall = readMemory(storageRoot, "episodic", remembered.id);
    expect(afterFirstRecall?.frontmatter.recallCount).toBe(1);
    expect(afterFirstRecall?.frontmatter.lastRecalledAt).not.toBeNull();

    await recall({ query: "pattern worth recalling", storageRoot });
    const afterSecondRecall = readMemory(storageRoot, "episodic", remembered.id);
    expect(afterSecondRecall?.frontmatter.recallCount).toBe(2);
  });

  it("excludes stale and retracted memories from ranked results", async () => {
    const stale = await remember({ content: "Outdated note about the old auth flow.", client: "claude-code", storageRoot });
    const retracted = await remember({ content: "Retracted note about the old auth flow.", client: "claude-code", storageRoot });

    for (const [id, confidence] of [
      [stale.id, "stale"],
      [retracted.id, "retracted"],
    ] as const) {
      const memory = readMemory(storageRoot, "episodic", id)!;
      memory.frontmatter.confidence = confidence;
      writeMemory(storageRoot, memory);
    }

    const result = await recall({ query: "old auth flow", storageRoot });

    expect(result.results).toEqual([]);
  });
});
