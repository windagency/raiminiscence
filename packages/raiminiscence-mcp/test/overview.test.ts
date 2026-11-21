import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overview, remember } from "#src/core/engine.js";
import { readMemory, writeMemory } from "#src/core/storage.js";
import { upsertConflictVerdict } from "#src/core/conflict-edge.js";
import type { WriterIdentityProvider } from "#src/core/writer-identity.js";

describe("overview", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-overview-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("excludes episodic memories entirely", async () => {
    await remember({ content: "A raw episodic observation.", kind: "episodic", client: "claude-code", storageRoot });
    await remember({ content: "A durable semantic pattern.", kind: "semantic", client: "claude-code", storageRoot });

    const result = overview({ storageRoot });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.kind).toBe("semantic");
  });

  it("excludes stale and retracted memories", async () => {
    const retracted = await remember({ content: "A retracted decision.", kind: "decision", client: "claude-code", storageRoot });
    const memory = readMemory(storageRoot, "decision", retracted.id)!;
    memory.frontmatter.confidence = "retracted";
    writeMemory(storageRoot, memory);

    const result = overview({ storageRoot });

    expect(result.results).toEqual([]);
  });

  it("returns fewer than 5 results (not an error) when fewer are eligible", async () => {
    await remember({ content: "Only one semantic memory exists.", kind: "semantic", client: "claude-code", storageRoot });

    const result = overview({ storageRoot });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.score).toBeNull();
  });

  it("returns the top 5 highest-Strength semantic/decision memories, ranked by Strength alone", async () => {
    for (let i = 0; i < 7; i++) {
      await remember({
        content: `Semantic pattern number ${i}.`,
        kind: "semantic",
        isError: i === 0, // one error-amplified memory should rank first
        client: "claude-code",
        storageRoot,
      });
    }

    const result = overview({ storageRoot });

    expect(result.results).toHaveLength(5);
    const strengths = result.results.map((r) => r.strength);
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
  });

  it("reports conflictsWith for a confirmed conflict among its returned set, and never conflictCandidateWith", async () => {
    const a = await remember({ content: "Decision: use Postgres for the write model.", kind: "decision", client: "claude-code", storageRoot });
    const b = await remember({ content: "Decision: use MySQL for the write model.", kind: "decision", client: "claude-code", storageRoot });
    upsertConflictVerdict(storageRoot, a.id, b.id, "contradicts");

    const result = overview({ storageRoot });

    const entryA = result.results.find((r) => r.id === a.id);
    const entryB = result.results.find((r) => r.id === b.id);
    expect(entryA?.conflictsWith).toEqual([b.id]);
    expect(entryB?.conflictsWith).toEqual([a.id]);
    expect(result.results.every((r) => !("conflictCandidateWith" in r))).toBe(true);
  });

  describe("v13 (ADR-0020): currentFocus", () => {
    const identityA: WriterIdentityProvider = () => ({ gitName: "Alice", gitEmail: "alice@example.com", sessionId: "session-a" });
    const identityB: WriterIdentityProvider = () => ({ gitName: "Bob", gitEmail: "bob@example.com", sessionId: "session-b" });

    it("is { own: null, project: null } when no Checkpoint exists yet", async () => {
      await remember({ content: "A durable semantic pattern.", kind: "semantic", client: "claude-code", storageRoot });

      const result = overview({ storageRoot });

      expect(result.currentFocus).toEqual({ own: null, project: null });
    });

    it("never appears in the plain top-N results array", async () => {
      await remember({ content: "Working on the migration.", kind: "checkpoint", client: "claude-code", storageRoot });

      const result = overview({ storageRoot });

      expect(result.results).toEqual([]);
    });

    it("own and project collapse to the same single-writer Checkpoint when there's only one writer", async () => {
      await remember({
        content: "Working on the migration.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityA,
      });

      const result = overview({ storageRoot, writerIdentityProvider: identityA });

      expect(result.currentFocus.own?.summary).toBe("Working on the migration.");
      expect(result.currentFocus.project?.summary).toBe("Working on the migration.");
      expect(result.currentFocus.own?.id).toBe(result.currentFocus.project?.id);
    });

    it("distinguishes the caller's own most recent Checkpoint from another writer's, Shared-Memory style", async () => {
      await remember({
        content: "Alice's checkpoint.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityA,
        now: new Date("2026-01-01T00:00:00.000Z"),
      });
      await remember({
        content: "Bob's checkpoint.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityB,
        now: new Date("2026-01-02T00:00:00.000Z"),
      });

      const result = overview({ storageRoot, writerIdentityProvider: identityA });

      expect(result.currentFocus.own?.summary).toBe("Alice's checkpoint.");
      expect(result.currentFocus.project?.summary).toBe("Bob's checkpoint.");
    });

    it("picks the most recent Checkpoint by createdAt, not by Strength", async () => {
      await remember({
        content: "Older checkpoint, but recalled recently so it decays slower.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityA,
        now: new Date("2026-01-01T00:00:00.000Z"),
      });
      await remember({
        content: "Most recent checkpoint.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityA,
        now: new Date("2026-01-05T00:00:00.000Z"),
      });

      const result = overview({ storageRoot, writerIdentityProvider: identityA, now: new Date("2026-01-05T00:00:01.000Z") });

      expect(result.currentFocus.own?.summary).toBe("Most recent checkpoint.");
      expect(result.currentFocus.project?.summary).toBe("Most recent checkpoint.");
    });

    it("excludes a stale/retracted Checkpoint from the lookup", async () => {
      const stale = await remember({
        content: "Stale checkpoint.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityA,
        now: new Date("2026-01-05T00:00:00.000Z"),
      });
      const memory = readMemory(storageRoot, "checkpoint", stale.id)!;
      memory.frontmatter.confidence = "stale";
      writeMemory(storageRoot, memory);

      await remember({
        content: "Older but active checkpoint.",
        kind: "checkpoint",
        client: "claude-code",
        storageRoot,
        writerIdentityProvider: identityA,
        now: new Date("2026-01-01T00:00:00.000Z"),
      });

      const result = overview({ storageRoot, writerIdentityProvider: identityA });

      expect(result.currentFocus.own?.summary).toBe("Older but active checkpoint.");
    });
  });
});
