import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consolidate } from "#src/core/consolidate.js";
import { remember } from "#src/core/engine.js";
import { readMemory, writeMemory } from "#src/core/storage.js";
import { gitCommitSubjects, type CommitSubjects, type FileChangeTimestamps } from "#src/core/git.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

/** Every listed file "changed" at a timestamp safely after any Memory's real createdAt. */
function fileChangeTimestampsStub(changedFiles: string[]): FileChangeTimestamps {
  return () => Object.fromEntries(changedFiles.map((file) => [file, FAR_FUTURE]));
}

/** A fixed list of commits, each dated safely after any Memory's real createdAt unless overridden. */
function commitSubjectsStub(commits: { timestamp: string; subject: string }[]): CommitSubjects {
  return () => commits;
}

describe("Invalidation", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-invalidation-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("goes stale, with a populated staleReason, when a related file has been modified", async () => {
    const decision = await remember({
      content: "We chose Postgres for the write model.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      relatedFiles: ["src/db/writeModel.ts"],
    });

    const result = await consolidate({ storageRoot, now: NOW, fileChangeTimestamps: fileChangeTimestampsStub(["src/db/writeModel.ts"]) });

    expect(result.memoriesInvalidated).toBe(1);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("stale");
    expect(after.frontmatter.staleAt).toBe(NOW.toISOString());
    expect(after.frontmatter.staleReason).toMatch(/src\/db\/writeModel\.ts/);
  });

  it("leaves a memory with no relatedFiles untouched, even when files changed", async () => {
    const decision = await remember({
      content: "An unanchored decision.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({ storageRoot, now: NOW, fileChangeTimestamps: fileChangeTimestampsStub(["src/anything.ts"]) });

    expect(result.memoriesInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
    expect(after.frontmatter.staleAt).toBeNull();
  });

  it("skips a memory that's already stale or retracted", async () => {
    const stale = await remember({
      content: "Already-stale decision.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      relatedFiles: ["src/foo.ts"],
    });
    const memory = readMemory(storageRoot, "decision", stale.id)!;
    memory.frontmatter.confidence = "stale";
    memory.frontmatter.staleAt = "2026-01-01T00:00:00.000Z";
    memory.frontmatter.staleReason = "previously invalidated";
    writeMemory(storageRoot, memory);

    const result = await consolidate({ storageRoot, now: NOW, fileChangeTimestamps: fileChangeTimestampsStub(["src/foo.ts"]) });

    expect(result.memoriesInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", stale.id)!;
    expect(after.frontmatter.staleAt).toBe("2026-01-01T00:00:00.000Z");
    expect(after.frontmatter.staleReason).toBe("previously invalidated");
  });

  it("dryRun reports the invalidated count without mutating anything", async () => {
    const decision = await remember({
      content: "We chose Postgres for the write model.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      relatedFiles: ["src/db/writeModel.ts"],
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      dryRun: true,
      fileChangeTimestamps: fileChangeTimestampsStub(["src/db/writeModel.ts"]),
    });

    expect(result.memoriesInvalidated).toBe(1);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
    expect(after.frontmatter.staleAt).toBeNull();
  });
});

describe("Commit Invalidation", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-commit-invalidation-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("goes stale, with a populated staleReason, when a qualifying commit's target appears in an unanchored memory's content", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(1);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("stale");
    expect(after.frontmatter.staleAt).toBe(NOW.toISOString());
    expect(after.frontmatter.staleReason).toMatch(/webpack/);
  });

  it("leaves a memory with relatedFiles set untouched, even when a qualifying commit's target matches its content", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      relatedFiles: ["webpack.config.js"],
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
    expect(after.frontmatter.staleAt).toBeNull();
  });

  it("a commit dated before the memory's createdAt doesn't stale it", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: "2000-01-01T00:00:00.000Z", subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
  });

  it("matches case-insensitively", async () => {
    const decision = await remember({
      content: "We chose WEBPACK for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(1);
  });

  it("is word-boundary-aware: a target like 'vite' does not false-positive inside 'invite'", async () => {
    const decision = await remember({
      content: "Please invite the reviewer to take a look.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "deprecate vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
  });

  it("a trivially short or stopword extracted target doesn't stale anything, even on a literal substring hit", async () => {
    const decision = await remember({
      content: "This is the new plan going forward.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "remove the" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
  });

  it("recognizes all four commit shapes and extracts only the outgoing target (X), never the incoming replacement (Y)", async () => {
    const migrateOld = await remember({ content: "We chose webpack for bundling.", kind: "decision", client: "claude-code", storageRoot });
    const migrateNew = await remember({ content: "We chose vite for bundling.", kind: "decision", client: "claude-code", storageRoot });
    const replaceOld = await remember({ content: "We use jest for unit tests.", kind: "decision", client: "claude-code", storageRoot });
    const replaceNew = await remember({ content: "We use vitest for unit tests.", kind: "decision", client: "claude-code", storageRoot });
    const deprecated = await remember({ content: "We rely on legacyauth for logins.", kind: "decision", client: "claude-code", storageRoot });
    const removed = await remember({ content: "We depend on moment for dates.", kind: "decision", client: "claude-code", storageRoot });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([
        { timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" },
        { timestamp: FAR_FUTURE, subject: "replace jest with vitest" },
        { timestamp: FAR_FUTURE, subject: "deprecate legacyauth" },
        { timestamp: FAR_FUTURE, subject: "remove moment" },
      ]),
    });

    expect(result.memoriesCommitInvalidated).toBe(4);
    expect(readMemory(storageRoot, "decision", migrateOld.id)!.frontmatter.confidence).toBe("stale");
    expect(readMemory(storageRoot, "decision", migrateNew.id)!.frontmatter.confidence).toBe("observed");
    expect(readMemory(storageRoot, "decision", replaceOld.id)!.frontmatter.confidence).toBe("stale");
    expect(readMemory(storageRoot, "decision", replaceNew.id)!.frontmatter.confidence).toBe("observed");
    expect(readMemory(storageRoot, "decision", deprecated.id)!.frontmatter.confidence).toBe("stale");
    expect(readMemory(storageRoot, "decision", removed.id)!.frontmatter.confidence).toBe("stale");
  });

  it("skips a memory that's already stale, leaving staleAt/staleReason untouched", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });
    const memory = readMemory(storageRoot, "decision", decision.id)!;
    memory.frontmatter.confidence = "stale";
    memory.frontmatter.staleAt = "2026-01-01T00:00:00.000Z";
    memory.frontmatter.staleReason = "previously invalidated";
    writeMemory(storageRoot, memory);

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.staleAt).toBe("2026-01-01T00:00:00.000Z");
    expect(after.frontmatter.staleReason).toBe("previously invalidated");
  });

  it("skips a memory that's already retracted, leaving retractedAt/retractReason untouched", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });
    const memory = readMemory(storageRoot, "decision", decision.id)!;
    memory.frontmatter.confidence = "retracted";
    memory.frontmatter.retractedAt = "2026-01-01T00:00:00.000Z";
    memory.frontmatter.retractReason = "superseded";
    writeMemory(storageRoot, memory);

    const result = await consolidate({
      storageRoot,
      now: NOW,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(0);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("retracted");
    expect(after.frontmatter.staleAt).toBeNull();
    expect(after.frontmatter.retractedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(after.frontmatter.retractReason).toBe("superseded");
  });

  it("dryRun reports memoriesCommitInvalidated without mutating anything", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });

    const result = await consolidate({
      storageRoot,
      now: NOW,
      dryRun: true,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(1);
    const after = readMemory(storageRoot, "decision", decision.id)!;
    expect(after.frontmatter.confidence).toBe("observed");
    expect(after.frontmatter.staleAt).toBeNull();
  });

  it("a memory also eligible for Pruning in the same pass is still evaluated by Commit Invalidation before removal", async () => {
    const decision = await remember({
      content: "We chose webpack for bundling.",
      kind: "decision",
      client: "claude-code",
      storageRoot,
    });
    const memory = readMemory(storageRoot, "decision", decision.id)!;
    // 200 days ago is far enough past the base half-life + grace period to decay under the prune threshold.
    memory.frontmatter.createdAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    writeMemory(storageRoot, memory);

    const result = await consolidate({
      storageRoot,
      commitSubjects: commitSubjectsStub([{ timestamp: FAR_FUTURE, subject: "migrate build from webpack to vite" }]),
    });

    expect(result.memoriesCommitInvalidated).toBe(1);
    expect(result.memoriesPruned).toBe(1);
    expect(readMemory(storageRoot, "decision", decision.id)).toBeNull();
  });

  it("the real git-backed gitCommitSubjects never throws — a non-repo directory yields no commits", () => {
    const nonRepoDir = mkdtempSync(join(tmpdir(), "raiminiscence-non-repo-"));
    try {
      expect(gitCommitSubjects(nonRepoDir)).toEqual([]);
    } finally {
      rmSync(nonRepoDir, { recursive: true, force: true });
    }
  });
});
