export interface LongMemEvalTurn {
  role: string;
  content: string;
}

export interface LongMemEvalEntry {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string;
  answer_session_ids: string[];
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: LongMemEvalTurn[][];
}

/**
 * Mirrors hippo-memory's own `format_session_text` (benchmarks/longmemeval/ingest.py
 * in kitfunso/hippo-memory) byte-for-byte, so hippo's `evaluate_retrieval.py`
 * (`check_session_hit`'s `f"[Session: {sid}]" in content` check) works
 * unmodified against either system's output — used by both
 * raiminiscence-runner/longmemeval-retrieve.ts and
 * hippo-memory-runner/longmemeval-retrieve.ts so the two sides are scored
 * against an identically-formatted memory body, not just an identical corpus.
 */
export function formatSessionText(sessionId: string, date: string, turns: LongMemEvalTurn[]): string {
  const lines: string[] = [];
  if (date) lines.push(`[Date: ${date}]`);
  lines.push(`[Session: ${sessionId}]`);
  lines.push("");
  for (const turn of turns) {
    const role = (turn.role || "unknown").charAt(0).toUpperCase() + (turn.role || "unknown").slice(1);
    lines.push(`${role}: ${turn.content ?? ""}`);
  }
  return lines.join("\n");
}
