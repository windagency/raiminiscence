import { runHippo, writeHippoMemory, type MemoryKind } from "./hippo-cli.js";
import { loadCorpusFile, withTempDir } from "../temp-dir.js";

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
  hippoPattern: string;
  targetMemories: ScenarioMemory[];
  bystanderMemories: ScenarioMemory[];
}

export interface HippoScenarioResult {
  scenarioId: string;
  mechanism: string;
  passed: boolean;
  targets: { id: string; invalidated: boolean }[];
  bystanders: { id: string; invalidated: boolean }[];
  explanation: string;
}

export interface HippoInvalidationRun {
  system: "hippo-memory";
  scenarios: HippoScenarioResult[];
}

const CONFIDENCE_LINE_PATTERN = /Confidence:\s*(\S+)/;

/**
 * Confidence tier is hippo-memory's own closest analogue to rAIminiscence's
 * `staleAt !== null` check: `hippo inspect <id>` prints a `Confidence:` line
 * that reads "stale" once `hippo invalidate` has weakened a memory (verified
 * empirically before writing this runner), mirroring the same pass
 * criterion the rAIminiscence runner uses (`confidence === "stale"`) for a
 * fair, apples-to-apples scenario verdict.
 */
function isHippoInvalidated(id: string, cwd: string): boolean {
  const result = runHippo(["inspect", id], cwd);
  if (result.status !== 0) throw new Error(`hippo inspect failed for ${id}: ${result.stderr}`);
  const match = result.stdout.match(CONFIDENCE_LINE_PATTERN);
  if (!match) throw new Error(`Could not parse hippo inspect output for ${id}: ${result.stdout}`);
  return match[1] === "stale";
}

/**
 * Runs every scenario from invalidation-scenarios.json against a fresh,
 * isolated `.hippo/` store per scenario, using hippo-memory's own single
 * invalidation primitive: `hippo invalidate "<pattern>"` (content-overlap
 * matching against memory bodies, or an exact tag match — never
 * token-level tag matching, per its own --help text). This is used for
 * BOTH mechanisms in the fixture (commit-message-style and file-based),
 * since hippo-memory has no relatedFiles-style file-anchoring concept to
 * mirror rAIminiscence's v2 file-based invalidation faithfully — see
 * benchmarks/README.md's mapping-compromise note. `hippoPattern` in the
 * fixture is the pattern this runner passes straight through to
 * `hippo invalidate`.
 */
export async function runHippoInvalidationBenchmark(): Promise<HippoInvalidationRun> {
  const { scenarios } = loadCorpusFile<{ scenarios: Scenario[] }>("invalidation-scenarios.json");

  const results: HippoScenarioResult[] = [];

  for (const scenario of scenarios) {
    await withTempDir(`hippo-bench-inv-${scenario.id}-`, async (storageRoot) => {
      const initResult = runHippo(["init", "--no-hooks", "--no-schedule", "--no-learn"], storageRoot);
      if (initResult.status !== 0) throw new Error(`hippo init failed: ${initResult.stderr}`);

      const idByCorpusId = new Map<string, string>();
      for (const memory of [...scenario.targetMemories, ...scenario.bystanderMemories]) {
        idByCorpusId.set(memory.id, writeHippoMemory(memory, storageRoot));
      }

      const invalidateResult = runHippo(["invalidate", scenario.hippoPattern], storageRoot);
      if (invalidateResult.status !== 0) {
        throw new Error(`hippo invalidate "${scenario.hippoPattern}" failed: ${invalidateResult.stderr}`);
      }

      const targets = scenario.targetMemories.map((memory) => ({
        id: memory.id,
        invalidated: isHippoInvalidated(idByCorpusId.get(memory.id)!, storageRoot),
      }));
      const bystanders = scenario.bystanderMemories.map((memory) => ({
        id: memory.id,
        invalidated: isHippoInvalidated(idByCorpusId.get(memory.id)!, storageRoot),
      }));

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

  return { system: "hippo-memory", scenarios: results };
}
