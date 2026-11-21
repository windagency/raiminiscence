/**
 * Extends the 2026-09-15 benchmark pass with the two measurements it
 * deliberately left out of scope (see benchmarks/README.md's "Scope"
 * section): per-turn auto-recall latency/token budget as store size grows,
 * and an outcome-feedback formula stress test. These resolve the two
 * "contingent on the benchmark" candidates from an internal hippo-memory
 * comparison (§3.1, §3.8).
 * Writes a separate, dated results file — does NOT touch or overwrite
 * 2026-09-15-results.md/.json, which stands as the original Recall@k/
 * invalidation pass. Run with:
 *   node_modules/.bin/tsx benchmarks/extended-compare.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRaiminiscenceLatencyBenchmark, runRaiminiscenceShimLatencyBenchmark } from "./raiminiscence-runner/latency-runner.js";
import { runHippoLatencyBenchmark } from "./hippo-memory-runner/latency-runner.js";
import { runRaiminiscenceFeedbackStressTest } from "./raiminiscence-runner/feedback-formula-runner.js";
import { runHippoFeedbackStressTest } from "./hippo-memory-runner/feedback-formula-runner.js";
import {
  runConsolidationContentionBenchmark,
  runConsolidationDurationBenchmark,
  runConsolidationSharedMemoryOverheadBenchmark,
} from "./raiminiscence-runner/consolidation-contention-runner.js";
import { REINFORCEMENT_CEILING_MULTIPLIER, REINFORCEMENT_HALF_SATURATION_DAYS } from "../packages/raiminiscence-mcp/src/core/decay.js";

const RESULTS_DIR = join(import.meta.dirname, "results");
const REPORT_DATE = "2026-09-15-extended";

const STORE_SIZES = [10, 50, 150, 300, 750, 1500];
// v14 (ADR-0021): fewer points than STORE_SIZES — each one re-seeds a fresh
// store with real embedding calls (duration/contention) or also spins up a
// real git repo (Shared Memory overhead), the most expensive of the three.
const CONSOLIDATION_STORE_SIZES = [10, 300, 1500];
const CONSOLIDATION_SHARED_MEMORY_STORE_SIZES = [10, 1500];
const FEEDBACK_COUNTS = [0, 1, 5, 10, 20, 50, 100, 200];
const ASSESSED_AT_DAYS = [30, 90, 180, 365, 730];
const BASE_HALF_LIFE_DAYS = 30;

function ms(n: number): string {
  return `${n.toFixed(1)}ms`;
}

/** The subset of `raiminiscence-runner`'s/`hippo-memory-runner`'s own `FeedbackStressPoint` shape this script's headline/saturation comparisons need. */
interface FeedbackPoint {
  feedbackCount: number;
  sign: "positive" | "negative";
  strengthByAssessedDay: Record<number, number>;
}

function findFeedbackStrength(points: FeedbackPoint[], sign: "positive" | "negative", count: number, day: number): number {
  return points.find((p) => p.sign === sign && p.feedbackCount === count)!.strengthByAssessedDay[day];
}

/** A series's first and last values, `0` for an empty series. */
function firstAndLast(values: number[]): [number, number] {
  return [values[0] ?? 0, values[values.length - 1] ?? 0];
}

