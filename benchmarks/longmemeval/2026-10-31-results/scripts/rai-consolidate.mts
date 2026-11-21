// One consolidate() pass over the store in <cwd>/.hippo, with the arm's provider, using the
// frozen fusion build. Prints {result, ids}: the pass's counts and every Memory id left after it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { consolidate } from "/Users/Shared/raim-bench/fusion/packages/raiminiscence-mcp/dist/core/consolidate.js";
import { readAllMemories } from "/Users/Shared/raim-bench/fusion/packages/raiminiscence-mcp/dist/core/storage.js";
import { createEmbeddedEmbeddingProvider } from "/Users/Shared/raim-bench/fusion/packages/raiminiscence-mcp/dist/core/embeddings/embedded.js";
import { createOllamaEmbeddingProvider } from "/Users/Shared/raim-bench/fusion/packages/raiminiscence-mcp/dist/core/embeddings/ollama.js";

let dir = process.cwd();
while (!existsSync(join(dir, "raiminiscence-arm.json"))) {
  if (dirname(dir) === dir) throw new Error("no raiminiscence-arm.json");
  dir = dirname(dir);
}
const { provider } = JSON.parse(readFileSync(join(dir, "raiminiscence-arm.json"), "utf8")) as { provider: string };
const embeddingProvider = provider === "ollama" ? createOllamaEmbeddingProvider({ timeoutMs: 15_000 }) : createEmbeddedEmbeddingProvider();
const storageRoot = join(process.cwd(), ".hippo");
const result = await consolidate({ storageRoot, scope: "project", embeddingProvider });
process.stdout.write(JSON.stringify({ result, ids: readAllMemories(storageRoot).map((m) => m.frontmatter.id) }));
