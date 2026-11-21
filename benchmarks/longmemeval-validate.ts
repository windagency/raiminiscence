/**
 * VALIDATION-ONLY pass for the rAIminiscence-vs-hippo-memory LongMemEval
 * retrieval-only adapter, against a 20-question slice. Not the full
 * 500-question run, not wired into compare.ts/dashboard.html yet — see the
 * scoping report for what's still open before this becomes a permanent,
 * checked-in fixture like the rest of benchmarks/.
 *
 * Run with: node_modules/.bin/tsx benchmarks/longmemeval-validate.ts
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runLongMemEvalRetrieval, writeLongMemEvalJsonl } from "./raiminiscence-runner/longmemeval-retrieve.js";
import { runHippoLongMemEvalRetrieval } from "./hippo-memory-runner/longmemeval-retrieve.js";
import type { LongMemEvalEntry } from "./longmemeval-session.js";

const DATA_PATH = process.env.LONGMEMEVAL_DATA
  ? join(import.meta.dirname, process.env.LONGMEMEVAL_DATA)
  : join(import.meta.dirname, "longmemeval", "data", "subset-20.json");
const OUT_DIR = process.env.LONGMEMEVAL_OUT_DIR
  ? join(import.meta.dirname, process.env.LONGMEMEVAL_OUT_DIR)
  : join(import.meta.dirname, "longmemeval", "validation-results");

async function main() {
  const entries: LongMemEvalEntry[] = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  console.log(`Loaded ${entries.length} validation entries from ${DATA_PATH}`);

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\n=== rAIminiscence: ingest + recall, per-question isolated stores ===");
  const raimStart = Date.now();
  const raimRecords = await runLongMemEvalRetrieval(entries);
  const raimElapsedMs = Date.now() - raimStart;
  const raimPath = join(OUT_DIR, "raiminiscence-retrieval.jsonl");
  writeLongMemEvalJsonl(raimRecords, raimPath);
  console.log(`Wrote ${raimPath} (${raimElapsedMs}ms total, ${(raimElapsedMs / entries.length).toFixed(0)}ms/question)`);

  console.log("\n=== hippo-memory: ingest + recall, per-question isolated .hippo/ stores ===");
  const hippoStart = Date.now();
  const hippoRecords = await runHippoLongMemEvalRetrieval(entries);
  const hippoElapsedMs = Date.now() - hippoStart;
  const hippoPath = join(OUT_DIR, "hippo-memory-retrieval.jsonl");
  writeFileSync(hippoPath, hippoRecords.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`Wrote ${hippoPath} (${hippoElapsedMs}ms total, ${(hippoElapsedMs / entries.length).toFixed(0)}ms/question)`);

  console.log("\n=== evaluate_retrieval.py: rAIminiscence ===");
  const raimEval = execFileSync(
    "python3",
    [
      join(import.meta.dirname, "longmemeval", "evaluate_retrieval.py"),
      "--retrieval",
      raimPath,
      "--data",
      DATA_PATH,
      "--output",
      join(OUT_DIR, "raiminiscence-evaluation.json"),
    ],
    { encoding: "utf8" },
  );
  console.log(raimEval);

  console.log("\n=== evaluate_retrieval.py: hippo-memory ===");
  const hippoEval = execFileSync(
    "python3",
    [
      join(import.meta.dirname, "longmemeval", "evaluate_retrieval.py"),
      "--retrieval",
      hippoPath,
      "--data",
      DATA_PATH,
      "--output",
      join(OUT_DIR, "hippo-memory-evaluation.json"),
    ],
    { encoding: "utf8" },
  );
  console.log(hippoEval);

  console.log(`\n=== Timing summary (${entries.length} questions) ===`);
  console.log(`rAIminiscence: ${raimElapsedMs}ms total, ${(raimElapsedMs / entries.length).toFixed(0)}ms/question`);
  console.log(`hippo-memory:  ${hippoElapsedMs}ms total, ${(hippoElapsedMs / entries.length).toFixed(0)}ms/question`);
  const raimFullEst = (raimElapsedMs / entries.length) * 500;
  const hippoFullEst = (hippoElapsedMs / entries.length) * 500;
  console.log(`\nExtrapolated (NOT measured) full 500-question runtime:`);
  console.log(`rAIminiscence: ~${(raimFullEst / 1000 / 60).toFixed(1)} min`);
  console.log(`hippo-memory:  ~${(hippoFullEst / 1000 / 60).toFixed(1)} min`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