async function runBenchmarks() {
  // Every `await` below runs strictly sequentially, deliberately: nearly all
  // of them are wall-clock latency/duration measurements (this file's whole
  // point), and running any two concurrently would let one's CPU/Ollama/
  // subprocess load bleed into the other's timing — corrupting the very
  // numbers being measured, not just wasting time. Do not Promise.all these.
  console.log("Running rAIminiscence latency benchmark (in-process, real v10 promptRecallText path)...");
  const raimLatency = await runRaiminiscenceLatencyBenchmark(STORE_SIZES);

  console.log(
    "Running rAIminiscence shim-subprocess latency benchmark (real raiminiscence-hooks-shim binary, without then with a running MCP server)...",
  );
  const { noServer: raimShimLatency, serverRunning: raimWarmShimLatency } = await runRaiminiscenceShimLatencyBenchmark(STORE_SIZES);

  console.log("Running hippo-memory latency benchmark (real CLI, real per-turn hook command)...");
  const hippoLatency = await runHippoLatencyBenchmark(STORE_SIZES);

  console.log("Running rAIminiscence outcome-feedback formula stress test...");
  const raimFeedback = runRaiminiscenceFeedbackStressTest(FEEDBACK_COUNTS, ASSESSED_AT_DAYS);

  console.log("Running hippo-memory outcome-feedback formula stress test...");
  const hippoFeedback = runHippoFeedbackStressTest(FEEDBACK_COUNTS, ASSESSED_AT_DAYS);

  console.log("Running rAIminiscence opportunistic-consolidation duration benchmark (v14 / ADR-0021)...");
  const consolidationDuration = await runConsolidationDurationBenchmark(CONSOLIDATION_STORE_SIZES);

  console.log("Running rAIminiscence opportunistic-consolidation contention benchmark (v14 / ADR-0021)...");
  const consolidationContention = await runConsolidationContentionBenchmark(CONSOLIDATION_STORE_SIZES);

  console.log("Running rAIminiscence Shared Memory consolidation overhead benchmark (v14 / ADR-0021)...");
  const consolidationSharedMemoryOverhead = await runConsolidationSharedMemoryOverheadBenchmark(CONSOLIDATION_SHARED_MEMORY_STORE_SIZES);

  return {
    raimLatency,
    raimShimLatency,
    raimWarmShimLatency,
    hippoLatency,
    raimFeedback,
    hippoFeedback,
    consolidationDuration,
    consolidationContention,
    consolidationSharedMemoryOverhead,
  };
}

type BenchmarkResults = Awaited<ReturnType<typeof runBenchmarks>>;

