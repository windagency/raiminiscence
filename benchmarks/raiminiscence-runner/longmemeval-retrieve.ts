import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { remember, recall } from "../../packages/raiminiscence-mcp/src/core/engine.js";
import { resolveEmbeddingProvider } from "./embedding-provider.js";
import { withTempDir } from "../temp-dir.js";
import { formatSessionText, type LongMemEvalEntry } from "../longmemeval-session.js";

const embeddingProvider = resolveEmbeddingProvider();
const K = 10;

export interface LongMemEvalRetrievedMemory {
  id: string;
  score: number;
  strength: number;
  tags: string[];
  content: string;
}

export interface LongMemEvalRetrievalRecord {
  question_id: string;
  question: string;
  answer: string;
  question_type: string;
  question_date: string;
  retrieved_memories: LongMemEvalRetrievedMemory[];
  num_retrieved: number;
}

/**
 * One fresh, isolated store per question — mirrors recall-runner.ts's
 * per-query isolation, and matches hippo-memory's own "standard task"
 * methodology (per-question-scoped haystack, not its "large unified store"
 * ingest.py default — see benchmarks/README.md's LongMemEval section).
 *
 * Uses `.detail`, rAIminiscence's real public recall() output, as the output
 * `content`: the whole Memory body since ADR-0033, 280 characters before it.
 * The `[Session: {sid}]` marker sits at the front of the body either way, so
 * hippo's `evaluate_retrieval.py` session-hit check works against it. This is
 * the 2026-09-24 runner; the current comparison uses hippo-memory's harness.
 */
export async function runLongMemEvalRetrieval(entries: LongMemEvalEntry[]): Promise<LongMemEvalRetrievalRecord[]> {
  const records: LongMemEvalRetrievalRecord[] = [];

  for (const entry of entries) {
    await withTempDir(`raiminiscence-bench-longmemeval-${entry.question_id}-`, async (storageRoot) => {
      for (let i = 0; i < entry.haystack_sessions.length; i++) {
        const sid = entry.haystack_session_ids[i] ?? `session_${i}`;
        const date = entry.haystack_dates[i] ?? "";
        const content = formatSessionText(sid, date, entry.haystack_sessions[i]!);
        await remember({
          content,
          kind: "episodic",
          client: "benchmark",
          storageRoot,
          embeddingProvider,
          triggerConsolidation: false,
        });
      }

      const result = await recall({
        query: entry.question,
        k: K,
        storageRoot,
        embeddingProvider,
        triggerConsolidation: false,
      });

      records.push({
        question_id: entry.question_id,
        question: entry.question,
        answer: entry.answer,
        question_type: entry.question_type,
        question_date: entry.question_date,
        retrieved_memories: result.results.map((item) => ({
          id: item.id,
          score: item.score,
          strength: item.strength,
          tags: [],
          content: item.detail,
        })),
        num_retrieved: result.results.length,
      });
    });
  }

  return records;
}

/** Writes one JSONL line per record, matching hippo's retrieve_inprocess.mjs output shape. */
export function writeLongMemEvalJsonl(records: LongMemEvalRetrievalRecord[], outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "");
  for (const record of records) {
    appendFileSync(outputPath, JSON.stringify(record) + "\n");
  }
}
