import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMemory, remember, writeMemory, type EmbeddingProvider } from "raiminiscence-mcp";
import { runInspectCli } from "#src/run.js";

const NO_CONSOLIDATION = { triggerConsolidation: false } as const;

function stubProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    identity: { provider: "stub", model: "stub" },
    async embed(text: string) {
      return vectors[text] ?? null;
    },
  };
}

describe("runInspectCli", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-cli-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("scenario: a heavily-reinforced Decision memory — id mode with --detailed prints a full panel with Strength/Half-life/Ceiling/reinforcement", async () => {
    const remembered = await remember({
      content: "Chose Postgres for the write model",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      ...NO_CONSOLIDATION,
    });
    const memory = readMemory(storageRoot, "decision", remembered.id)!;
    memory.frontmatter.recallCount = 4;
    memory.frontmatter.positiveFeedbackCount = 2;
    writeMemory(storageRoot, memory);

    const output = await runInspectCli([remembered.id, "--detailed"], { storageRoot });

    expect(output).toContain("┌─ Decision");
    expect(output).toContain("Strength");
    expect(output).toContain("Half-life");
    expect(output).toContain("Ceiling used");
    expect(output).toContain("Confidence Tier");
    expect(output).toContain("4x Recall hit");
    expect(output).toContain("2x positive Outcome Feedback");
    expect(output).toContain("└─");
  });

  it("id mode: compact by default, one line matching browse's compact shape; --detailed renders the full panel and the two differ", async () => {
    const remembered = await remember({
      content: "Chose Postgres for the write model",
      kind: "decision",
      client: "claude-code",
      storageRoot,
      ...NO_CONSOLIDATION,
    });

    const compact = await runInspectCli([remembered.id], { storageRoot });
    expect(compact).not.toContain("┌─");
    expect(compact).toMatch(new RegExp(`^${remembered.id}  \\[decision, \\w+\\]  strength \\d\\.\\d\\d$`));

    const detailed = await runInspectCli([remembered.id, "--detailed"], { storageRoot });
    expect(detailed).toContain("┌─ Decision");
    expect(detailed).not.toBe(compact);
  });

  it("scenario: an excluded stale candidate — query mode reports it as a near-miss, hidden by default and shown with --detailed", async () => {
    const query = "auth token approach";
    const staleContent = "Session tokens via signed JWT, no refresh rotation";
    const provider = stubProvider({ [query]: [1, 0], [staleContent]: [1, 0] });

    const remembered = await remember({
      content: staleContent,
      kind: "semantic",
      client: "claude-code",
      storageRoot,
      embeddingProvider: provider,
      ...NO_CONSOLIDATION,
    });
    const memory = readMemory(storageRoot, "semantic", remembered.id)!;
    memory.frontmatter.confidence = "stale";
    writeMemory(storageRoot, memory);

    const compact = await runInspectCli(["--query=" + query], { storageRoot, embeddingProvider: provider });
    expect(compact).toContain("near-miss");
    expect(compact).toContain("--detailed");
    expect(compact).not.toContain("excluded: stale");

    const detailed = await runInspectCli(["--query=" + query, "--detailed"], { storageRoot, embeddingProvider: provider });
    expect(detailed).toContain("excluded: stale");
    expect(detailed).toContain(remembered.id);
  });

  it("browse mode: compact by default, one line per memory, full panel with --detailed", async () => {
    await remember({ content: "A decision to browse", kind: "decision", client: "claude-code", storageRoot, ...NO_CONSOLIDATION });

    const compact = await runInspectCli(["--list", "--kind=decision"], { storageRoot });
    expect(compact).not.toContain("┌─");
    expect(compact).toMatch(/strength \d\.\d\d/);

    const detailed = await runInspectCli(["--list", "--kind=decision", "--detailed"], { storageRoot });
    expect(detailed).toContain("┌─ Decision");
    expect(detailed).toContain("Reinforced by");
  });

  it("reports 'no memories matched' for an empty browse result, rather than an empty string", async () => {
    const output = await runInspectCli(["--list", "--kind=checkpoint"], { storageRoot });
    expect(output).toBe("(no memories matched)");
  });

  it("rejects a nonsensical flag combination the same way parseArgs does", async () => {
    await expect(runInspectCli(["mem_123", "--list"], { storageRoot })).rejects.toThrow(/exactly one/);
  });
});
