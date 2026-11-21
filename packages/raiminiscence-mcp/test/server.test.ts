import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "#src/server.js";
import { createFrontmatter } from "#src/core/create-frontmatter.js";
import { readMemory, writeMemory } from "#src/core/storage.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";
import { readPackedIndex } from "#src/core/embeddings/packed-index.js";
import { settlePendingEmbeds } from "#src/core/pending-embeds.js";

/** Deterministic stand-in for a real Ollama instance — always misses, exercising the lexical fallback path regardless of the local machine's Ollama status. */
const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

/**
 * MCP tool-layer tests: what the core-engine seam can't cover from here —
 * schema-level rejection, a tool's exact I/O shape/`isError` behavior, and
 * `consolidate`'s response shape as seen by an actual MCP client.
 */
async function connectedClient(embeddingProvider?: EmbeddingProvider) {
  const server = createServer({ embeddingProvider });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function jsonOf(result: { content: { type: string; text?: string }[] }): unknown {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync("git", args, { cwd, env: { ...process.env, ...env } });
}

describe("MCP server tool layer", () => {
  let storageRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-server-"));
    originalCwd = process.cwd();
    process.chdir(storageRoot);
  });

  afterEach(async () => {
    await settlePendingEmbeds(1_000);
    process.chdir(originalCwd);
    // Retries: the refreshing writer identity (ADR-0041) leaves a `git config` child running in storageRoot,
    // and Windows refuses to remove a process's working directory until it exits. Git starts slowly there.
    rmSync(storageRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  });

  it("remember answers before the vector is written, and the vector follows (ADR-0041)", async () => {
    const content = "Kafka consumer lag spikes after deploys.";
    const client = await connectedClient({ identity: { provider: "stub", model: "stub" }, embed: async () => [1, 0] });

    const remembered = jsonOf((await client.callTool({ name: "remember", arguments: { content } })) as never) as { id: string; embedded: unknown };
    expect(remembered.embedded).toBe("pending");

    await settlePendingEmbeds(1_000);
    expect(readPackedIndex(process.cwd())[remembered.id]?.vector).toEqual([1, 0]);
  });

  it("rejects remember's confidence at the schema level for stale/retracted, before it reaches the engine", async () => {
    const client = await connectedClient();

    const staleAttempt = await client.callTool({ name: "remember", arguments: { content: "x", confidence: "stale" } });
    expect(staleAttempt.isError).toBe(true);
    expect((staleAttempt.content as { text: string }[])[0]!.text).toMatch(/confidence/);

    const retractedAttempt = await client.callTool({ name: "remember", arguments: { content: "x", confidence: "retracted" } });
    expect(retractedAttempt.isError).toBe(true);
    expect((retractedAttempt.content as { text: string }[])[0]!.text).toMatch(/confidence/);
  });

  it("feedback's exact I/O shape on success, and isError on a genuinely unknown id", async () => {
    const client = await connectedClient();

    const remembered = jsonOf((await client.callTool({ name: "remember", arguments: { content: "A helpful memory." } })) as never) as { id: string };

    const result = await client.callTool({ name: "feedback", arguments: { id: remembered.id, wasHelpful: true } });
    expect(result.isError).toBeFalsy();
    expect(jsonOf(result as never)).toEqual({ id: remembered.id, wasHelpful: true });

    const errorResult = await client.callTool({ name: "feedback", arguments: { id: "nonexistent-id", wasHelpful: true } });
    expect(errorResult.isError).toBe(true);
  });

  it("recall's surfacedVia survives the tool's JSON serialization, and an older client's maxHops is accepted and ignored (ADR-0037)", async () => {
    const client = await connectedClient(unreachableProvider);
    const query = "database write durability";
    const remembered = jsonOf(
      (await client.callTool({
        name: "remember",
        arguments: { content: "Postgres chosen for transactional write durability" },
      })) as never,
    ) as { id: string };

    const response = (await client.callTool({ name: "recall", arguments: { query, maxHops: 3 } })) as { isError?: boolean };
    const result = jsonOf(response as never) as { results: { id: string; surfacedVia: string }[] };

    expect(response.isError).toBeFalsy();
    expect(result.results).toEqual([expect.objectContaining({ id: remembered.id, surfacedVia: "match" })]);
  });

  it("consolidate reports memoriesInvalidated for a git-tracked related file changed after createdAt, and dryRun leaves it un-mutated", async () => {
    git(storageRoot, ["init", "-q"]);
    git(storageRoot, ["config", "user.email", "test@example.com"]);
    git(storageRoot, ["config", "user.name", "Test"]);
    writeFileSync(join(storageRoot, "foo.ts"), "export const x = 1;\n");
    git(storageRoot, ["add", "foo.ts"]);
    git(storageRoot, ["commit", "-q", "-m", "initial"]);

    // Written directly (not via the `remember` tool) so this test isn't
    // racing remember/recall's opportunistic background consolidation.
    const memory = {
      frontmatter: createFrontmatter({
        kind: "decision" as const,
        confidence: "observed" as const,
        createdAt: new Date().toISOString(),
        source: { client: "test" },
        scope: "project" as const,
        relatedFiles: ["foo.ts"],
      }),
      body: "A decision anchored to foo.ts.",
    };
    writeMemory(storageRoot, memory);

    // A future-dated commit guarantees it postdates the Memory's createdAt
    // regardless of how fast this test executes.
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    writeFileSync(join(storageRoot, "foo.ts"), "export const x = 2;\n");
    git(storageRoot, ["add", "foo.ts"]);
    git(storageRoot, ["commit", "-q", "-m", "update"], { GIT_AUTHOR_DATE: future, GIT_COMMITTER_DATE: future });

    const client = await connectedClient();

    const dryRunResult = jsonOf((await client.callTool({ name: "consolidate", arguments: { dryRun: true } })) as never) as {
      memoriesInvalidated: number;
      blockedJoinAttempts: number;
      feedbackExcludedCount: number;
      promotionAuditConflictCount: number;
      promotionAuditFeedbackCount: number;
      memoriesCommitInvalidated: number;
    };
    expect(dryRunResult.memoriesInvalidated).toBe(1);
    expect(dryRunResult.blockedJoinAttempts).toBe(0);
    expect(dryRunResult.feedbackExcludedCount).toBe(0);
    expect(dryRunResult.promotionAuditConflictCount).toBe(0);
    expect(dryRunResult.promotionAuditFeedbackCount).toBe(0);
    expect(dryRunResult.memoriesCommitInvalidated).toBe(0);
    expect(readMemory(storageRoot, "decision", memory.frontmatter.id)?.frontmatter.confidence).toBe("observed");

    const result = jsonOf((await client.callTool({ name: "consolidate", arguments: {} })) as never) as {
      memoriesInvalidated: number;
      blockedJoinAttempts: number;
      feedbackExcludedCount: number;
      promotionAuditConflictCount: number;
      promotionAuditFeedbackCount: number;
      memoriesCommitInvalidated: number;
    };
    expect(result.memoriesInvalidated).toBe(1);
    expect(result.blockedJoinAttempts).toBe(0);
    expect(result.feedbackExcludedCount).toBe(0);
    expect(result.promotionAuditConflictCount).toBe(0);
    expect(result.promotionAuditFeedbackCount).toBe(0);
    expect(result.memoriesCommitInvalidated).toBe(0);
    expect(readMemory(storageRoot, "decision", memory.frontmatter.id)?.frontmatter.confidence).toBe("stale");
  });

  it("conflict tool records and reads back each verdict, and overwrites on a later call for the same pair", async () => {
    const client = await connectedClient();

    const a = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use Postgres." } })) as never) as { id: string };
    const b = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use MySQL." } })) as never) as { id: string };

    const contradicts = await client.callTool({
      name: "conflict",
      arguments: { memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts" },
    });
    expect(contradicts.isError).toBeFalsy();
    expect(jsonOf(contradicts as never)).toEqual({ memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts" });

    const overwritten = await client.callTool({
      name: "conflict",
      arguments: { memoryId: a.id, otherMemoryId: b.id, verdict: "no-conflict" },
    });
    expect(jsonOf(overwritten as never)).toEqual({ memoryId: a.id, otherMemoryId: b.id, verdict: "no-conflict" });

    const recalled = jsonOf((await client.callTool({ name: "recall", arguments: { query: "Postgres MySQL decision" } })) as never) as {
      results: { id: string; conflictsWith?: string[] }[];
    };
    expect(recalled.results.find((r) => r.id === a.id)?.conflictsWith).toBeUndefined();
  });

  it('conflict tool\'s "supersedes" verdict performs the same retraction as forget, including the already-retracted case, and rejects an unknown id', async () => {
    const client = await connectedClient();

    const older = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use REST." } })) as never) as { id: string };
    const newer = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use GraphQL." } })) as never) as { id: string };

    const first = await client.callTool({
      name: "conflict",
      arguments: { memoryId: older.id, otherMemoryId: newer.id, verdict: "supersedes", retractedId: older.id },
    });
    expect(jsonOf(first as never)).toEqual({
      memoryId: older.id,
      otherMemoryId: newer.id,
      verdict: "supersedes",
      alreadyRetracted: false,
    });

    const second = await client.callTool({
      name: "conflict",
      arguments: { memoryId: older.id, otherMemoryId: newer.id, verdict: "supersedes", retractedId: older.id },
    });
    expect((jsonOf(second as never) as { alreadyRetracted: boolean }).alreadyRetracted).toBe(true);

    const unknownId = await client.callTool({
      name: "conflict",
      arguments: { memoryId: "nonexistent-id", otherMemoryId: newer.id, verdict: "no-conflict" },
    });
    expect(unknownId.isError).toBe(true);
  });

  it("recall's conflictCandidateWith and conflictsWith survive the tool's JSON serialization end-to-end", async () => {
    const client = await connectedClient(unreachableProvider);

    const a = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use Postgres for durability." } })) as never) as {
      id: string;
    };
    const b = jsonOf(
      (await client.callTool({ name: "remember", arguments: { content: "Decision: use Postgres for durability, alternate wording." } })) as never,
    ) as { id: string };

    const recalled = jsonOf((await client.callTool({ name: "recall", arguments: { query: "durability decision" } })) as never) as {
      results: { id: string; conflictCandidateWith?: string[]; conflictsWith?: string[] }[];
    };

    // The injected always-null embedding provider means candidate detection
    // can't run (no stored vectors) — this asserts the field survives
    // serialisation as `undefined` rather than crashing or stringifying to
    // something unexpected, complementing the core-engine tests that
    // exercise the populated case directly.
    const entryA = recalled.results.find((r) => r.id === a.id);
    expect(entryA).toBeDefined();
    expect(entryA?.conflictCandidateWith).toBeUndefined();

    await client.callTool({ name: "conflict", arguments: { memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts" } });

    const recalledAfterVerdict = jsonOf((await client.callTool({ name: "recall", arguments: { query: "durability decision" } })) as never) as {
      results: { id: string; conflictsWith?: string[] }[];
    };
    expect(recalledAfterVerdict.results.find((r) => r.id === a.id)?.conflictsWith).toEqual([b.id]);
    expect(recalledAfterVerdict.results.find((r) => r.id === b.id)?.conflictsWith).toEqual([a.id]);
  });

  it("overview's conflictsWith survives the tool's JSON serialization end-to-end", async () => {
    const client = await connectedClient();

    const a = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use Postgres.", kind: "decision" } })) as never) as {
      id: string;
    };
    const b = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Decision: use MySQL.", kind: "decision" } })) as never) as {
      id: string;
    };

    await client.callTool({ name: "conflict", arguments: { memoryId: a.id, otherMemoryId: b.id, verdict: "contradicts" } });

    const result = jsonOf((await client.callTool({ name: "overview", arguments: {} })) as never) as {
      results: { id: string; conflictsWith?: string[] }[];
    };
    expect(result.results.find((r) => r.id === a.id)?.conflictsWith).toEqual([b.id]);
    expect(result.results.find((r) => r.id === b.id)?.conflictsWith).toEqual([a.id]);
  });

  it("inspect's id mode routes to inspectMemory and reports Strength/reinforcement", async () => {
    const client = await connectedClient();

    const remembered = jsonOf((await client.callTool({ name: "remember", arguments: { content: "A memory worth inspecting." } })) as never) as {
      id: string;
    };

    const result = await client.callTool({ name: "inspect", arguments: { id: remembered.id } });
    expect(result.isError).toBeFalsy();
    const parsed = jsonOf(result as never) as { id: string; strength: number; reinforcement: { recallCount: number } };
    expect(parsed.id).toBe(remembered.id);
    expect(parsed.strength).toBeGreaterThan(0);
    expect(parsed.reinforcement.recallCount).toBe(0);

    const errorResult = await client.callTool({ name: "inspect", arguments: { id: "nonexistent-id" } });
    expect(errorResult.isError).toBe(true);
  });

  it("inspect's query mode routes to inspectQuery, defaults to compact (near-misses collapsed to a count), and never mutates recallCount", async () => {
    const client = await connectedClient();

    const remembered = jsonOf((await client.callTool({ name: "remember", arguments: { content: "Postgres chosen for durability." } })) as never) as {
      id: string;
    };

    const compact = jsonOf((await client.callTool({ name: "inspect", arguments: { query: "durability decision" } })) as never) as {
      results: unknown[];
      nearMissesHidden: number;
      nearMisses?: unknown;
    };
    expect(compact.nearMissesHidden).toBeDefined();
    expect(compact.nearMisses).toBeUndefined();

    const detailed = jsonOf(
      (await client.callTool({ name: "inspect", arguments: { query: "durability decision", verbosity: "detailed" } })) as never,
    ) as { nearMisses: unknown[]; nearMissesHidden?: number };
    expect(Array.isArray(detailed.nearMisses)).toBe(true);
    expect(detailed.nearMissesHidden).toBeUndefined();

    const afterInspect = readMemory(storageRoot, "episodic", remembered.id);
    expect(afterInspect?.frontmatter.recallCount).toBe(0);
    expect(afterInspect?.frontmatter.lastRecalledAt).toBeNull();
  });

  it("inspect's list mode routes to browseMemories, compact by default (id/kind/strength/confidence only) and full detail when detailed", async () => {
    const client = await connectedClient();

    await client.callTool({ name: "remember", arguments: { content: "A decision to browse.", kind: "decision" } });

    const compact = jsonOf((await client.callTool({ name: "inspect", arguments: { list: true, filters: { kind: "decision" } } })) as never) as {
      id: string;
      kind: string;
      strength: number;
      confidence: string;
      effectiveHalfLifeDays?: number;
    }[];
    expect(compact).toHaveLength(1);
    expect(Object.keys(compact[0]!).sort()).toEqual(["confidence", "id", "kind", "strength"]);

    const detailed = jsonOf(
      (await client.callTool({
        name: "inspect",
        arguments: { list: true, filters: { kind: "decision" }, verbosity: "detailed" },
      })) as never,
    ) as { effectiveHalfLifeDays: number }[];
    expect(detailed[0]!.effectiveHalfLifeDays).toBeDefined();
  });

  it("inspect rejects malformed input: both id and query set, or neither", async () => {
    const client = await connectedClient();

    const both = await client.callTool({ name: "inspect", arguments: { id: "x", query: "y" } });
    expect(both.isError).toBe(true);
    expect((both.content as { text: string }[])[0]!.text).toMatch(/exactly one/);

    const neither = await client.callTool({ name: "inspect", arguments: {} });
    expect(neither.isError).toBe(true);
    expect((neither.content as { text: string }[])[0]!.text).toMatch(/exactly one/);
  });
});
