/**
 * Builds the static, self-contained "Memory Bench Readout" dashboard by
 * injecting the real result JSON straight into dashboard-template.html's
 * placeholders and writing the result to dashboard.html. No fetch() at
 * runtime, so the output opens correctly as a plain local file:// URL (a
 * browser blocks fetch() of local files under file://, which a template
 * relying on fetch("data/*.json") would silently break under). Re-run
 * after any `compare.ts`/`extended-compare.ts` re-run to keep it in sync.
 * Run with: `node_modules/.bin/tsx benchmarks/build-dashboard.ts` from the
 * repo root.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BENCHMARKS_DIR = import.meta.dirname;
const RESULTS_DIR = join(BENCHMARKS_DIR, "results");
const MAIN_RESULTS_FILENAME = /^(\d{4}-\d{2}-\d{2})-results\.json$/;

/**
 * Derived rather than hand-maintained — a hardcoded date silently no-ops
 * (keeps embedding a stale results file) on the next benchmark re-run
 * unless someone remembers to bump it. Lexicographic sort == chronological
 * sort given the `YYYY-MM-DD` prefix.
 */
function latestReportDate(): string {
  const dates = readdirSync(RESULTS_DIR)
    .map((name) => name.match(MAIN_RESULTS_FILENAME)?.[1])
    .filter((date): date is string => date !== undefined)
    .sort();
  const latest = dates[dates.length - 1];
  if (latest === undefined) {
    throw new Error(`No "${MAIN_RESULTS_FILENAME.source}"-shaped results file found in ${RESULTS_DIR} — run compare.ts first.`);
  }
  return latest;
}

const REPORT_DATE = latestReportDate();

function embed(json: unknown): string {
  // Escape "</" so a literal "</script>" inside a string value (or the
  // JSON's own escaping) can never prematurely close the inline <script>
  // this gets embedded into.
  return JSON.stringify(json).replace(/<\//g, "<\\/");
}

// hippo-memory's harness, both systems ranking the whole haystack: rAIminiscence with Ollama as of
// ADR-0033 (OD-lifted), hippo-memory with its MiniLM embeddings (B-lifted). See README.md.
const LONGMEMEVAL_DIR = join(BENCHMARKS_DIR, "longmemeval", "2026-10-31-results", "scores");

const template = readFileSync(join(BENCHMARKS_DIR, "dashboard-template.html"), "utf8");
const main = JSON.parse(readFileSync(join(RESULTS_DIR, `${REPORT_DATE}-results.json`), "utf8"));
const extended = JSON.parse(readFileSync(join(RESULTS_DIR, `${REPORT_DATE}-extended-results.json`), "utf8"));
const longmemeval = {
  raiminiscence: JSON.parse(readFileSync(join(LONGMEMEVAL_DIR, "OD-lifted.json"), "utf8")),
  hippoMemory: JSON.parse(readFileSync(join(LONGMEMEVAL_DIR, "B-lifted.json"), "utf8")),
};

const output = template
  .replace("/*__MAIN_RESULTS_JSON__*/null", embed(main))
  .replace("/*__EXTENDED_RESULTS_JSON__*/null", embed(extended))
  .replace("/*__LONGMEMEVAL_RESULTS_JSON__*/null", embed(longmemeval));

if (output === template) {
  throw new Error("dashboard-template.html placeholders not found — did the template change?");
}

const outputPath = join(BENCHMARKS_DIR, "dashboard.html");
writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath}`);
