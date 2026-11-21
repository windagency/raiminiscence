import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHippo, hippoRecall } from "./hippo-cli.js";
import { formatSessionText, type LongMemEvalEntry } from "../longmemeval-session.js";
import type { LongMemEvalRetrievalRecord } from "../raiminiscence-runner/longmemeval-retrieve.js";

const K = 10;

/**
 * One fresh, isolated `.hippo/` store per question — mirrors this file's
 * rAIminiscence counterpart and hippo's own "standard task" methodology
 * (per-question-scoped haystack), NOT hippo's `ingest.py` default (which
 * `collect_sessions()`-dedupes every entry's sessions into one shared store —
 * hippo's own "large unified store, no pre-scoping" variant, deliberately
 * worse per hippo-memory.com's own published numbers). Uses the existing,
 * already-proven `hippo-cli.ts` CLI wrapper (same one `recall-runner.ts`
 * uses), not hippo's `retrieve_inprocess.mjs` — see this pass's report for
 * why (a real search.js export mismatch between the installed npm package
 * and the GitHub master-branch benchmark script).
 */
export async function runHippoLongMemEvalRetrieval(entries: LongMemEvalEntry[]): Promise<LongMemEvalRetrievalRecord[]> {
  const records: LongMemEvalRetrievalRecord[] = [];

  for (const entry of entries) {
    const storageRoot = mkdtempSync(join(tmpdir(), `hippo-bench-longmemeval-${entry.question_id}-`));
    try {
      const initResult = runHippo(["init", "--no-hooks", "--no-schedule", "--no-learn"], storageRoot);
      if (initResult.status !== 0) throw new Error(`hippo init failed for ${entry.question_id}: ${initResult.stderr}`);

      for (let i = 0; i < entry.haystack_sessions.length; i++) {
        const sid = entry.haystack_session_ids[i] ?? `session_${i}`;
        const date = entry.haystack_dates[i] ?? "";
        const content = formatSessionText(sid, date, entry.haystack_sessions[i]!);
        const rememberResult = runHippo(["remember", content, "--observed"], storageRoot);
        if (rememberResult.status !== 0) {
          throw new Error(`hippo remember failed for ${entry.question_id}/${sid}: ${rememberResult.stderr}`);
        }
      }

      const response = hippoRecall(entry.question, storageRoot);
      const topK = response.results.slice(0, K);

      records.push({
        question_id: entry.question_id,
        question: entry.question,
        answer: entry.answer,
        question_type: entry.question_type,
        question_date: entry.question_date,
        retrieved_memories: topK.map((hit) => ({
          id: hit.id,
          score: hit.score,
          strength: 0,
          tags: hit.tags,
          content: hit.content,
        })),
        num_retrieved: topK.length,
      });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  }

  return records;
}
