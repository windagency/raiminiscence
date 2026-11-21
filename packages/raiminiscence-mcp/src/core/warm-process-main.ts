import { createLogger } from "#src/adapters/logger.js";
import { createEmbeddingProviderFromConfig } from "./embeddings/default-provider.js";
import { resolveEmbeddingProviderConfig, resolveStorageRoot } from "./project-root.js";
import { runWarmProcess } from "./warm-process.js";

/** ADR-0040: runs the warm process for `storageRoot`, with the provider this project's config names, until it stops. */
export async function startWarmProcessFromConfig(storageRoot: string = resolveStorageRoot()): Promise<void> {
  const logger = createLogger();
  const embeddingProvider = createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig(), logger);
  const exit = await runWarmProcess({ storageRoot, embeddingProvider, logger });
  logger.info({ exit }, "warm process exiting");
}
