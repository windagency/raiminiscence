/**
 * Co-access on vs off on a repeated-work workload: a repo's own history.
 *
 * Pre-registered 2026-11-01, before any replay ran:
 * - Repos: honojs/hono at c91b60a2, pallets/flask at 49943b5a. Non-merge commits in order.
 *   The last 20% are test commits; the snapshot is the last train commit.
 * - Memories: one per tracked text file at the snapshot, under 100 KB, lockfiles excluded.
 *   Body: the path, a newline, then the first 2,000 characters. Remembered in path order.
 * - Training: every train commit's message, up to 2,000 characters, is one recall with the
 *   per-turn hook's parameters (k 10, no consolidation), in commit order. That is what forms
 *   Co-access Edges in real use: the same kind of task, asked again and again.
 * - Arms: "on" is the trained store. "off" is a copy with memory/co-access and the recall
 *   cache removed, so only the edges differ.
 * - Test: every test commit whose changed files include 2 to 10 store files. Its message is
 *   one read-only inspectQuery per arm, edges frozen. Truth: its changed files in the store.
 * - Primary: file recall@10, the share of truth files in the top 10, on minus off, paired
 *   bootstrap 10k, seed 1, per repo and pooled. Secondary: file recall@3 (the default k),
 *   file recall@5, hit@1.
 * Build: cachelog/ (ADR-0032 to ADR-0036). Embeddings: Ollama nomic-embed-text.
 *
 * usage: tsx replay.mts <repo>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "/Users/Shared/raim-bench/cachelog/packages/raiminiscence-mcp/dist/core";
const { recall, remember, inspectQuery } = await import(`${DIST}/engine.js`);
const { createOllamaEmbeddingProvider } = await import(`${DIST}/embeddings/ollama.js`);

const W = "/Users/Shared/raim-bench/rework";
const repo = process.argv[2]!;
type Commit = { sha: string; message: string; inStore: string[] };
const data = JSON.parse(readFileSync(`${W}/data/${repo}.json`, "utf8")) as { files: Record<string, string>; train: Commit[]; test: Commit[] };
const provider = createOllamaEmbeddingProvider({ timeoutMs: 30_000 });
const NO = { triggerConsolidation: false } as const;

const dir = `${W}/stores/${repo}`;
rmSync(dir, { recursive: true, force: true });
const on = `${dir}/on`, off = `${dir}/off`;
mkdirSync(on, { recursive: true });
const pathOf: Record<string, string> = {};
const start = performance.now();
const t = () => `${((performance.now() - start) / 1000).toFixed(0)}s`;

for (const path of Object.keys(data.files).sort()) {
  const r = await remember({ content: data.files[path]!, client: "benchmark", storageRoot: on, embeddingProvider: provider, ...NO });
  if (!r.embedded) throw new Error(`${path}: stored without an embedding`);
  pathOf[r.id] = path;
}
writeFileSync(`${dir}/ids.json`, JSON.stringify(pathOf));
console.error(`${repo}: ${Object.keys(pathOf).length} files remembered ${t()}`);

let fallbacks = 0;
for (const [n, c] of data.train.entries()) {
  const r = await recall({ query: c.message, k: 10, storageRoot: on, embeddingProvider: provider, ...NO });
  if (r.usedFallback) fallbacks++;
  if ((n + 1) % 250 === 0) console.error(`${repo}: train ${n + 1}/${data.train.length} fallbacks ${fallbacks} ${t()}`);
}
const edgeDir = join(on, ".raiminiscence", "memory", "co-access");
const edges = existsSync(edgeDir) ? readdirSync(edgeDir).length : 0;
console.error(`${repo}: trained, ${edges} edge files, ${fallbacks} fallbacks ${t()}`);

cpSync(on, off, { recursive: true });
rmSync(join(off, ".raiminiscence", "memory", "co-access"), { recursive: true, force: true });
rmSync(join(off, ".raiminiscence", "cache"), { recursive: true, force: true });

const outFile = `${W}/${repo}-results.jsonl`;
rmSync(outFile, { force: true });
for (const c of data.test) {
  const ranks: Record<string, Record<string, number | null>> = {};
  for (const [arm, root] of [["on", on], ["off", off]] as const) {
    const r = await inspectQuery({ query: c.message, k: 100_000, storageRoot: root, embeddingProvider: provider });
    if (r.usedFallback) throw new Error(`${c.sha}: test query fell back`);
    const ranked: string[] = r.results.map((x: { id: string }) => pathOf[x.id] ?? `unknown:${x.id}`);
    ranks[arm] = Object.fromEntries(c.inStore.map((p) => [p, ranked.includes(p) ? ranked.indexOf(p) + 1 : null]));
  }
  appendFileSync(outFile, JSON.stringify({ sha: c.sha, ranks }) + "\n");
}
console.error(`${repo}: ${data.test.length} test commits scored ${t()}`);
console.error(`REWORK ${repo} DONE edges=${edges} fallbacks=${fallbacks}`);
