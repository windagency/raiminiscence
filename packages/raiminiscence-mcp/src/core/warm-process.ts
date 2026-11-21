import type { ServerLogger } from "#src/adapters/logger.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { serveWarmModel } from "./embeddings/default-provider.js";
import { PACKAGE_VERSION } from "./package-version.js";
import { serveRecall } from "./served-recall.js";

/**
 * ADR-0040: the short-lived process the per-turn hook starts when no MCP
 * server runs. It serves ADR-0039's recall socket and ADR-0038's embed
 * socket with the server's own code, and nothing else, until it is no
 * longer needed.
 */

/** How long the warm process stays up with no request on either socket. */
export const WARM_IDLE_MS = 30 * 60_000;
const CHECK_MS = 60_000;

/**
 * Why the warm process stopped. `not-serving`: another server already
 * serves this recall, or the warm path is off. `replaced`: another server
 * took over its socket file. `other-release`: a client of another package
 * version asked, so that release's hook can start its own.
 */
export type WarmProcessExit = "not-serving" | "idle" | "replaced" | "other-release";

export interface WarmProcessOptions {
  storageRoot: string;
  embeddingProvider: EmbeddingProvider;
  logger?: ServerLogger;
  idleMs?: number;
  /** How often it checks its idle time and its socket. */
  checkMs?: number;
  /** Default to the paths the hook and the MCP server compute. */
  recallSocketPath?: string;
  embedSocketPath?: string;
}

/** Serves until it is idle, replaced or outdated, then closes both sockets and resolves why. */
export async function runWarmProcess(options: WarmProcessOptions): Promise<WarmProcessExit> {
  const idleMs = options.idleMs ?? WARM_IDLE_MS;
  let lastRequestAt = Date.now();
  let stop!: (exit: WarmProcessExit) => void;
  const stopped = new Promise<WarmProcessExit>((resolve) => (stop = resolve));

  // An embed request reaches the provider, and so does every recall's query.
  const provider: EmbeddingProvider = {
    identity: options.embeddingProvider.identity,
    embed: (text, role) => {
      lastRequestAt = Date.now();
      return options.embeddingProvider.embed(text, role);
    },
  };
  const recallServer = await serveRecall({
    storageRoot: options.storageRoot,
    embeddingProvider: provider,
    logger: options.logger,
    socketPath: options.recallSocketPath,
    onRequest: (clientPackage) => {
      lastRequestAt = Date.now();
      // After this reply goes out: the client rejects it, then falls back.
      if (clientPackage !== null && clientPackage !== PACKAGE_VERSION) setImmediate(() => stop("other-release"));
    },
  });
  if (!recallServer) return "not-serving";
  const embedServer = await serveWarmModel(provider, options.embedSocketPath);

  // The sockets never keep the process alive; this timer does, until it stops.
  const timer = setInterval(() => {
    if (!recallServer.owned()) stop("replaced");
    else if (Date.now() - lastRequestAt >= idleMs) stop("idle");
  }, options.checkMs ?? CHECK_MS);
  const exit = await stopped;
  clearInterval(timer);
  await Promise.all([recallServer.close(), embedServer?.close()]);
  return exit;
}
