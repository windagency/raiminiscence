// Dumps the off arm's full scored list per test commit, for offline tuning. Flask only.
import { readFileSync, writeFileSync } from "node:fs";
const DIST = "/Users/Shared/raim-bench/cachelog/packages/raiminiscence-mcp/dist/core";
const { inspectQuery } = await import(`${DIST}/engine.js`);
const { createOllamaEmbeddingProvider } = await import(`${DIST}/embeddings/ollama.js`);
const p = createOllamaEmbeddingProvider({ timeoutMs: 30_000 });
const repo = process.argv[2]!;
const data = JSON.parse(readFileSync(`data/${repo}.json`, "utf8"));
const ids = JSON.parse(readFileSync(`stores/${repo}/ids.json`, "utf8"));
const out = [];
for (const c of data.test) {
  const r = await inspectQuery({ query: c.message, k: 100000, storageRoot: `stores/${repo}/off`, embeddingProvider: p });
  out.push({ sha: c.sha, truth: c.inStore, scored: r.results.map((x: any) => [ids[x.id], x.score, x.strength * 0.85]) });
}
writeFileSync(`tune/${repo}-off.json`, JSON.stringify(out));
