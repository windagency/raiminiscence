import { RESAMPLES, SEED, seededRandom } from "./paired-latency.js";

/**
 * The benchmark gate's arithmetic, apart from running anything: per-question
 * scores from each public benchmark's saved rows, the paired difference
 * against hippo-memory, and the verdict. `benchmark-gate.ts` runs the suites
 * and feeds this module their files.
 *
 * "At least as good", per `NEXT_STEPS.md`: on every reported metric, the lower
 * bound of the paired 95% interval for rAIminiscence minus hippo-memory stays
 * at or above -3 points, and the hook's median stays at or below hippo-memory's
 * at each store size.
 */

/**
 * In points: -3 points is -0.03 on a 0..1 metric. A dead heat on LongMemEval-S's
 * 500 questions has a lower bound near -2.4 points on R@1, so a tighter floor
 * would ask for a lead rather than parity.
 */
export const LOWER_BOUND_FLOOR = -0.03;

export interface LongMemEvalQuestion {
  question_id: string;
  answer_session_ids: string[];
  answer: unknown;
}

export interface LongMemEvalRow {
  question_id: string;
  retrieved_memories: { tags?: string[]; content?: string }[];
}

export interface LocomoQa {
  conversation_id: string;
  qa_index: number;
  scored?: boolean;
  gold_evidence: string[];
  retrieved_dia_ids: string[];
}

/** One metric's per-question scores, keyed by question, each 0..1. */
export type Scores = Record<string, number>;

export interface PairedMean {
  raiminiscence: number;
  hippo: number;
  difference: number;
  ci95: [number, number];
}

export interface MetricCheck extends PairedMean {
  suite: string;
  reference: string;
  metric: string;
  pass: boolean;
}

export interface HookSize {
  storeSize: number;
  summary: { medianMs: { raiminiscence: number; hippo: number } };
}

export interface HookCheck {
  storeSize: number;
  raiminiscenceMs: number;
  hippoMs: number;
  pass: boolean;
}

