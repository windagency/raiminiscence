import { remember } from "../../packages/raiminiscence-mcp/src/core/engine.js";
import { consolidate } from "../../packages/raiminiscence-mcp/src/core/consolidate.js";
import { readMemory } from "../../packages/raiminiscence-mcp/src/core/storage.js";
import type { MemoryKind } from "../../packages/raiminiscence-mcp/src/core/types.js";
import type { CommitSubjects, FileChangeTimestamps } from "../../packages/raiminiscence-mcp/src/core/git.js";
import { resolveEmbeddingProvider } from "./embedding-provider.js";
import { loadCorpusFile, withTempDir } from "../temp-dir.js";

const embeddingProvider = resolveEmbeddingProvider();

interface ScenarioMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  relatedFiles?: string[];
}

interface Scenario {
  id: string;
  mechanism: "commit-message" | "file-based";
  description: string;
  commitSubject?: string;
  changedFile?: string;
  targetMemories: ScenarioMemory[];
  bystanderMemories: ScenarioMemory[];
}

export interface RaiminiscenceScenarioResult {
  scenarioId: string;
  mechanism: string;
  passed: boolean;
  targets: { id: string; invalidated: boolean }[];
  bystanders: { id: string; invalidated: boolean }[];
  explanation: string;
}

export interface RaiminiscenceInvalidationRun {
  system: "raiminiscence";
  scenarios: RaiminiscenceScenarioResult[];
}

// Every scenario memory is "created" at MEMORY_CREATED_AT; the synthetic
// trigger (commit, or file change) is dated after it, and consolidate()'s
// own `now` is later still — mirroring the project's own
// invalidation.test.ts ordering (createdAt < trigger timestamp <= now).
const MEMORY_CREATED_AT = new Date("2026-09-01T00:00:00.000Z");
const TRIGGER_TIMESTAMP = "2026-09-10T00:00:00.000Z";
const CONSOLIDATE_NOW = new Date("2026-09-15T00:00:00.000Z");

function isInvalidated(storageRoot: string, kind: MemoryKind, id: string): boolean {
  const memory = readMemory(storageRoot, kind, id);
  if (!memory) throw new Error(`Memory ${id} vanished from storage`);
  return memory.frontmatter.confidence === "stale" && memory.frontmatter.staleAt !== null;
}

/**
 * Runs every scenario from invalidation-scenarios.json against a *fresh,
 * isolated temp storageRoot per scenario* (never shared across scenarios or
 * with the recall benchmark, and never shared with hippo-memory's runner),
 * calling the real `consolidate()` entry point — the same production code
 * path `eligibleForCommitInvalidation` (v9, ADR-0014) and
 * `eligibleForInvalidation` (v2) are wired into, exactly as the project's
 * own invalidation.test.ts exercises them. `fileChangeTimestamps`/
 * `commitSubjects` are injected stubs — consolidate()'s own documented seam
 * for this, and the same one its shipped unit tests use — standing in only
 * for git itself, never for rAIminiscence's own invalidation logic.
 */
export async function runRaiminiscenceInvalidationBenchmark(): Promise<RaiminiscenceInvalidationRun> {
  const { scenarios } = loadCorpusFile<{ scenarios: Scenario[] }>("invalidation-scenarios.json");

  const results: RaiminiscenceScenarioResult[] = [];

  for (const scenario of scenarios) {
    await withTempDir(`raiminiscence-bench-inv-${scenario.id}-`, async (storageRoot) => {
      // corpus id -> { ulid, kind } so we can check confidence after
      // consolidate() runs, keyed back to the human-authored fixture id.
      const written = new Map<string, { ulid: string; kind: MemoryKind }>();
      for (const memory of [...scenario.targetMemories, ...scenario.bystanderMemories]) {
        const result = await remember({
          content: memory.content,
          kind: memory.kind,
          client: "benchmark",
          storageRoot,
          relatedFiles: memory.relatedFiles,
          embeddingProvider,
          triggerConsolidation: false,
          now: MEMORY_CREATED_AT,
        });
        written.set(memory.id, { ulid: result.id, kind: result.kind });
      }

      const fileChangeTimestamps: FileChangeTimestamps = () =>
        scenario.mechanism === "file-based" && scenario.changedFile ? { [scenario.changedFile]: TRIGGER_TIMESTAMP } : {};
      const commitSubjects: CommitSubjects = () =>
        scenario.mechanism === "commit-message" && scenario.commitSubject ? [{ timestamp: TRIGGER_TIMESTAMP, subject: scenario.commitSubject }] : [];

      await consolidate({ storageRoot, now: CONSOLIDATE_NOW, fileChangeTimestamps, commitSubjects });

      const targets = scenario.targetMemories.map((memory) => {
        const { ulid, kind } = written.get(memory.id)!;
        return { id: memory.id, invalidated: isInvalidated(storageRoot, kind, ulid) };
      });
      const bystanders = scenario.bystanderMemories.map((memory) => {
        const { ulid, kind } = written.get(memory.id)!;
        return { id: memory.id, invalidated: isInvalidated(storageRoot, kind, ulid) };
      });

      const missedTargets = targets.filter((t) => !t.invalidated).map((t) => t.id);
      const falsePositiveBystanders = bystanders.filter((b) => b.invalidated).map((b) => b.id);
      const passed = missedTargets.length === 0 && falsePositiveBystanders.length === 0;

      const explanationParts: string[] = [];
      if (missedTargets.length > 0) explanationParts.push(`missed target(s): ${missedTargets.join(", ")}`);
      if (falsePositiveBystanders.length > 0) explanationParts.push(`false-positive bystander(s): ${falsePositiveBystanders.join(", ")}`);
      const explanation = passed ? "all targets invalidated, all bystanders untouched" : explanationParts.join("; ");

      results.push({ scenarioId: scenario.id, mechanism: scenario.mechanism, passed, targets, bystanders, explanation });
    });
  }

  return { system: "raiminiscence", scenarios: results };
}