function latencySection({ raimLatency, raimShimLatency, raimWarmShimLatency, hippoLatency }: BenchmarkResults): string[] {
  const lines: string[] = [];
  lines.push("## 1. Per-turn auto-recall latency & injected content size");
  lines.push("");
  lines.push(
    "Three rAIminiscence measurements are reported, because they answer different questions and mixing them would overstate or understate the real per-turn cost:",
  );
  lines.push("");
  lines.push(
    "- **In-process** — calls `promptRecallText` (the exact v10 `UserPromptSubmit` hook function) directly in the same Node process as this benchmark script. Isolates the pure recall-computation cost, excluding any process-startup overhead.",
  );
  lines.push(
    "- **Shim subprocess** — invokes the real, built `raiminiscence-hooks-shim` binary as an actual child process via stdin/stdout JSON, exactly the shape Claude Code/Codex use in real usage. Its store is seeded with the Embedded Provider, the shim's own default, so the vectors it stores match the vector it embeds the prompt with; seeded with Ollama, as before 2026-11-02, every stored vector mismatched and the shim ranked by its lexical fallback alone. This is the fair, apples-to-apples comparison against hippo-memory's number below, which is *also* a real CLI subprocess invocation — comparing hippo-memory's subprocess number against rAIminiscence's in-process number would have silently favored rAIminiscence by excluding Node's own startup cost from one side only.",
  );
  lines.push(
    "- **Shim subprocess, server running** — the same shim call on the same store, with the real, built MCP server running in the same project. The server answers the shim's whole recall over a local socket (ADR-0039), with its model loaded and its recall cache parsed once, so the shim skips the model load (ADR-0038), the engine import and the cache parse. This is the usual case during a session, since the agent's MCP server runs alongside the hook. The plain shim column is the case with no server. Both run under a fresh temp home, so neither reaches a developer's own running server.",
  );
  lines.push("");
  lines.push(
    "hippo-memory: its real, source-confirmed per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context` — structurally bounded to pinned memories + the last 5 writes regardless of store size, confirmed from `dist/hooks.js`, not assumed. Median of 5 reps per store size, one untimed warm-up call first on every measurement (steady-state cost, not process cold-start; the Ollama/embedding server itself was already warm from the original 2026-09-15 pass in this session). Both systems write an identical synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`) at each size, in isolated temp storage.",
  );
  lines.push("");
  lines.push(
    "| Store size | rAIminiscence in-process | rAIminiscence shim subprocess | rAIminiscence shim subprocess, server running | hippo-memory CLI subprocess | rAIminiscence output chars (~tokens) | hippo-memory output chars (~tokens) |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (let i = 0; i < STORE_SIZES.length; i++) {
    const r = raimLatency[i];
    const rs = raimShimLatency[i];
    const rw = raimWarmShimLatency[i];
    const h = hippoLatency[i];
    lines.push(
      `| ${STORE_SIZES[i]} | ${ms(r.medianLatencyMs)} | ${ms(rs.medianLatencyMs)} | ${ms(rw.medianLatencyMs)} | ${ms(h.medianLatencyMs)} | ${r.outputChars} (~${r.outputApproxTokens}) | ${h.outputChars} (~${h.outputApproxTokens}) |`,
    );
  }
  lines.push("");
  lines.push(
    "**~tokens** is chars/4, a rough documented estimate (not a real tokenizer count) — sufficient to compare relative growth, not to state an exact token cost.",
  );
  lines.push("");

  const [raimFirstChars, raimLastChars] = firstAndLast(raimLatency.map((r) => r.outputChars));
  const [hippoFirstChars, hippoLastChars] = firstAndLast(hippoLatency.map((r) => r.outputChars));
  const [raimFirstMs, raimLastMs] = firstAndLast(raimShimLatency.map((r) => r.medianLatencyMs));
  const [raimWarmFirstMs, raimWarmLastMs] = firstAndLast(raimWarmShimLatency.map((r) => r.medianLatencyMs));
  const [hippoFirstMs, hippoLastMs] = firstAndLast(hippoLatency.map((r) => r.medianLatencyMs));

  lines.push(
    `**Observed scaling, this run only, fair subprocess-to-subprocess comparison** (store size ${STORE_SIZES[0]} → ${STORE_SIZES[STORE_SIZES.length - 1]}): rAIminiscence shim latency ${ms(raimFirstMs)} → ${ms(raimLastMs)} with no server and ${ms(raimWarmFirstMs)} → ${ms(raimWarmLastMs)} with one running, output ${raimFirstChars} → ${raimLastChars} chars. hippo-memory latency ${ms(hippoFirstMs)} → ${ms(hippoLastMs)}, output ${hippoFirstChars} → ${hippoLastChars} chars. rAIminiscence's *output size* stays essentially flat (it always returns its top-k \`recall\` results, not a store-size-proportional dump) while its *latency* grows with store size (full similarity search over every memory); hippo-memory's \`--pinned-only --include-recent 5\` is structurally bounded on both latency and output size, since it only ever looks at pinned memories plus the last 5 writes — a real, source-confirmed design difference, not a benchmark artifact. These are single-machine, single-run numbers on a small synthetic corpus (not averaged across repeated full runs) — read as a directional signal, not a precise production forecast.`,
  );
  lines.push("");

  return lines;
}

