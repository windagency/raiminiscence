import {
  loadFeatureExtractionPipeline,
  type FeatureExtractionOutput,
  type FeatureExtractionPipeline,
} from "#src/core/adapters/feature-extraction.js";
import { identityFor, promptedText, type EmbeddingProvider, type EmbedRole } from "./provider.js";

const DEFAULT_MODEL = "nomic-ai/nomic-embed-text-v1";

export interface EmbeddedEmbeddingProviderOptions {
  model?: string;
}

function toVector(output: FeatureExtractionOutput) {
  if (Array.isArray(output)) return Array.isArray(output[0]) ? (output[0] as unknown as number[]) : (output as number[]);
  if (typeof output.tolist === "function") return output.tolist()[0] ?? null;
  if (output.data) return Array.from(output.data);
  return null;
}

/**
 * In-process default Embedding Provider (v17): no separate server, no
 * manual install step, since its runtime is a regular dependency
 * (ADR-0028). Runs the ONNX port of `nomic-embed-text-v1` through
 * `core/adapters/feature-extraction.ts`, chosen for staying closest to the Ollama
 * Provider's retrieval behaviour — see CONTEXT.md's Embedding Provider entry.
 * Never throws: a missing runtime, a model-load failure, or an inference
 * error all resolve to `null`, matching `ollama.ts`'s existing
 * degrade-to-lexical-fallback contract.
 */
export function createEmbeddedEmbeddingProvider(options: EmbeddedEmbeddingProviderOptions = {}): EmbeddingProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const identity = identityFor("embedded", model);
  let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

  function loadExtractor() {
    extractorPromise ??= loadFeatureExtractionPipeline(model);
    return extractorPromise;
  }

  return {
    identity,
    async embed(text: string, role: EmbedRole): Promise<number[] | null> {
      try {
        const extractor = await loadExtractor();
        const output = await extractor(promptedText(identity, text, role), { pooling: "mean", normalize: true });
        return toVector(output);
      } catch {
        // Fallback-expected, per this function's own doc comment: a missing
        // runtime, a model-load failure, or an inference error all degrade
        // to `null`, matching `ollama.ts`'s own fallback contract.
        return null;
      }
    },
  };
}
