// Builds one store of N synthetic Memories (benchmarks/corpus/synthetic-memories.ts) with the
// Embedded provider and the frozen fusion build. usage: tsx build-store.mts <N> <storageRoot>
import { remember } from "/Users/Shared/raim-bench/fullbody/packages/raiminiscence-mcp/dist/core/engine.js";
import { createEmbeddedEmbeddingProvider } from "/Users/Shared/raim-bench/fullbody/packages/raiminiscence-mcp/dist/core/embeddings/embedded.js";
import { generateSyntheticMemories } from "/Users/damientivelet/Projects/biological-memory/benchmarks/corpus/synthetic-memories.ts";

const [n, storageRoot] = [Number(process.argv[2]), process.argv[3]!];
const embeddingProvider = createEmbeddedEmbeddingProvider();
const start = performance.now();
for (const [i, memory] of generateSyntheticMemories(n).entries()) {
  const result = await remember({ content: memory.content, kind: memory.kind, client: "benchmark", storageRoot, embeddingProvider, triggerConsolidation: false });
  if (!result.embedded) throw new Error(`remember ${i}: stored without an embedding`);
  if ((i + 1) % 500 === 0) console.error(`${i + 1}/${n} ${((performance.now() - start) / 1000).toFixed(0)}s`);
}
console.log(JSON.stringify({ n, seconds: Math.round((performance.now() - start) / 1000) }));