function consolidationSection({ consolidationDuration, consolidationContention, consolidationSharedMemoryOverhead }: BenchmarkResults): string[] {
  const lines: string[] = [];
  lines.push("## 2. Opportunistic consolidation: raw cost and contention (v14 / ADR-0021)");
  lines.push("");
  lines.push(
    "Added when ADR-0021's interview widened this pass's scope beyond recall's own scan: `remember`/`recall` schedule a full Clustering/Promotion/Promotion Audit/Commit Invalidation/Pruning/Invalidation pass via `setImmediate` on the *same* event loop as the MCP server (see `opportunistic-consolidation.ts`) — a cost the recall-latency numbers above never isolated, since the per-turn hook explicitly opts out of it (`triggerConsolidation: false`). Three measurements, each answering a different question:",
  );
  lines.push("");
  lines.push(
    "- **Duration** — `consolidate()`'s own wall-clock cost, one fresh store per size (a second pass on the same store would mostly find nothing left to promote/prune, understating the real first-pass cost).",
  );
  lines.push(
    "- **Contention** — the actual user-facing symptom: how much slower the *next* `recall()` is when it runs right after a `remember()` that scheduled a pending consolidation (production's real default), versus the same next call with no pending pass at all.",
  );
  lines.push(
    "- **Shared Memory overhead** — isolates `flushSharedMemory`'s git cost (`add -A`, `commit`, a push attempt against no configured remote) from consolidate's own local compute cost measured above. Run at fewer store sizes (real `git` subprocesses per size make this the most expensive of the three).",
  );
  lines.push("");
  lines.push("### Duration (one fresh store per size, single pass)");
  lines.push("");
  lines.push("| Store size | consolidate() duration |");
  lines.push("|---|---|");
  for (const r of consolidationDuration) {
    lines.push(`| ${r.storeSize} | ${ms(r.durationMs)} |`);
  }
  lines.push("");
  lines.push("### Contention (next recall(), with vs. without a pending consolidation)");
  lines.push("");
  lines.push("| Store size | Next recall(), baseline | Next recall(), pending consolidation | Contention overhead |");
  lines.push("|---|---|---|---|");
  for (const r of consolidationContention) {
    lines.push(
      `| ${r.storeSize} | ${ms(r.baselineNextCallLatencyMs)} | ${ms(r.withPendingConsolidationNextCallLatencyMs)} | ${ms(r.contentionOverheadMs)} |`,
    );
  }
  lines.push("");
  lines.push("### Shared Memory overhead (consolidate() with vs. without Shared Memory enabled)");
  lines.push("");
  lines.push("| Store size | Without Shared Memory | With Shared Memory | Overhead |");
  lines.push("|---|---|---|---|");
  for (const r of consolidationSharedMemoryOverhead) {
    lines.push(`| ${r.storeSize} | ${ms(r.durationWithoutSharedMemoryMs)} | ${ms(r.durationWithSharedMemoryMs)} | ${ms(r.sharedMemoryOverheadMs)} |`);
  }
  lines.push("");
  const maxContention = consolidationContention[consolidationContention.length - 1];
  lines.push(
    `**Reading this:** contention overhead ${maxContention ? `at the largest measured store (${maxContention.storeSize} memories) was ${ms(maxContention.contentionOverheadMs)}` : "was not measured"} — real, but this pass does not yet say whether it warrants its own fix (e.g. moving consolidation off the event loop, or debouncing it the way the Checkpoint nudge already is); per ADR-0021, that decision is deferred to a follow-up pass with these numbers as its starting evidence, while the confirmed, measured recall-latency fix (below) lands in this same pass.`,
  );
  lines.push("");

  return lines;
}

