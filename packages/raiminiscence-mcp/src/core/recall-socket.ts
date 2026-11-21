import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestLine, serveLines, type LineServer } from "#src/core/adapters/local-socket.js";
import { identityKey, sameIdentity, type EmbeddingProviderIdentity } from "./embeddings/provider.js";
import type { RecallResultItem } from "./recall.js";
import { parseRecallSocketReply, parseRecallSocketRequest, RECALL_SOCKET_PROTOCOL } from "./recall-socket-schema.js";

/**
 * ADR-0039: a running MCP server answers the per-turn hook's whole recall
 * over a local socket, so a short-lived hook process skips loading the
 * engine and parsing the recall cache. The caller recalls locally on any
 * failure, so the socket only ever saves time. This module never imports
 * the engine: the server side is handed its `recall` call.
 */

/** How long a caller waits for the server before recalling locally. */
export const RECALL_SOCKET_TIMEOUT_MS = 250;

export type RecallServer = LineServer;

/**
 * The directory a storage root really is, so a symlinked path and its
 * target name one store. The server's working directory is always the real
 * path, while the hook gets whatever path its client sends. A root that
 * doesn't exist yet is kept as given.
 */
function canonicalRoot(storageRoot: string): string {
  try {
    return realpathSync(storageRoot);
  } catch {
    return storageRoot;
  }
}

/** Names one storage root and model, and prompt scheme (ADR-0042), for the files under `~/.raiminiscence/run` that belong to them. */
export function storageRootHash(storageRoot: string, identity: EmbeddingProviderIdentity): string {
  return createHash("sha256")
    .update(`${canonicalRoot(storageRoot)}\0${identityKey(identity)}`)
    .digest("hex")
    .slice(0, 16);
}

/** One socket per storage root and model, under the owner-only `~/.raiminiscence/run`. */
export function recallSocketPath(storageRoot: string, identity: EmbeddingProviderIdentity, home: string = homedir()): string {
  return join(home, ".raiminiscence", "run", `recall-${storageRootHash(storageRoot, identity)}.sock`);
}

export interface RecallServerOptions {
  storageRoot: string;
  identity: EmbeddingProviderIdentity;
  packageVersion: string;
  recall: (params: { query: string; k: number }) => Promise<RecallResultItem[]>;
  /** Called on each request with the client's package version, or `null` when the request isn't the expected shape. */
  onRequest?: (clientPackage: string | null) => void;
}

/**
 * Answers recall requests for `storageRoot` on `socketPath`. A request for
 * another storage root, or one that isn't the expected shape, gets `results:
 * null`. Resolves `undefined` when another server already owns the socket or
 * listening fails.
 */
export function startRecallServer(options: RecallServerOptions, socketPath: string): Promise<RecallServer | undefined> {
  return serveLines(socketPath, async (line) => {
    const request = parseRecallSocketRequest(line);
    options.onRequest?.(request?.package ?? null);
    const ownRoot = request !== null && canonicalRoot(request.storageRoot) === canonicalRoot(options.storageRoot);
    const results = ownRoot ? await options.recall({ query: request.query, k: request.k }) : null;
    return JSON.stringify({ v: RECALL_SOCKET_PROTOCOL, package: options.packageVersion, identity: options.identity, results });
  });
}

export interface ServedRecallRequest {
  socketPath: string;
  storageRoot: string;
  identity: EmbeddingProviderIdentity;
  packageVersion: string;
  query: string;
  k: number;
  timeoutMs?: number;
}

/**
 * Asks the server on `socketPath` for a recall. Returns its results only
 * when the protocol version, the package version and the identity all equal
 * the caller's; otherwise, or on any failure or timeout, `null`.
 */
export async function requestServedRecall(request: ServedRecallRequest): Promise<RecallResultItem[] | null> {
  const { socketPath, storageRoot, identity, packageVersion, query, k } = request;
  const line = JSON.stringify({ v: RECALL_SOCKET_PROTOCOL, package: packageVersion, storageRoot, query, k });
  const reply = parseRecallSocketReply(await requestLine(socketPath, line, request.timeoutMs ?? RECALL_SOCKET_TIMEOUT_MS));
  const matches = reply?.v === RECALL_SOCKET_PROTOCOL && reply.package === packageVersion && sameIdentity(reply.identity, identity);
  return matches ? reply.results : null;
}
