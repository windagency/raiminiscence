import { fileURLToPath } from "node:url";
import { resolveEmbeddingProviderConfig } from "./core/project-root.js";
import { createEmbeddingProviderFromConfig, warmEmbedEnabled } from "./core/embeddings/default-provider.js";
import { PACKAGE_VERSION } from "./core/package-version.js";
import type { RecallResultItem } from "./core/recall.js";
import { recallSocketPath, requestServedRecall } from "./core/recall-socket.js";
import { spawnWarmProcess } from "./core/warm-spawn.js";

/**
 * ADR-0039: the light entry point, `raiminiscence-mcp/recall-client`, for
 * the per-turn hook's hot path. It reaches a running server's recall
 * without importing the engine; a caller imports the engine only when this
 * returns `null`, and then starts a warm process (ADR-0040).
 */

export { resolveStorageRoot } from "./core/project-root.js";
export type { RecallResultItem } from "./core/recall.js";

/**
 * A running MCP server's recall for `storageRoot`, made with the same
 * provider and model this process would use. `null` when no matching
 * server answers in time, or when the warm path is switched off.
 */
export async function servedRecall(params: { storageRoot: string; query: string; k: number }): Promise<RecallResultItem[] | null> {
  if (!warmEmbedEnabled()) return null;
  // Building a provider only reads its identity: no model loads until `embed`.
  const identity = createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig()).identity;
  return requestServedRecall({ ...params, socketPath: recallSocketPath(params.storageRoot, identity), identity, packageVersion: PACKAGE_VERSION });
}

/** ADR-0040: the warm process's entry point, next to this file in `dist/`. */
const WARM_ENTRY = fileURLToPath(new URL("./warm.js", import.meta.url));

/**
 * Starts a warm process for `storageRoot` in the background, at most once a
 * minute, so the next prompt finds a recall to ask for. Returns at once and
 * never throws; `false` when it didn't spawn.
 */
export function startWarmProcess(params: { storageRoot: string }): boolean {
  if (!warmEmbedEnabled()) return false;
  const identity = createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig()).identity;
  return spawnWarmProcess({ storageRoot: params.storageRoot, identity, entry: WARM_ENTRY });
}
