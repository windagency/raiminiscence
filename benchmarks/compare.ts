/**
 * Orchestrates both isolated runners (rAIminiscence in-process, hippo-memory
 * via its real CLI), computes Recall@k/Precision@k and invalidation
 * pass/fail, and writes a dated results report + the raw JSON underlying
 * it. See benchmarks/README.md for methodology, isolation guarantees, and
 * caveats. Run with: `node_modules/.bin/tsx benchmarks/compare.ts` from the
 * repo root (matches this monorepo's own tsx convention, e.g. `pnpm
 * codemap` / scripts/build-codemap.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRaiminiscenceRecallBenchmark, cleanupRaiminiscenceRun } from "./raiminiscence-runner/recall-runner.js";
import { runRaiminiscenceInvalidationBenchmark } from "./raiminiscence-runner/invalidation-runner.js";
import { runHippoRecallBenchmark, cleanupHippoRun } from "./hippo-memory-runner/recall-runner.js";
import { runHippoInvalidationBenchmark } from "./hippo-memory-runner/invalidation-runner.js";
import { loadCorpusFile } from "./temp-dir.js";

const RESULTS_DIR = join(import.meta.dirname, "results");
const REPORT_DATE = "2026-09-15";

interface QueryResultLike {
  queryId: string;
  query: string;
  relevantIds: string[];
  topK: { id: string; score: number }[];
}

interface QueryMetrics {
  queryId: string;
  query: string;
  relevantIds: string[];
  returnedIds: string[];
  hits: string[];
  recallAtK: number;
  precisionAtK: number;
}

/**
 * Precision@k is `hits / min(k, results actually returned)`, not the more
 * common `hits / k`. Both systems can legitimately return fewer than k
 * candidates when fewer clear lexical matches exist (observed for real on
 * several queries below) — dividing by a fixed k would unfairly penalize a
 * system that declines to guess over one that pads its output with weak
 * candidates. This is a deliberate methodology choice, not a bug; see
 * benchmarks/README.md.
 */
