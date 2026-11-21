import { createEmbeddedEmbeddingProvider } from "../../packages/raiminiscence-mcp/src/core/embeddings/embedded.js";

/**
 * The benchmark's Embedded Provider variant: rAIminiscence's actual
 * in-process provider (`nomic-embed-text-v1` via `@huggingface/transformers`,
 * the same one `defaultProvider()` constructs for a project with no
 * `embeddingProvider` config), so benchmark results can reflect the v17
 * default alongside `ollamaEmbeddingProvider`'s existing opt-in comparison.
 */
export const embeddedEmbeddingProvider = createEmbeddedEmbeddingProvider();
