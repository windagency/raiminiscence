import type { EmbeddingProviderConfig } from "#src/core/project-root.js";
import { resolveEmbeddingProviderConfig } from "#src/core/project-root.js";
import type { EmbeddingProvider } from "./provider.js";
import { createOllamaEmbeddingProvider } from "./ollama.js";
import { createEmbeddedEmbeddingProvider } from "./embedded.js";
import { createWarmEmbeddingProvider, startWarmEmbedServer, warmEmbedEnabled, warmEmbedSocketPath, type WarmEmbedServer } from "./warm-embed.js";
import type { ServerLogger } from "#src/adapters/logger.js";

/**
 * v17: the Embedded Provider is constructed whenever resolution
 * yields `"embedded"` (the new default for a project with no
 * `embeddingProvider` config at all); an explicit `"ollama"` config (or the
 * legacy bare `{endpoint, model}` shape, which resolves to `"ollama"` too)
 * keeps selecting the Ollama Provider exactly as before v17.
 */
export function createEmbeddingProviderFromConfig(config: EmbeddingProviderConfig, logger?: ServerLogger): EmbeddingProvider {
  if (config.provider === "embedded") {
    return createEmbeddedEmbeddingProvider({ model: config.model });
  }
  return createOllamaEmbeddingProvider({ ...config, logger });
}

/** ADR-0038, ADR-0039: one switch for everything a running server shares with short-lived callers. */
export { warmEmbedEnabled } from "./warm-embed.js";

let defaultEmbeddingProvider: EmbeddingProvider | undefined;

/**
 * Lazily-constructed fallback used by `remember`/`recall` when no provider is
 * supplied explicitly. ADR-0038: an Embedded Provider asks a running MCP
 * server's warm model first.
 */
export function defaultProvider(): EmbeddingProvider {
  defaultEmbeddingProvider ??= preferWarmModel(createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig()));
  return defaultEmbeddingProvider;
}

function preferWarmModel(provider: EmbeddingProvider): EmbeddingProvider {
  if (provider.identity.provider !== "embedded" || !warmEmbedEnabled()) return provider;
  return createWarmEmbeddingProvider(provider, warmEmbedSocketPath(provider.identity));
}

/**
 * ADR-0038: serves an Embedded Provider's model on its warm socket, for the
 * MCP server and ADR-0040's warm process. Resolves `undefined` when it
 * doesn't serve.
 */
export async function serveWarmModel(
  provider: EmbeddingProvider,
  socketPath: string = warmEmbedSocketPath(provider.identity),
): Promise<(WarmEmbedServer & { socketPath: string }) | undefined> {
  if (provider.identity.provider !== "embedded" || !warmEmbedEnabled()) return undefined;
  const server = await startWarmEmbedServer(provider, socketPath);
  return server && { ...server, socketPath };
}
