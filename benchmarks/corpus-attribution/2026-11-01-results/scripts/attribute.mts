// Recall@5 on the hand-labelled corpus, per frozen build, to attribute the 90 -> 80 change.
// usage: tsx attribute.mts <dist core dir> <label>
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const [DIST, label] = process.argv.slice(2) as [string, string];
const { remember, recall } = await import(`${DIST}/engine.js`);
const { createOllamaEmbeddingProvider } = await import(`${DIST}/embeddings/ollama.js`);
const C = "/Users/damientivelet/Projects/biological-memory/benchmarks/corpus";
const { memories } = JSON.parse(readFileSync(`${C}/memories.json`, "utf8"));
const { k, queries } = JSON.parse(readFileSync(`${C}/queries.json`, "utf8"));
const embeddingProvider = createOllamaEmbeddingProvider({ timeoutMs: 15_000 });
const W = "/Users/Shared/raim-bench/corpus-rerun/w";
const base = mkdtempSync(`${W}-${label}-`);
const ids = new Map<string, string>();
for (const m of memories) ids.set((await remember({ content: m.content, kind: m.kind, client: "benchmark", storageRoot: base, embeddingProvider, triggerConsolidation: false })).id, m.id);
let hit = 0, total = 0, fallbacks = 0;
const rows: string[] = [];
for (const q of queries) {
  const dir = mkdtempSync(`${W}-${label}-q-`);
  cpSync(base, dir, { recursive: true });
  const r = await recall({ query: q.query, k, storageRoot: dir, embeddingProvider, triggerConsolidation: false });
  if (r.usedFallback) fallbacks++;
  const top = r.results.map((x: { id: string }) => ids.get(x.id));
  const h = q.relevantIds.filter((id: string) => top.includes(id)).length;
  hit += h; total += q.relevantIds.length;
  rows.push(`${q.id} ${h}/${q.relevantIds.length} ${top.join(",")}`);
  rmSync(dir, { recursive: true, force: true });
}
rmSync(base, { recursive: true, force: true });
console.log(rows.join("\n"));
console.log(`${label}: micro recall@${k} ${hit}/${total}, fallbacks ${fallbacks}`);
