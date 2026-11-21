import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { feedback, forget, recall, remember } from "#src/core/engine.js";

describe("scope: project vs. global", () => {
  let projectA: string;
  let projectB: string;
  let globalStorageRoot: string;

  beforeEach(() => {
    projectA = mkdtempSync(join(tmpdir(), "raiminiscence-project-a-"));
    projectB = mkdtempSync(join(tmpdir(), "raiminiscence-project-b-"));
    globalStorageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-global-"));
    mkdirSync(join(projectA, ".git"));
    writeFileSync(join(projectA, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:example/project-a.git\n');
  });

  afterEach(() => {
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
    rmSync(globalStorageRoot, { recursive: true, force: true });
  });

  it("a global memory is recallable from a different project and shows its originatingProject", async () => {
    await remember({
      content: "Prefer trunk-based development across all our repos.",
      client: "claude-code",
      scope: "global",
      storageRoot: projectA,
      globalStorageRoot,
    });

    const fromProjectB = await recall({
      query: "trunk-based development",
      scope: "global",
      storageRoot: projectB,
      globalStorageRoot,
    });

    expect(fromProjectB.results).toHaveLength(1);

    const episodicDir = join(globalStorageRoot, ".raiminiscence", "memory", "episodic");
    const memoryFile = readdirSync(episodicDir)[0]!;
    const contents = readFileSync(join(episodicDir, memoryFile), "utf8");
    expect(contents).toContain("git@github.com:example/project-a");
  });

  it("keeps project-scope and global-scope storage isolated", async () => {
    await remember({ content: "Project-local observation.", client: "claude-code", storageRoot: projectA, globalStorageRoot });
    await remember({
      content: "Globally-applicable pattern.",
      client: "claude-code",
      scope: "global",
      storageRoot: projectA,
      globalStorageRoot,
    });

    const projectResults = await recall({ query: "observation pattern", storageRoot: projectA, globalStorageRoot });
    const globalResults = await recall({ query: "observation pattern", scope: "global", storageRoot: projectA, globalStorageRoot });

    expect(projectResults.results).toHaveLength(1);
    expect(projectResults.results[0]!.summary).toBe("Project-local observation.");
    expect(globalResults.results).toHaveLength(1);
    expect(globalResults.results[0]!.summary).toBe("Globally-applicable pattern.");
  });

  it('forget can retract a global-scope memory when scope: "global" is passed', async () => {
    const remembered = await remember({
      content: "A globally-scoped mistake.",
      client: "claude-code",
      scope: "global",
      storageRoot: projectA,
      globalStorageRoot,
    });

    const result = forget({ id: remembered.id, scope: "global", storageRoot: projectA, globalStorageRoot });
    expect(result).toEqual({ id: remembered.id, alreadyRetracted: false });

    const recalled = await recall({
      query: "globally-scoped mistake",
      scope: "global",
      storageRoot: projectA,
      globalStorageRoot,
    });
    expect(recalled.results).toEqual([]);
  });

  it("forget without scope can't reach a global-scope memory by id", async () => {
    const remembered = await remember({
      content: "Only reachable via global scope.",
      client: "claude-code",
      scope: "global",
      storageRoot: projectA,
      globalStorageRoot,
    });

    expect(() => forget({ id: remembered.id, storageRoot: projectA, globalStorageRoot })).toThrow(new RegExp(remembered.id));
  });

  it('feedback can be given on a global-scope memory when scope: "global" is passed', async () => {
    const remembered = await remember({
      content: "A globally-scoped helpful pattern.",
      client: "claude-code",
      scope: "global",
      storageRoot: projectA,
      globalStorageRoot,
    });

    const result = feedback({ id: remembered.id, wasHelpful: true, scope: "global", storageRoot: projectA, globalStorageRoot });
    expect(result).toEqual({ id: remembered.id, wasHelpful: true });
  });
});
