import { createOllamaEmbeddingProvider } from "../../packages/raiminiscence-mcp/src/core/embeddings/ollama.js";

/**
 * The benchmark's real embedding provider: rAIminiscence's actual Ollama
 * client (`nomic-embed-text` @ localhost:11434), the same one `defaultProvider()`
 * lazily constructs for production use. A longer timeout than the 2s
 * production default is used here because a cold Ollama model load (first
 * request after `ollama pull`/process start) can exceed 2s; the benchmark
 * would rather wait than silently fall back to the naive scorer and produce
 * a misleading result.
 */
export const ollamaEmbeddingProvider = createOllamaEmbeddingProvider({ timeoutMs: 15_000 });
