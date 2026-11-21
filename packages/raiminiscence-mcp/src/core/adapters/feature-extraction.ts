/**
 * The one module allowed to reference `@huggingface/transformers`
 * (CONTRIBUTING.md's adapter non-negotiable), for the Embedded Provider
 * (`core/embeddings/embedded.ts`). A dynamic `import()` rather than a static
 * one, so the ONNX runtime behind it only loads once an embedding is actually
 * requested, never for a project configured onto the Ollama Provider.
 */
export type FeatureExtractionOutput = { tolist?: () => number[][]; data?: ArrayLike<number> } | number[];

export type FeatureExtractionPipeline = (text: string, options?: Record<string, unknown>) => Promise<FeatureExtractionOutput>;

interface TransformersModule {
  pipeline(task: "feature-extraction", model: string): Promise<FeatureExtractionPipeline>;
}

/** Loads `model` as a feature-extraction pipeline. Rejects if the runtime or the model can't be loaded. */
export async function loadFeatureExtractionPipeline(model: string): Promise<FeatureExtractionPipeline> {
  const transformers = (await import("@huggingface/transformers")) as unknown as TransformersModule;
  return transformers.pipeline("feature-extraction", model);
}
