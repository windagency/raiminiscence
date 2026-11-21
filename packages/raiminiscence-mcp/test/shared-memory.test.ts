import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureSharedMemoryWorktree, isSharedMemoryWorktree, SHARED_MEMORY_BRANCH } from "#src/core/shared-memory/setup.js";
import { flushSharedMemory, pullSharedMemory, settlePendingSharedMemoryPush } from "#src/core/shared-memory/sync.js";
import { writeRecord, readRecord } from "#src/core/record-index.js";
import { runGitAsync, type RunGit, type RunGitAsync } from "#src/core/shared-memory/git.js";

const MERGE_DRIVER_DIST = join(__dirname, "..", "dist", "core", "shared-memory", "merge-driver-cli.js");

/**
 * Real, unmocked git end-to-end coverage — a mocked-out git layer would
 * validate almost nothing about a subsystem whose entire correctness is
 * "does real git actually do what we think". Covers worktree setup/opt-in,
 * sync automation, and the merge driver in this one file, against real
 * temporary git repos.
 */
describe("Shared Memory: git worktree setup, sync automation, merge driver", () => {
  let workDir: string;
  let remoteDir: string;

  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  }

  function initMachine(dir: string): void {
    mkdirSync(dir, { recursive: true });
    git(dir, ["clone", remoteDir, "."]);
    git(dir, ["config", "user.name", "Test Writer"]);
    git(dir, ["config", "user.email", "writer@example.com"]);
  }

  beforeAll(() => {
    // The merge driver runs as a real subprocess git invokes by path — it
    // needs the compiled artifact to exist, exactly as it would for an
    // installed package. Requires `pnpm build` first, like
    // `raiminiscence-hooks`' shim-contract suite. Never rebuilt here: a
    // `tsc` run rewriting `dist/` mid-suite broke that suite's shim
    // subprocess, which loads this package's `dist/` from a parallel worker.
    if (!existsSync(MERGE_DRIVER_DIST)) {
      throw new Error(`${MERGE_DRIVER_DIST} does not exist — run \`pnpm build\` before running this suite.`);
    }
  });

  beforeEach(() => {
    remoteDir = mkdtempSync(join(tmpdir(), "raiminiscence-shared-memory-remote-"));
    git(remoteDir, ["init", "--bare", "-q"]);
    workDir = mkdtempSync(join(tmpdir(), "raiminiscence-shared-memory-work-"));
  });

  afterEach(() => {
    rmSync(remoteDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("opts in on a fresh repo: creates the orphan branch, the worktree, and registers the merge driver", () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);

    ensureSharedMemoryWorktree(machineDir);

    expect(isSharedMemoryWorktree(machineDir)).toBe(true);
    const attributes = readFileSync(join(machineDir, ".raiminiscence", "memory", ".gitattributes"), "utf8");
    expect(attributes).toContain("co-access/* merge=raiminiscence-memory");
    expect(attributes).toContain("conflict/* merge=raiminiscence-memory");
    expect(attributes).toContain("embeddings/* merge=raiminiscence-memory");
    expect(attributes).toContain("*.md merge=raiminiscence-memory");

    const driverConfig = git(machineDir, ["config", "--get", "merge.raiminiscence-memory.driver"]).trim();
    expect(driverConfig).toContain("merge-driver-cli.js");

    const branches = git(machineDir, ["branch", "--list", SHARED_MEMORY_BRANCH]);
    expect(branches).toContain(SHARED_MEMORY_BRANCH);
  });

  it("opts in on a repo with pre-existing local Memories: they become the worktree's initial commit", () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);

    const preExistingDir = join(machineDir, ".raiminiscence", "memory", "episodic");
    mkdirSync(preExistingDir, { recursive: true });
    writeFileSync(join(preExistingDir, "pre-existing.md"), "---\nid: pre-existing\n---\nAlready here before opt-in.", "utf8");

    ensureSharedMemoryWorktree(machineDir);

    expect(existsSync(join(machineDir, ".raiminiscence", "memory", "episodic", "pre-existing.md"))).toBe(true);
    const log = git(join(machineDir, ".raiminiscence", "memory"), ["log", "--oneline"]);
    expect(log).toContain("seed shared memory");
  });

  it("is idempotent: running setup twice makes no further changes", () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);

    ensureSharedMemoryWorktree(machineDir);
    const headAfterFirst = git(join(machineDir, ".raiminiscence", "memory"), ["rev-parse", "HEAD"]);

    ensureSharedMemoryWorktree(machineDir);
    const headAfterSecond = git(join(machineDir, ".raiminiscence", "memory"), ["rev-parse", "HEAD"]);

    expect(headAfterSecond).toBe(headAfterFirst);
  });

  it("surfaces a clear error rather than a silent fallback when git is unavailable", () => {
    const machineDir = join(workDir, "machine-a");
    mkdirSync(machineDir, { recursive: true });

    const brokenGit: RunGit = () => {
      throw new Error("spawn git ENOENT");
    };

    expect(() => ensureSharedMemoryWorktree(machineDir, brokenGit)).toThrow(/git/i);
    expect(isSharedMemoryWorktree(machineDir)).toBe(false);
  });

  it("a clean fast-forward pull applies silently (no files reported as auto-resolved)", async () => {
    const machineADir = join(workDir, "machine-a");
    const machineBDir = join(workDir, "machine-b");
    initMachine(machineADir);
    ensureSharedMemoryWorktree(machineADir);
    await flushSharedMemory(machineADir, { awaitPush: true });

    initMachine(machineBDir);
    ensureSharedMemoryWorktree(machineBDir);

    // Machine A writes something new and flushes it upstream.
    writeRecord(machineADir, "co-access", "m1|m2", { weight: 2, updatedAt: "2026-01-01T00:00:00.000Z" });
    await flushSharedMemory(machineADir, { awaitPush: true });

    const result = pullSharedMemory(machineBDir);

    expect(result.pulled).toBe(true);
    expect(result.autoResolvedFiles).toEqual([]);
    expect(readRecord(machineBDir, "co-access", "m1|m2")).toEqual({ weight: 2, updatedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("a genuine conflicting merge invokes the registered driver end-to-end, and the later updatedAt wins", async () => {
    const machineADir = join(workDir, "machine-a");
    const machineBDir = join(workDir, "machine-b");
    initMachine(machineADir);
    ensureSharedMemoryWorktree(machineADir);
    await flushSharedMemory(machineADir, { awaitPush: true });

    initMachine(machineBDir);
    ensureSharedMemoryWorktree(machineBDir);

    // Two writers independently touch the *same* record from the same base.
    writeRecord(machineADir, "conflict", "m1|m2", {
      verdict: "no-conflict",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await flushSharedMemory(machineADir, { awaitPush: true }); // A pushes first — remote now ahead of B.

    writeRecord(machineBDir, "conflict", "m1|m2", {
      verdict: "contradicts",
      updatedAt: "2026-01-02T00:00:00.000Z", // later than A's write
    });
    await flushSharedMemory(machineBDir, { awaitPush: true }); // B's push is rejected (non-fast-forward) and swallowed — still local-only.

    const result = pullSharedMemory(machineBDir);

    expect(result.pulled).toBe(true);
    expect(result.autoResolvedFiles.some((file) => file.includes("conflict"))).toBe(true);
    expect(readRecord(machineBDir, "conflict", "m1|m2")).toEqual({
      verdict: "contradicts",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("a non-fast-forward merge where both sides touched different records reports no auto-resolved files", async () => {
    const machineADir = join(workDir, "machine-a");
    const machineBDir = join(workDir, "machine-b");
    initMachine(machineADir);
    ensureSharedMemoryWorktree(machineADir);
    await flushSharedMemory(machineADir, { awaitPush: true });

    initMachine(machineBDir);
    ensureSharedMemoryWorktree(machineBDir);

    // Each writes to a *different* record from the same base — a real
    // three-way merge (not a fast-forward), but nothing for the merge
    // driver to actually arbitrate.
    writeRecord(machineADir, "co-access", "m1|m2", { weight: 2, updatedAt: "2026-01-01T00:00:00.000Z" });
    await flushSharedMemory(machineADir, { awaitPush: true });

    writeRecord(machineBDir, "co-access", "m3|m4", { weight: 4, updatedAt: "2026-01-01T00:00:00.000Z" });
    await flushSharedMemory(machineBDir, { awaitPush: true }); // push rejected (non-fast-forward), swallowed — still local-only.

    const result = pullSharedMemory(machineBDir);

    expect(result.pulled).toBe(true);
    expect(result.autoResolvedFiles).toEqual([]);
    expect(readRecord(machineBDir, "co-access", "m1|m2")).toEqual({ weight: 2, updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(readRecord(machineBDir, "co-access", "m3|m4")).toEqual({ weight: 4, updatedAt: "2026-01-01T00:00:00.000Z" });
  });

  /**
   * v19 (ADR-0025): `push` specifically becomes non-blocking by default and
   * blocking under `awaitPush: true`, while `add`/`commit` behavior is
   * unchanged — a slow injected `gitAsync` isolates exactly the `push` step
   * without needing a genuinely slow/unreachable real remote.
   */
  function slowPushGit(delayMs: number, settled: { push: boolean }): RunGitAsync {
    return async (cwd, args) => {
      if (args[0] !== "push") return runGitAsync(cwd, args);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      settled.push = true;
      return runGitAsync(cwd, args);
    };
  }

  it("push is non-blocking by default: flushSharedMemory resolves before a slow push settles", async () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);
    ensureSharedMemoryWorktree(machineDir);

    const settled = { push: false };
    await flushSharedMemory(machineDir, {}, { gitAsync: slowPushGit(100, settled) });

    expect(settled.push).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled.push).toBe(true);
  });

  it("awaitPush: true blocks until that push actually settles", async () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);
    ensureSharedMemoryWorktree(machineDir);

    const settled = { push: false };
    await flushSharedMemory(machineDir, { awaitPush: true }, { gitAsync: slowPushGit(100, settled) });

    expect(settled.push).toBe(true);
  });

  it("settlePendingSharedMemoryPush waits for a prior fire-and-forget push to actually settle", async () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);
    ensureSharedMemoryWorktree(machineDir);

    const settled = { push: false };
    void flushSharedMemory(machineDir, {}, { gitAsync: slowPushGit(100, settled) }); // deliberately not awaited

    expect(settled.push).toBe(false);
    await settlePendingSharedMemoryPush();
    expect(settled.push).toBe(true);
  });

  it("add/commit stay synchronous in both modes: the local commit exists immediately, before the (unawaited) push settles", () => {
    const machineDir = join(workDir, "machine-a");
    initMachine(machineDir);
    ensureSharedMemoryWorktree(machineDir);

    writeRecord(machineDir, "co-access", "m1|m2", { weight: 1, updatedAt: "2026-01-01T00:00:00.000Z" });
    void flushSharedMemory(machineDir); // deliberately not awaited

    const worktreeDir = join(machineDir, ".raiminiscence", "memory");
    expect(git(worktreeDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(worktreeDir, ["log", "--oneline"])).toContain("sync memory");
  });
});
