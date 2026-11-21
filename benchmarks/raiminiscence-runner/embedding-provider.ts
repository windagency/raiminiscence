import type { EmbeddingProvider } from "../../packages/raiminiscence-mcp/src/core/embeddings/provider.js";
import { ollamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import { embeddedEmbeddingProvider } from "./embedded-embedding-provider.js";

const ENV_VAR = "BENCHMARK_EMBEDDING_PROVIDER";

/**
 * Selects which rAIminiscence embedding provider this benchmark run uses,
 * via the `BENCHMARK_EMBEDDING_PROVIDER` env var (`"ollama"` | `"embedded"`,
 * default `"ollama"` to match this suite's existing, already-published
 * results). Mirrors the product's own config discriminant
 * (`provider?: "ollama" | "embedded"` in `project-root.ts`/
 * `default-provider.ts`) rather than inventing new value names — v17 made
 * the Embedded Provider (in-process, no separate server) the product
 * default, but every raiminiscence-runner file still hardcoded the Ollama
 * one, so there was no way to point this benchmark at the actual shipped
 * default (see benchmarks/README.md's "Embedding backends" section).
 */
export function resolveEmbeddingProvider(): EmbeddingProvider {
  const selected = process.env[ENV_VAR] ?? "ollama";
  if (selected === "ollama") return ollamaEmbeddingProvider;
  if (selected === "embedded") return embeddedEmbeddingProvider;
  throw new Error(`${ENV_VAR}="${selected}" is not valid — expected "ollama" or "embedded"`);
}
