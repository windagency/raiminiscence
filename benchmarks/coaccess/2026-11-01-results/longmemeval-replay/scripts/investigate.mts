// Replays one question like replay.mts, keeps the stores, and explains the final ranking:
// edge weights, which sessions (by date order) the edges join, and each Memory's score with
// and without edges. The two stores differ only in their edges, so the difference is the boost.
// usage: tsx investigate.mts <question_id>
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIST = "/Users/Shared/raim-bench/fullbody/packages/raiminiscence-mcp/dist/core";
const { recall, remember, inspectQuery } = await import(`${DIST}/engine.js`);
const { readAllMemories } = await import(`${DIST}/storage.js`);
const { readCoAccessIndex } = await import(`${DIST}/co-access.js`);
const { createOllamaEmbeddingProvider } = await import(`${DIST}/embeddings/ollama.js`);

const B = "/Users/Shared/raim-bench";
const qid = process.argv[2]!;
type Turn = { role: string; content: string };
const q = (JSON.parse(readFileSync("/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json", "utf8")) as any[]).find((x) => x.question_id === qid);
const ollama = createOllamaEmbeddingProvider({ timeoutMs: 15_000 });
const vectors = new Map<string, number[]>();
const pre = `${B}/lme-w/rai-ollama/stores/${qid}/work/.hippo`;
for (const m of readAllMemories(pre)) {
  const f = join(pre, ".raiminiscence", "memory", "embeddings", `${m.frontmatter.id}.json`);
  if (existsSync(f)) vectors.set(m.body, JSON.parse(readFileSync(f, "utf8")).vector);
}
const provider = { identity: ollama.identity, embed: async (t: string) => vectors.get(t) ?? ollama.embed(t) };

const dir = `${B}/coaccess/investigate/${qid}`;
rmSync(dir, { recursive: true, force: true });
const on = `${dir}/on`, off = `${dir}/off`;
mkdirSync(on, { recursive: true });
const when = (d: string) => d.replace(/ \(\w+\)/, "");
const order = q.haystack_session_ids.map((_: string, i: number) => i).sort((a: number, b: number) => when(q.haystack_dates[a]).localeCompare(when(q.haystack_dates[b])) || a - b);
const pos: Record<string, number> = {};
const sid: Record<string, string> = {};
const topSetsAt: number[][] = [];
for (const [p, i] of order.entries()) {
  const session: Turn[] = q.haystack_sessions[i];
  if (p > 0) {
    for (const turn of session) {
      if (turn.role !== "user" || turn.content.trim() === "") continue;
      const r = await recall({ query: turn.content, k: 10, storageRoot: on, embeddingProvider: provider, triggerConsolidation: false });
      topSetsAt.push(r.results.map((x: { id: string }) => pos[x.id]!).sort((a: number, b: number) => a - b));
    }
  }
  const m = await remember({ content: session.map((t) => t.content).join("\n"), client: "benchmark", storageRoot: on, embeddingProvider: provider, triggerConsolidation: false });
  pos[m.id] = p;
  sid[m.id] = q.haystack_session_ids[i];
}
cpSync(on, off, { recursive: true });
rmSync(join(off, ".raiminiscence", "memory", "co-access"), { recursive: true, force: true });
rmSync(join(off, ".raiminiscence", "cache"), { recursive: true, force: true });

const edges = Object.entries(readCoAccessIndex(on) as Record<string, number>).map(([k, w]) => [k.split("|").map((id) => pos[id] ?? k), w] as const).sort((a, b) => (b[1] as number) - (a[1] as number));
const members = [...new Set(edges.flatMap(([ids]) => ids as number[]))].sort((a, b) => a - b);
const distinctTopSets = new Set(topSetsAt.map((s) => s.join(","))).size;
console.log(JSON.stringify({ qid, sessions: order.length, recalls: topSetsAt.length, edges: edges.length, cliqueMembersByDatePosition: members,
  edgeWeight: { max: edges[0]?.[1], min: edges.at(-1)?.[1] }, distinctTop10SetsAcrossRecalls: distinctTopSets,
  firstTop10Sets: topSetsAt.slice(0, 3), lastTop10Set: topSetsAt.at(-1) }));

const evidence = new Set(q.answer_session_ids);
const scored = async (root: string) => new Map((await inspectQuery({ query: q.question, k: 1000, storageRoot: root, embeddingProvider: provider })).results.map((r: { id: string; score: number }, rank: number) => [r.id, { score: r.score, rank: rank + 1 }]));
const sOn = await scored(on), sOff = await scored(off);
const rows = [...sOff.entries()].map(([id, o]) => ({ datePos: pos[id], evidence: evidence.has(sid[id]), rankOff: o.rank, rankOn: sOn.get(id)?.rank, scoreOff: +o.score.toFixed(3), boost: +((sOn.get(id)?.score ?? 0) - o.score).toFixed(3) }));
rows.sort((a, b) => a.rankOn! - b.rankOn!);
for (const r of rows.slice(0, 14)) console.log(JSON.stringify(r));
