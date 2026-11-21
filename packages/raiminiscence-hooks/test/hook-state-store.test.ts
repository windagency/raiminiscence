import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonSessionStore } from "#src/hook-state-store.js";

interface TestState {
  count: number;
}

function parseTestState(json: unknown): TestState | undefined {
  const count = (json as { count?: unknown } | null)?.count;
  return typeof count === "number" ? { count } : undefined;
}

/**
 * `checkpoint-nudge.test.ts` and `fix-nudge.test.ts` both inject a fake
 * in-memory `stateStore` and never exercise this file's real
 * `jsonSessionStore` — the actual disk read/write, path encoding, corrupt-JSON
 * recovery, and gitignore side effect every hook invocation relies on in
 * production. This suite exercises `jsonSessionStore` itself against a real
 * temp directory (integration test: the change under test crosses the
 * filesystem boundary, per `CODING_RULES/13-testing-strategy.md`).
 */
describe("jsonSessionStore (real on-disk state store)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-hook-state-store-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("round-trips a write then read for the same session", () => {
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    store.write("s1", { count: 3 });
    expect(store.read("s1")).toEqual({ count: 3 });
  });

  it("returns undefined for a session that was never written", () => {
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    expect(store.read("never-written")).toBeUndefined();
  });

  it("keeps different subdirs' state independent on disk", () => {
    const checkpointStore = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    const fixNudgeStore = jsonSessionStore(storageRoot, "fix-nudge", parseTestState);
    checkpointStore.write("s1", { count: 1 });
    expect(fixNudgeStore.read("s1")).toBeUndefined();
  });

  it("path-encodes a session id so it round-trips and cannot escape the subdir, even when it contains `../` and `/`", () => {
    // Real session ids are opaque strings supplied by the host client (Claude
    // Code, Cursor); nothing in this codebase documents a restricted
    // charset. This id is deliberately adversarial rather than realistic, to
    // prove `encodeURIComponent` in `jsonSessionStore` confines the write to
    // one file inside <subdir> instead of letting a path-traversal-shaped id
    // escape it.
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    const sessionId = "../../etc/passwd-session";
    store.write(sessionId, { count: 42 });

    expect(store.read(sessionId)).toEqual({ count: 42 });

    const subdir = join(storageRoot, ".raiminiscence", "hooks-state", "checkpoint-nudge");
    const entries = readdirSync(subdir);
    expect(entries).toEqual([`${encodeURIComponent(sessionId)}.json`]);

    expect(existsSync(join(storageRoot, "etc"))).toBe(false);
  });

  it("recovers from corrupt JSON already on disk at the expected path, treating the session as having no prior state", () => {
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    const path = join(storageRoot, ".raiminiscence", "hooks-state", "checkpoint-nudge", `${encodeURIComponent("s1")}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not valid json", "utf8");

    expect(store.read("s1")).toBeUndefined();
  });

  it("treats well-formed JSON of the wrong shape as no prior state", () => {
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    const path = join(storageRoot, ".raiminiscence", "hooks-state", "checkpoint-nudge", `${encodeURIComponent("s1")}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ count: "three" }), "utf8");
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(store.read("s1")).toBeUndefined();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("unexpected shape"));
    stderr.mockRestore();
  });

  it("adds the .raiminiscence/ gitignore entry on write when the storage root is a git repo", () => {
    mkdirSync(join(storageRoot, ".git"));
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    store.write("s1", { count: 1 });

    const gitignorePath = join(storageRoot, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    expect(readFileSync(gitignorePath, "utf8")).toContain(".raiminiscence/");
  });

  it("does not add a gitignore entry when the storage root is not a git repo", () => {
    const store = jsonSessionStore(storageRoot, "checkpoint-nudge", parseTestState);
    store.write("s1", { count: 1 });

    expect(existsSync(join(storageRoot, ".gitignore"))).toBe(false);
  });
});
