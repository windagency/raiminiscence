import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conflict, forget, remember } from "#src/core/engine.js";
import { conflictVerdict, readConflictIndex } from "#src/core/conflict-edge.js";
import { readMemory } from "#src/core/storage.js";

describe("conflict", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-conflict-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('records a "contradicts" verdict, leaving both Memories\' Confidence Tier and Strength untouched', async () => {
    const a = await remember({ content: "Decision: use Postgres for the write model.", client: "claude-code", storageRoot });
    const b = await remember({ content: "Decision: use MySQL for the write model.", client: "claude-code", storageRoot });

    const result = conflict({ memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts", storageRoot });

    expect(result).toEqual({ memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts" });
    expect(conflictVerdict(readConflictIndex(storageRoot), a.id, b.id)).toBe("contradicts");
    expect(readMemory(storageRoot, "episodic", a.id)?.frontmatter.confidence).not.toBe("retracted");
    expect(readMemory(storageRoot, "episodic", b.id)?.frontmatter.confidence).not.toBe("retracted");
  });

  it('records a "no-conflict" verdict', async () => {
    const a = await remember({ content: "Observation about caching alpha.", client: "claude-code", storageRoot });
    const b = await remember({ content: "Observation about caching beta.", client: "claude-code", storageRoot });

    const result = conflict({ memoryId: a.id, otherMemoryId: b.id, verdict: "no-conflict", storageRoot });

    expect(result).toEqual({ memoryId: a.id, otherMemoryId: b.id, verdict: "no-conflict" });
    expect(conflictVerdict(readConflictIndex(storageRoot), a.id, b.id)).toBe("no-conflict");
  });

  it('a "supersedes" verdict performs the exact same retraction forget performs, on the named retractedId', async () => {
    const older = await remember({ content: "Decision: use REST for the API.", client: "claude-code", storageRoot });
    const newer = await remember({ content: "Decision: use GraphQL for the API.", client: "claude-code", storageRoot });

    const result = conflict({ memoryId: older.id, otherMemoryId: newer.id, verdict: "supersedes", retractedId: older.id, storageRoot });

    expect(result).toEqual({ memoryId: older.id, otherMemoryId: newer.id, verdict: "supersedes", alreadyRetracted: false });
    expect(readMemory(storageRoot, "episodic", older.id)?.frontmatter.confidence).toBe("retracted");
    expect(readMemory(storageRoot, "episodic", newer.id)?.frontmatter.confidence).not.toBe("retracted");
  });

  it('a "supersedes" verdict reports alreadyRetracted: true when the named Memory was already retracted', async () => {
    const older = await remember({ content: "Decision: use REST for the API, take two.", client: "claude-code", storageRoot });
    const newer = await remember({ content: "Decision: use GraphQL for the API, take two.", client: "claude-code", storageRoot });
    forget({ id: older.id, storageRoot });

    const result = conflict({ memoryId: older.id, otherMemoryId: newer.id, verdict: "supersedes", retractedId: older.id, storageRoot });

    expect(result.alreadyRetracted).toBe(true);
  });

  it('rejects a "supersedes" verdict whose retractedId does not name one of the two Memories', async () => {
    const a = await remember({ content: "Decision: use REST for the API, take three.", client: "claude-code", storageRoot });
    const b = await remember({ content: "Decision: use GraphQL for the API, take three.", client: "claude-code", storageRoot });

    expect(() => conflict({ memoryId: a.id, otherMemoryId: b.id, verdict: "supersedes", retractedId: "nonexistent-id", storageRoot })).toThrow(
      /retractedId/,
    );
  });

  it("rejects a verdict for a nonexistent memoryId/otherMemoryId, consistent with forget/feedback", async () => {
    const a = await remember({ content: "A lone memory.", client: "claude-code", storageRoot });

    expect(() => conflict({ memoryId: "nonexistent-id", otherMemoryId: a.id, verdict: "no-conflict", storageRoot })).toThrow(/nonexistent-id/);
    expect(() => conflict({ memoryId: a.id, otherMemoryId: "nonexistent-id", verdict: "no-conflict", storageRoot })).toThrow(/nonexistent-id/);
  });

  it("does not require the pair to have been previously surfaced as a candidate — any two existing ids are accepted", async () => {
    const a = await remember({ content: "Totally unrelated note one.", client: "claude-code", storageRoot });
    const b = await remember({ content: "Totally unrelated note two.", client: "claude-code", storageRoot });

    expect(() => conflict({ memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts", storageRoot })).not.toThrow();
  });

  it("a later call overwrites an earlier recorded verdict for the same pair", async () => {
    const a = await remember({ content: "Overwrite test memory one.", client: "claude-code", storageRoot });
    const b = await remember({ content: "Overwrite test memory two.", client: "claude-code", storageRoot });

    conflict({ memoryId: a.id, otherMemoryId: b.id, verdict: "no-conflict", storageRoot });
    conflict({ memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts", storageRoot });

    expect(conflictVerdict(readConflictIndex(storageRoot), a.id, b.id)).toBe("contradicts");
  });
});
