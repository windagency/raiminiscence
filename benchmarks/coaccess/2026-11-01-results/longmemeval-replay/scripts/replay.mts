/**
 * Co-access on vs off on LongMemEval-S, replaying the product's own per-turn loop.
 *
 * Pre-registered 2026-10-31, before any replay ran:
 * - Questions: the 324 with two or more evidence sessions.
 * - Build: sessions in date order. Before each session is remembered, every user turn in it
 *   is a recall with the per-turn hook's parameters (k 10, no consolidation) against the store
 *   so far. That is what forms Co-access Edges in real use. Then the session is remembered.
 * - Arms: "on" is the store as built. "off" is a copy with memory/co-access and the recall
 *   cache removed, so only the edges differ; recallCount and lastRecalledAt stay in both.
 * - Final query: the question, ranking the whole store, once per arm.
 * - Primary: R@1 (any evidence session first) and all-evidence@5, on minus off, paired
 *   bootstrap 10k, seed 1. Secondary: R@5, R@10, per question type.
 * Session vectors are reused from the rai-ollama arm's stores by exact text; same model.
 *
 * usage: tsx replay.mts <shard> <shards>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "/Users/Shared/raim-bench/fullbody/packages/raiminiscence-mcp/dist/core";
const { recall, remember } = await import(`${DIST}/engine.js`);
const { readAllMemories } = await import(`${DIST}/storage.js`);
const { createOllamaEmbeddingProvider } = await import(`${DIST}/embeddings/ollama.js`);

const B = "/Users/Shared/raim-bench";
const DATA = "/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json";
const OUT = `${B}/coaccess`;
const [shard, shards] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 1)];
const LIFTED_K = 100_000;

type Turn = { role: string; content: string };
type Question = { question_id: string; question_type: string; question: string; answer_session_ids: string[];
  haystack_session_ids: string[]; haystack_dates: string[]; haystack_sessions: Turn[][] };

const ollama = createOllamaEmbeddingProvider({ timeoutMs: 15_000 });

function prebuiltVectors(qid: string): Map<string, number[]> {
  const root = `${B}/lme-w/rai-ollama/stores/${qid}/work/.hippo`;
  const vectors = new Map<string, number[]>();
  for (const memory of readAllMemories(root)) {
    const file = join(root, ".raiminiscence", "memory", "embeddings", `${memory.frontmatter.id}.json`);
    if (existsSync(file)) vectors.set(memory.body, JSON.parse(readFileSync(file, "utf8")).vector);
  }
  return vectors;
}

function when(date: string): string {
  return date.replace(/ \(\w+\)/, "");
}

async function replayOne(q: Question) {
  const vectors = prebuiltVectors(q.question_id);
  const stats = { reused: 0, embedded: 0, fallbacks: 0, recalls: 0 };
  const provider = {
    identity: ollama.identity,
    async embed(text: string) {
      const hit = vectors.get(text);
      if (hit) { stats.reused++; return hit; }
      stats.embedded++;
      return ollama.embed(text);
    },
  };
  const dir = `${OUT}/stores/${q.question_id}`;
  rmSync(dir, { recursive: true, force: true });
  const on = `${dir}/on`, off = `${dir}/off`;
  mkdirSync(on, { recursive: true });
  const ids: Record<string, string> = {};
  const order = q.haystack_session_ids.map((_, i) => i).sort((a, b) => when(q.haystack_dates[a]!).localeCompare(when(q.haystack_dates[b]!)) || a - b);
  for (const i of order) {
    const session = q.haystack_sessions[i]!;
    if (Object.keys(ids).length > 0) {
      for (const turn of session) {
        if (turn.role !== "user" || turn.content.trim() === "") continue;
        const result = await recall({ query: turn.content, k: 10, storageRoot: on, embeddingProvider: provider, triggerConsolidation: false });
        stats.recalls++;
        if (result.usedFallback) stats.fallbacks++;
      }
    }
    const remembered = await remember({ content: session.map((t) => t.content).join("\n"), client: "benchmark", storageRoot: on, embeddingProvider: provider, triggerConsolidation: false });
    if (!remembered.embedded) throw new Error(`${q.question_id}: session ${q.haystack_session_ids[i]} stored without an embedding`);
    ids[remembered.id] = q.haystack_session_ids[i]!;
  }
  cpSync(on, off, { recursive: true });
  const coAccessDir = join(off, ".raiminiscence", "memory", "co-access");
  const edges = existsSync(join(on, ".raiminiscence", "memory", "co-access")) ? readdirSync(join(on, ".raiminiscence", "memory", "co-access")).length : 0;
  rmSync(coAccessDir, { recursive: true, force: true });
  rmSync(join(off, ".raiminiscence", "cache"), { recursive: true, force: true });

  const ranks: Record<string, Record<string, number | null>> = {};
  for (const [arm, root] of [["on", on], ["off", off]] as const) {
    const result = await recall({ query: q.question, k: LIFTED_K, storageRoot: root, embeddingProvider: provider, triggerConsolidation: false });
    if (result.usedFallback) throw new Error(`${q.question_id}: final query fell back`);
    const ranked: string[] = result.results.map((r: { id: string }) => ids[r.id] ?? `unknown:${r.id}`);
    ranks[arm] = Object.fromEntries(q.answer_session_ids.map((sid) => [sid, ranked.includes(sid) ? ranked.indexOf(sid) + 1 : null]));
  }
  rmSync(dir, { recursive: true, force: true });
  return { question_id: q.question_id, question_type: q.question_type, edges, ...stats, ranks };
}

const questions = (JSON.parse(readFileSync(DATA, "utf8")) as Question[]).filter((q) => q.answer_session_ids.length >= 2);
const outFile = `${OUT}/replay-${shard}.jsonl`;
const done = new Set(existsSync(outFile) ? readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).question_id) : []);
const mine = questions.filter((_, i) => i % shards === shard && !done.has(questions[i]!.question_id));
const limit = Number(process.env.LIMIT ?? Infinity);
const start = performance.now();
for (const [n, q] of mine.slice(0, limit).entries()) {
  const row = await replayOne(q);
  appendFileSync(outFile, JSON.stringify(row) + "\n");
  console.error(`shard ${shard}: ${done.size + n + 1}/${Math.ceil(questions.length / shards)} ${q.question_id} edges ${row.edges} recalls ${row.recalls} embedded ${row.embedded} fallbacks ${row.fallbacks} ${((performance.now() - start) / 1000).toFixed(0)}s`);
}
writeFileSync(`${OUT}/shard-${shard}.done`, "");