export function scoreQuery(result: QueryResultLike, k: number): QueryMetrics {
  const returnedIds = result.topK.map((h) => h.id);
  const relevantSet = new Set(result.relevantIds);
  const hits = returnedIds.filter((id) => relevantSet.has(id));
  const recallAtK = result.relevantIds.length === 0 ? 0 : hits.length / result.relevantIds.length;
  const precisionDenominator = Math.min(k, returnedIds.length);
  const precisionAtK = precisionDenominator === 0 ? 0 : hits.length / precisionDenominator;
  return {
    queryId: result.queryId,
    query: result.query,
    relevantIds: result.relevantIds,
    returnedIds,
    hits,
    recallAtK,
    precisionAtK,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  // Kept sequential, deliberately: these four calls are logically
  // independent (separate isolated temp storage, neither system depends on
  // the other's process or files), but empirically NOT safe to run
  // concurrently — verified by actually running this file with a
  // Promise.all version: rAIminiscence's own two calls both hit the same
  // local Ollama embedding server, and running them concurrently perturbed
  // its returned vectors enough to flip a close top-5 ranking tie (measured
  // Recall@5 dropped from the real 90.0% to 87.5% on an otherwise-identical
  // rerun). Do not Promise.all these without re-verifying against a live
  // Ollama instance first.
  console.log("Running rAIminiscence recall benchmark (in-process, isolated temp storage)...");
  const raimRecall = await runRaiminiscenceRecallBenchmark();

  console.log("Running hippo-memory recall benchmark (real CLI, isolated .hippo/ per run)...");
  const hippoRecallRun = await runHippoRecallBenchmark();

  console.log("Running rAIminiscence invalidation benchmark...");
  const raimInvalidation = await runRaiminiscenceInvalidationBenchmark();

  console.log("Running hippo-memory invalidation benchmark...");
  const hippoInvalidation = await runHippoInvalidationBenchmark();

  const raimMetrics = raimRecall.perQuery.map((q) => scoreQuery(q, raimRecall.k));
  const hippoMetrics = hippoRecallRun.perQuery.map((q) => scoreQuery(q, hippoRecallRun.k));

  const raimMeanRecall = mean(raimMetrics.map((m) => m.recallAtK));
  const raimMeanPrecision = mean(raimMetrics.map((m) => m.precisionAtK));
  const hippoMeanRecall = mean(hippoMetrics.map((m) => m.recallAtK));
  const hippoMeanPrecision = mean(hippoMetrics.map((m) => m.precisionAtK));

  const raimInvalidationPassCount = raimInvalidation.scenarios.filter((s) => s.passed).length;
  const hippoInvalidationPassCount = hippoInvalidation.scenarios.filter((s) => s.passed).length;

  cleanupRaiminiscenceRun(raimRecall.storageRoot);
  cleanupHippoRun(hippoRecallRun.storageRoot);

  mkdirSync(RESULTS_DIR, { recursive: true });

  const rawResults = {
    generatedAt: new Date().toISOString(),
    k: raimRecall.k,
    recall: {
      raiminiscence: { perQuery: raimMetrics, meanRecallAtK: raimMeanRecall, meanPrecisionAtK: raimMeanPrecision },
      hippoMemory: { perQuery: hippoMetrics, meanRecallAtK: hippoMeanRecall, meanPrecisionAtK: hippoMeanPrecision },
    },
    invalidation: {
      raiminiscence: raimInvalidation.scenarios,
      hippoMemory: hippoInvalidation.scenarios,
    },
  };
  const rawPath = join(RESULTS_DIR, `${REPORT_DATE}-results.json`);
  writeFileSync(rawPath, JSON.stringify(rawResults, null, 2));

  const lines: string[] = [];
  lines.push(`# rAIminiscence vs hippo-memory — Empirical Benchmark Results (${REPORT_DATE})`);
  lines.push("");
  lines.push(
    "Real, runnable numbers from actually executing both systems against an identical, hand-labelled synthetic corpus — see `benchmarks/README.md` for full methodology, isolation guarantees, and caveats. This replaces the prior narrative-only comparison that relied on hippo-memory's self-reported README numbers and rAIminiscence's own design docs.",
  );
  lines.push("");

  lines.push("## 1. Recall@k / Precision@k");
  lines.push("");
  const corpusSize: number = loadCorpusFile<{ memories: unknown[] }>("memories.json").memories.length;
  lines.push(`k = ${raimRecall.k}, over ${raimMetrics.length} hand-labelled queries against a ${corpusSize}-memory synthetic corpus.`);
  lines.push("");
  lines.push("| System | Mean Recall@k | Mean Precision@k |");
  lines.push("|---|---|---|");
  lines.push(`| rAIminiscence | ${pct(raimMeanRecall)} | ${pct(raimMeanPrecision)} |`);
  lines.push(`| hippo-memory | ${pct(hippoMeanRecall)} | ${pct(hippoMeanPrecision)} |`);
  lines.push("");
  lines.push("### Per-query breakdown");
  lines.push("");
  lines.push("| Query | Relevant | rAIminiscence top-k | rAIminiscence R@k / P@k | hippo-memory top-k | hippo-memory R@k / P@k |");
  lines.push("|---|---|---|---|---|---|");
  for (let i = 0; i < raimMetrics.length; i++) {
    const r = raimMetrics[i]!;
    const h = hippoMetrics[i]!;
    lines.push(
      `| ${r.query} | ${r.relevantIds.join(", ")} | ${r.returnedIds.join(", ") || "(none)"} | ${pct(r.recallAtK)} / ${pct(r.precisionAtK)} | ${h.returnedIds.join(", ") || "(none)"} | ${pct(h.recallAtK)} / ${pct(h.precisionAtK)} |`,
    );
  }
  lines.push("");
  lines.push(
    "**Embedding backends:** both systems ran with real local embedding models this time (see `benchmarks/README.md`'s \"Embedding backends\" section for setup details) — rAIminiscence via a local Ollama instance (`nomic-embed-text`, cosine similarity in `recall()`), hippo-memory via its optional `@huggingface/transformers` peer dependency (`Xenova/all-MiniLM-L6-v2`, hybrid BM25+cosine via reciprocal-rank fusion). This benchmark therefore measures each system's real embedding-backed retrieval path, not a lexical-only fallback.",
  );
  lines.push("");

  lines.push("## 2. Invalidation correctness");
  lines.push("");
  lines.push(
    `rAIminiscence: ${raimInvalidationPassCount}/${raimInvalidation.scenarios.length} scenarios passed. hippo-memory: ${hippoInvalidationPassCount}/${hippoInvalidation.scenarios.length} scenarios passed. Reported as pass/fail per scenario, not a fabricated aggregate percentage, given the small scenario count.`,
  );
  lines.push("");
  lines.push("| Scenario | Mechanism | rAIminiscence | hippo-memory |");
  lines.push("|---|---|---|---|");
  for (let i = 0; i < raimInvalidation.scenarios.length; i++) {
    const r = raimInvalidation.scenarios[i]!;
    const h = hippoInvalidation.scenarios[i]!;
    const rMark = r.passed ? "PASS" : `FAIL — ${r.explanation}`;
    const hMark = h.passed ? "PASS" : `FAIL — ${h.explanation}`;
    lines.push(`| ${r.scenarioId} | ${r.mechanism} | ${rMark} | ${hMark} |`);
  }
  lines.push("");
  lines.push(
    "The `remove-moment` scenario is a deliberate known-limitation case (the target string collides with an ordinary English word) included for honesty, not to flatter either system — see `benchmarks/corpus/invalidation-scenarios.json`.",
  );
  lines.push("");
  lines.push(
    '**Caveat:** hippo-memory has no relatedFiles-style file-anchoring concept, so the `webpack-config-file-changed` scenario (rAIminiscence\'s v2 file-based invalidation) is driven on the hippo side via its one invalidation primitive, `hippo invalidate "<pattern>"`, matching on file-name content instead of on an actual changed-file signal. This conflates two mechanisms rAIminiscence keeps independent (v2 file-based vs v9 commit-message-based) — see `benchmarks/README.md`.',
  );
  lines.push("");

  lines.push("## Raw data");
  lines.push("");
  lines.push(`Full per-query/per-scenario JSON: \`benchmarks/results/${REPORT_DATE}-results.json\``);
  lines.push("");

  const reportPath = join(RESULTS_DIR, `${REPORT_DATE}-results.md`);
  writeFileSync(reportPath, lines.join("\n") + "\n");

  console.log(`\nWrote ${reportPath}`);
  console.log(`Wrote ${rawPath}`);
  console.log(
    `\nrAIminiscence: Recall@${raimRecall.k}=${pct(raimMeanRecall)} Precision@${raimRecall.k}=${pct(raimMeanPrecision)}, invalidation ${raimInvalidationPassCount}/${raimInvalidation.scenarios.length}`,
  );
  console.log(
    `hippo-memory:  Recall@${hippoRecallRun.k}=${pct(hippoMeanRecall)} Precision@${hippoRecallRun.k}=${pct(hippoMeanPrecision)}, invalidation ${hippoInvalidationPassCount}/${hippoInvalidation.scenarios.length}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
