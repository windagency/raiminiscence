// Median recall latency on one store with one frozen build, k = 10, warm cache.
// usage: tsx measure.mts <baseline|fullbody> <storageRoot> <e2e|scoring>
// e2e embeds the query on every call; scoring reuses one query vector, isolating ranking cost.
const [build, storageRoot, mode] = process.argv.slice(2) as [string, string, string];
const dist = `/Users/Shared/raim-bench/${build}/packages/raiminiscence-mcp/dist/core`;
const { recall } = await import(`${dist}/engine.js`);
const { createEmbeddedEmbeddingProvider } = await import(`${dist}/embeddings/embedded.js`);

const QUERY = "How does authentication work in this codebase?";
const REPS = 7;
const real = createEmbeddedEmbeddingProvider();
const vector = await real.embed(QUERY);
const embeddingProvider = mode === "scoring" ? { identity: real.identity, embed: async () => vector } : real;

const call = () => recall({ query: QUERY, k: 10, storageRoot, embeddingProvider, triggerConsolidation: false });
const first = await call();
if (first.usedFallback) throw new Error("recall fell back to lexical scoring");
const ms: number[] = [];
for (let i = 0; i < REPS; i++) {
  const start = performance.now();
  await call();
  ms.push(performance.now() - start);
}
ms.sort((a, b) => a - b);
console.log(JSON.stringify({ build, mode, medianMs: Math.round(ms[REPS >> 1]! * 10) / 10, minMs: Math.round(ms[0]! * 10) / 10, maxMs: Math.round(ms[REPS - 1]! * 10) / 10 }));