export interface GateVerdict {
  pass: boolean;
  metrics: MetricCheck[];
  hooks: HookCheck[];
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Mean of each side, and a 95% percentile bootstrap over whole pairs for the mean difference, seeded as `pairedLatencySummary` is. */
export function pairedMeanDifference(raiminiscence: number[], hippo: number[]): PairedMean {
  if (raiminiscence.length !== hippo.length || raiminiscence.length === 0) {
    throw new Error("pairedMeanDifference needs two non-empty, paired samples of the same length");
  }
  const differences = raiminiscence.map((value, i) => value - hippo[i]!);
  const random = seededRandom(SEED);
  const resampled = Array.from({ length: RESAMPLES }, () =>
    mean(differences.map(() => differences[Math.floor(random() * differences.length)]!)),
  ).sort((a, b) => a - b);
  return {
    raiminiscence: mean(raiminiscence),
    hippo: mean(hippo),
    difference: mean(differences),
    ci95: [resampled[Math.floor(RESAMPLES * 0.025)]!, resampled[Math.ceil(RESAMPLES * 0.975) - 1]!],
  };
}

const tagsOf = (memory: LongMemEvalRow["retrieved_memories"][number]) => memory.tags ?? [];

/** evaluate_retrieval.py's `check_session_hit`: an evidence session's id inside any tag of a top-k memory. */
function anyEvidence(row: LongMemEvalRow, evidence: string[], k: number): number {
  return Number(row.retrieved_memories.slice(0, k).some((memory) => evidence.some((id) => tagsOf(memory).some((tag) => tag.includes(id)))));
}

/** score_haystack.py's `all`: every evidence session is the first tag of some top-k memory. */
function allEvidence(row: LongMemEvalRow, evidence: string[], k: number): number {
  const top = row.retrieved_memories.slice(0, k).map((memory) => tagsOf(memory)[0]);
  return Number(evidence.every((id) => top.includes(id)));
}

/** evaluate_retrieval.py's `check_answer_in_content`: the answer verbatim, or 60% of its words over three characters. */
function answerInContent(row: LongMemEvalRow, answer: unknown, k: number): number {
  const wanted = String(answer).toLowerCase().trim();
  const terms = wanted.split(/\s+/).filter((word) => word.length > 3);
  if (wanted.length < 3 || terms.length === 0) return 0;
  return Number(
    row.retrieved_memories.slice(0, k).some((memory) => {
      const content = (memory.content ?? "").toLowerCase();
      return content.includes(wanted) || terms.filter((term) => content.includes(term)).length / terms.length >= 0.6;
    }),
  );
}

/** LongMemEval-S's reported metrics, per question, from one run's harness rows. */
export function longMemEvalHits(rows: LongMemEvalRow[], questions: LongMemEvalQuestion[]): Record<string, Scores> {
  const byId = new Map(questions.map((question) => [question.question_id, question]));
  const metrics: Record<string, Scores> = {};
  const put = (metric: string, id: string, score: number) => ((metrics[metric] ??= {})[id] = score);
  for (const row of rows) {
    const question = byId.get(row.question_id);
    if (!question) throw new Error(`question ${row.question_id} is not in the dataset`);
    const evidence = question.answer_session_ids;
    for (const k of [1, 3, 5, 10]) put(`any-evidence R@${k}`, row.question_id, evidence.length ? anyEvidence(row, evidence, k) : 0);
    put("answer_in_content@5", row.question_id, answerInContent(row, question.answer, 5));
    if (row.question_id.includes("_abs")) continue;
    for (const k of [1, 5, 10]) put(`all-evidence R@${k}`, row.question_id, allEvidence(row, evidence, k));
  }
  return metrics;
}

/** LoCoMo evidence recall@k per scored QA, from score_evidence.py's rescored rows; k = 1 and 3 reuse the saved top 5. */
export function locomoRecall(qas: LocomoQa[]): Record<string, Scores> {
  const metrics: Record<string, Scores> = {};
  for (const qa of qas.filter((candidate) => candidate.scored)) {
    const gold = new Set(qa.gold_evidence);
    for (const k of [1, 3, 5]) {
      const found = qa.retrieved_dia_ids.slice(0, k).filter((id) => gold.has(id)).length;
      (metrics[`R@${k}`] ??= {})[`${qa.conversation_id}#${qa.qa_index}`] = found / gold.size;
    }
  }
  return metrics;
}

/** One check per metric: rAIminiscence against one hippo-memory arm, paired by question. */
export function metricChecks(suite: string, reference: string, metrics: Record<string, { rai: Scores; hippo: Scores }>): MetricCheck[] {
  return Object.entries(metrics).map(([metric, { rai, hippo }]) => {
    const ids = Object.keys(rai).sort();
    const hippoIds = Object.keys(hippo).sort();
    if (ids.length !== hippoIds.length || ids.some((id, i) => id !== hippoIds[i])) {
      throw new Error(`${suite} ${metric}: rAIminiscence and ${reference} must cover the same questions`);
    }
    const paired = pairedMeanDifference(
      ids.map((id) => rai[id]!),
      ids.map((id) => hippo[id]!),
    );
    return { suite, reference, metric, ...paired, pass: paired.ci95[0] >= LOWER_BOUND_FLOOR - 1e-12 };
  });
}

export function hookChecks(sizes: HookSize[]): HookCheck[] {
  return sizes.map(({ storeSize, summary: { medianMs } }) => ({
    storeSize,
    raiminiscenceMs: medianMs.raiminiscence,
    hippoMs: medianMs.hippo,
    pass: medianMs.raiminiscence <= medianMs.hippo,
  }));
}

export function gateVerdict(metrics: MetricCheck[], hooks: HookCheck[]): GateVerdict {
  return { pass: metrics.every((check) => check.pass) && hooks.every((check) => check.pass), metrics, hooks };
}

const points = (value: number) => (100 * value).toFixed(1);
const signed = (value: number) => `${value >= 0 ? "+" : "-"}${Math.abs(100 * value).toFixed(1)}`;
const verdictWord = (pass: boolean) => (pass ? "passes" : "fails");

export function renderGateReport(verdict: GateVerdict, run: { date: string; hippoVersion: string; sources: string[] }): string {
  const failing = [
    ...verdict.metrics.filter((check) => !check.pass).map((check) => `${check.suite} ${check.metric} against ${check.reference}`),
    ...verdict.hooks.filter((check) => !check.pass).map((check) => `the hook at ${check.storeSize} Memories`),
  ];
  return [
    `# Benchmark gate against hippo-memory ${run.hippoVersion} (${run.date})`,
    "",
    verdict.pass
      ? "**Passes.** Every check holds."
      : `**Fails.** ${failing.length === 1 ? "1 check fails" : `${failing.length} checks fail`}: ${failing.join("; ")}.`,
    "",
    `The gate, from \`NEXT_STEPS.md\`: on every reported metric of every public benchmark, the lower bound of the paired 95% interval for rAIminiscence minus hippo-memory stays at or above ${signed(LOWER_BOUND_FLOOR)} points, and the per-turn hook's median stays at or below hippo-memory's at each store size. Intervals are percentile bootstraps over whole questions, ${RESAMPLES.toLocaleString("en")} resamples, seed ${SEED}. rAIminiscence runs its default, Embedded provider, against each hippo-memory arm.`,
    "",
    "| Suite | Against | Metric | rAIminiscence | hippo-memory | Difference [95% CI] | Verdict |",
    "|---|---|---|---|---|---|---|",
    ...verdict.metrics.map(
      (check) =>
        `| ${check.suite} | ${check.reference} | ${check.metric} | ${points(check.raiminiscence)} | ${points(check.hippo)} | ${signed(check.difference)} [${signed(check.ci95[0])}, ${signed(check.ci95[1])}] | ${verdictWord(check.pass)} |`,
    ),
    "",
    "| Memories | rAIminiscence hook median | hippo-memory hook median | Verdict |",
    "|---|---|---|---|",
    ...verdict.hooks.map(
      (check) => `| ${check.storeSize} | ${check.raiminiscenceMs.toFixed(1)} ms | ${check.hippoMs.toFixed(1)} ms | ${verdictWord(check.pass)} |`,
    ),
    "",
    "Sources:",
    "",
    ...run.sources.map((source) => `- \`${source}\``),
    "",
  ].join("\n");
}
