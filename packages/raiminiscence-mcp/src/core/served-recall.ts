import type { ServerLogger } from "#src/adapters/logger.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { warmEmbedEnabled } from "./embeddings/default-provider.js";
import { PACKAGE_VERSION } from "./package-version.js";
import { recall } from "./recall.js";
import { recallSocketPath, startRecallServer, type RecallServer } from "./recall-socket.js";

export interface ServeRecallOptions {
  storageRoot: string;
  embeddingProvider: EmbeddingProvider;
  logger?: ServerLogger;
  /** Defaults to the per-storage-root, per-model path the hook computes. */
  socketPath?: string;
  /** Called on each request with the client's package version, or `null` for a malformed request. */
  onRequest?: (clientPackage: string | null) => void;
}

/**
 * ADR-0039: serves the per-turn hook's whole recall for the MCP server's
 * storage root, with its own warm provider and in-memory cache. Never
 * triggers a Consolidation pass, as the hook's local recall never does.
 * Resolves `undefined` when it doesn't serve.
 */
export async function serveRecall(options: ServeRecallOptions): Promise<(RecallServer & { socketPath: string }) | undefined> {
  if (!warmEmbedEnabled()) return undefined;
  const { storageRoot, embeddingProvider, logger } = options;
  const socketPath = options.socketPath ?? recallSocketPath(storageRoot, embeddingProvider.identity);
  const server = await startRecallServer(
    {
      storageRoot,
      identity: embeddingProvider.identity,
      packageVersion: PACKAGE_VERSION,
      recall: async ({ query, k }) => (await recall({ storageRoot, query, k, embeddingProvider, logger, triggerConsolidation: false })).results,
      onRequest: options.onRequest,
    },
    socketPath,
  );
  return server && { ...server, socketPath };
}
