import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProjectRoot, resolveOriginatingProject, resolveStorageRoot, resolveWatchedCommands } from "#src/core/project-root.js";

describe("resolveStorageRoot", () => {
  let repoRoot: string;
  let subpackageA: string;
  let subpackageB: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "raiminiscence-repo-"));
    mkdirSync(join(repoRoot, ".git"));
    subpackageA = join(repoRoot, "packages", "a");
    subpackageB = join(repoRoot, "packages", "b");
    mkdirSync(subpackageA, { recursive: true });
    mkdirSync(subpackageB, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("defaults both monorepo subpackages to the same shared repo-root store", () => {
    expect(resolveStorageRoot(subpackageA)).toBe(detectProjectRoot(subpackageA));
    expect(resolveStorageRoot(subpackageB)).toBe(detectProjectRoot(subpackageB));
    expect(resolveStorageRoot(subpackageA)).toBe(resolveStorageRoot(subpackageB));
  });

  it("honors an opt-in storageRoot override for an isolated subpackage", () => {
    const isolatedStore = join(repoRoot, "packages", "a", ".isolated-store");
    writeFileSync(join(subpackageA, ".raiminiscence.config.json"), JSON.stringify({ storageRoot: ".isolated-store" }));

    expect(resolveStorageRoot(subpackageA)).toBe(isolatedStore);
    // The other subpackage is unaffected and keeps using the shared root.
    expect(resolveStorageRoot(subpackageB)).toBe(repoRoot);
  });
});

describe("resolveWatchedCommands", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-watched-commands-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("defaults to [] (Fix Nudge off) with no config", () => {
    expect(resolveWatchedCommands(projectRoot)).toEqual([]);
  });

  it("still reads a config that carries an older version's maxHops key (ADR-0037)", () => {
    writeFileSync(join(projectRoot, ".raiminiscence.config.json"), JSON.stringify({ maxHops: 2, watchedCommands: ["tsc"] }));
    expect(resolveWatchedCommands(projectRoot)).toEqual(["tsc"]);
  });

  it("resolves the configured array unchanged when present", () => {
    writeFileSync(join(projectRoot, ".raiminiscence.config.json"), JSON.stringify({ watchedCommands: ["tsc", "pytest"] }));
    expect(resolveWatchedCommands(projectRoot)).toEqual(["tsc", "pytest"]);
  });

  it("drops a non-string entry rather than passing it through, since it's about to become a regex pattern", () => {
    writeFileSync(join(projectRoot, ".raiminiscence.config.json"), JSON.stringify({ watchedCommands: ["tsc", 42, null] }));
    expect(resolveWatchedCommands(projectRoot)).toEqual(["tsc"]);
  });

  it("resolves to [] rather than throwing when watchedCommands itself isn't an array", () => {
    writeFileSync(join(projectRoot, ".raiminiscence.config.json"), JSON.stringify({ watchedCommands: "tsc" }));
    expect(resolveWatchedCommands(projectRoot)).toEqual([]);
  });
});

describe("resolveOriginatingProject", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "raiminiscence-origin-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("normalizes a configured git remote URL", () => {
    mkdirSync(join(projectRoot, ".git"));
    writeFileSync(
      join(projectRoot, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:example/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    );

    expect(resolveOriginatingProject(projectRoot)).toBe("git@github.com:example/repo");
  });

  it("falls back to the absolute project-root path when no remote is configured", () => {
    mkdirSync(join(projectRoot, ".git"));
    expect(resolveOriginatingProject(projectRoot)).toBe(projectRoot);
  });
});
