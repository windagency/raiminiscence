import { readFileSync } from "node:fs";
const DIST = "/Users/Shared/raim-bench/cachelog/packages/raiminiscence-mcp/dist/core";
const { inspectQuery } = await import(`${DIST}/engine.js`);
const { createOllamaEmbeddingProvider } = await import(`${DIST}/embeddings/ollama.js`);
const p = createOllamaEmbeddingProvider({ timeoutMs: 30_000 });
for (const repo of ["flask", "hono"]) {
  const data = JSON.parse(readFileSync(`data/${repo}.json`, "utf8"));
  const c = data.test[5];
  const s: Record<string, Map<string, number>> = {};
  for (const arm of ["on", "off"]) {
    const r = await inspectQuery({ query: c.message, k: 100000, storageRoot: `stores/${repo}/${arm}`, embeddingProvider: p });
    s[arm] = new Map(r.results.map((x: any) => [x.id, x.score]));
  }
  const d = [...s.on!].map(([id, v]) => v - s.off!.get(id)!).sort((a, b) => a - b);
  const offScores = [...s.off!.values()].sort((a, b) => b - a);
  console.log(repo, "boost min/median/max", d[0]!.toFixed(4), d[d.length >> 1]!.toFixed(4), d[d.length - 1]!.toFixed(4), "off top1-top10 gap", (offScores[0]! - offScores[9]!).toFixed(4));
}