function feedbackSection({ raimFeedback, hippoFeedback }: BenchmarkResults): string[] {
  const lines: string[] = [];
  lines.push("## 3. Outcome-feedback formula stress test");
  lines.push("");
  lines.push(
    `Both sides use their real, unmodified strength/decay function (rAIminiscence's \`computeStrength\`, hippo-memory's \`calculateStrength\`+\`applyOutcome\`), same base half-life (${BASE_HALF_LIFE_DAYS} days), same feedback counts, assessed at ${ASSESSED_AT_DAYS.join("/")} days since the memory's anchor. Isolates the reward/feedback term specifically — no recall-count bonus, no error tag, no emotional-valence multiplier on either side (confirmed neutral-by-construction from each system's own source).`,
  );
  lines.push("");
  lines.push("### Positive feedback — Strength (0..1) by days since anchor");
  lines.push("");
  lines.push(
    `| Feedback count | ${ASSESSED_AT_DAYS.map((d) => `rAIminiscence @${d}d`).join(" | ")} | ${ASSESSED_AT_DAYS.map((d) => `hippo-memory @${d}d`).join(" | ")} |`,
  );
  lines.push(`|---|${ASSESSED_AT_DAYS.map(() => "---").join("|")}|${ASSESSED_AT_DAYS.map(() => "---").join("|")}|`);
  for (const count of FEEDBACK_COUNTS) {
    const r = raimFeedback.find((p) => p.sign === "positive" && p.feedbackCount === count)!;
    const h = hippoFeedback.find((p) => p.sign === "positive" && p.feedbackCount === count)!;
    const rCells = ASSESSED_AT_DAYS.map((d) => r.strengthByAssessedDay[d].toFixed(3));
    const hCells = ASSESSED_AT_DAYS.map((d) => h.strengthByAssessedDay[d].toFixed(3));
    lines.push(`| ${count} | ${rCells.join(" | ")} | ${hCells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("### Negative feedback — Strength (0..1) by days since anchor");
  lines.push("");
  lines.push(
    `| Feedback count | ${ASSESSED_AT_DAYS.map((d) => `rAIminiscence @${d}d`).join(" | ")} | ${ASSESSED_AT_DAYS.map((d) => `hippo-memory @${d}d`).join(" | ")} |`,
  );
  lines.push(`|---|${ASSESSED_AT_DAYS.map(() => "---").join("|")}|${ASSESSED_AT_DAYS.map(() => "---").join("|")}|`);
  for (const count of FEEDBACK_COUNTS) {
    const r = raimFeedback.find((p) => p.sign === "negative" && p.feedbackCount === count)!;
    const h = hippoFeedback.find((p) => p.sign === "negative" && p.feedbackCount === count)!;
    const rCells = ASSESSED_AT_DAYS.map((d) => r.strengthByAssessedDay[d].toFixed(3));
    const hCells = ASSESSED_AT_DAYS.map((d) => h.strengthByAssessedDay[d].toFixed(3));
    lines.push(`| ${count} | ${rCells.join(" | ")} | ${hCells.join(" | ")} |`);
  }
  lines.push("");

  const headlineDay = ASSESSED_AT_DAYS[ASSESSED_AT_DAYS.length - 1];
  const midCount = 50;
  const maxCount = FEEDBACK_COUNTS[FEEDBACK_COUNTS.length - 1];
  const raimPosMid = findFeedbackStrength(raimFeedback, "positive", midCount, headlineDay);
  const hippoPosMid = findFeedbackStrength(hippoFeedback, "positive", midCount, headlineDay);
  const raimPos0 = findFeedbackStrength(raimFeedback, "positive", 0, headlineDay);
  const hippoPos0 = findFeedbackStrength(hippoFeedback, "positive", 0, headlineDay);
  const raimPosMax = findFeedbackStrength(raimFeedback, "positive", maxCount, headlineDay);
  const hippoPosMax = findFeedbackStrength(hippoFeedback, "positive", maxCount, headlineDay);
  lines.push(
    `**Headline comparison (${headlineDay} days since anchor, ${midCount} positive feedback events):** rAIminiscence Strength goes from ${raimPos0.toFixed(3)} (0 feedback) to ${raimPosMid.toFixed(3)} (${midCount} feedback) — a delta of ${(raimPosMid - raimPos0).toFixed(3)}. hippo-memory goes from ${hippoPos0.toFixed(3)} to ${hippoPosMid.toFixed(3)} — a delta of ${(hippoPosMid - hippoPos0).toFixed(3)}. hippo-memory's multiplicative reward factor is mathematically bounded to (0.5x, 1.5x) of base half-life regardless of feedback count (asymptotic as counts grow, per its own \`(pos-neg)/(pos+neg+1)\` ratio); rAIminiscence's own positive term is bounded too as of v12's Reinforcement Ceiling (\`decay.ts\`) — the combined Spaced Repetition + Outcome Feedback bonus now saturates asymptotically toward ${REINFORCEMENT_CEILING_MULTIPLIER}x base half-life via a smooth \`1 - 0.5^(bonusDays / ${REINFORCEMENT_HALF_SATURATION_DAYS})\` curve, rather than growing without limit — high feedback counts still push Strength further out than hippo-memory's tighter (0.5x, 1.5x) band, but no longer indefinitely. The negative term is unaffected by v12: each further negative event still subtracts a flat 5 days until the 1-day floor.`,
  );
  lines.push("");
  lines.push(
    `**Saturation check at the top of this pass's range** (${headlineDay} days, ${midCount} → ${maxCount} feedback events, the two largest counts now measured): rAIminiscence Strength moves ${raimPosMid.toFixed(3)} → ${raimPosMax.toFixed(3)} — a further delta of only ${(raimPosMax - raimPosMid).toFixed(3)}, versus ${(raimPosMid - raimPos0).toFixed(3)} for the first ${midCount} events — directly demonstrating the Reinforcement Ceiling asymptote holding at higher counts than the original pass measured, not just a smaller range where a cap coincidentally looked flat. hippo-memory moves ${hippoPosMid.toFixed(3)} → ${hippoPosMax.toFixed(3)}, already essentially flat by ${midCount} events under its own tighter bound.`,
  );
  lines.push("");

  return lines;
}

async function main() {
  const results = await runBenchmarks();
  const {
    raimLatency,
    raimShimLatency,
    raimWarmShimLatency,
    hippoLatency,
    raimFeedback,
    hippoFeedback,
    consolidationDuration,
    consolidationContention,
    consolidationSharedMemoryOverhead,
  } = results;

  mkdirSync(RESULTS_DIR, { recursive: true });

  const rawResults = {
    generatedAt: new Date().toISOString(),
    latency: {
      storeSizes: STORE_SIZES,
      raiminiscenceInProcess: raimLatency,
      raiminiscenceShimSubprocess: raimShimLatency,
      raiminiscenceShimSubprocessServerRunning: raimWarmShimLatency,
      hippoMemory: hippoLatency,
    },
    feedbackFormula: {
      feedbackCounts: FEEDBACK_COUNTS,
      assessedAtDays: ASSESSED_AT_DAYS,
      baseHalfLifeDays: BASE_HALF_LIFE_DAYS,
      raiminiscence: raimFeedback,
      hippoMemory: hippoFeedback,
    },
    consolidationContention: {
      storeSizes: CONSOLIDATION_STORE_SIZES,
      sharedMemoryStoreSizes: CONSOLIDATION_SHARED_MEMORY_STORE_SIZES,
      duration: consolidationDuration,
      contention: consolidationContention,
      sharedMemoryOverhead: consolidationSharedMemoryOverhead,
    },
  };
  const rawPath = join(RESULTS_DIR, `${REPORT_DATE}-results.json`);
  writeFileSync(rawPath, JSON.stringify(rawResults, null, 2));

  const lines: string[] = [];
  lines.push(`# rAIminiscence vs hippo-memory — Extended Benchmark Results (${REPORT_DATE})`);
  lines.push("");
  lines.push(
    'Extends `2026-09-15-results.md` with the two measurements its scope deliberately excluded (see `benchmarks/README.md`), needed to resolve two "contingent on the benchmark" candidates from an internal hippo-memory comparison (§3.1 outcome-feedback formula bound, §3.8 per-turn latency/token budget). Does not modify or supersede the original results file — that Recall@k/invalidation pass stands as-is.',
  );
  lines.push("");

  lines.push(...latencySection(results), ...consolidationSection(results), ...feedbackSection(results));
  lines.push("## Raw data");
  lines.push("");
  lines.push(`Full per-size/per-count JSON: \`benchmarks/results/${REPORT_DATE}-results.json\``);
  lines.push("");

  const reportPath = join(RESULTS_DIR, `${REPORT_DATE}-results.md`);
  writeFileSync(reportPath, lines.join("\n") + "\n");

  console.log(`\nWrote ${reportPath}`);
  console.log(`Wrote ${rawPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
