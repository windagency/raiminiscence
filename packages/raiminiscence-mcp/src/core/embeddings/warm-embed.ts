import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestLine, serveLines, type LineServer } from "#src/core/adapters/local-socket.js";
import { identityKey, sameIdentity, type EmbeddingProvider, type EmbeddingProviderIdentity, type EmbedRole } from "./provider.js";
import { parseWarmEmbedReply, parseWarmEmbedRequest } from "./warm-embed-schema.js";

/**
 * ADR-0038: a running MCP server keeps the Embedded model loaded and serves
 * vectors over a local socket, so a short-lived caller such as the per-turn
 * hook skips the model load. The caller falls back to its own local
 * provider on any failure, so the socket only ever saves time.
 */

/** How long a caller waits for the server before embedding locally. */
export const WARM_EMBED_TIMEOUT_MS = 250;

export type WarmEmbedServer = LineServer;

/** Off on Windows, and wherever `RAIMINISCENCE_WARM_EMBED` is `off`. */
export function warmEmbedEnabled(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32" && env.RAIMINISCENCE_WARM_EMBED !== "off";
}

/** One socket per user and model, and per prompt scheme (ADR-0042), under the owner-only `~/.raiminiscence/run`. */
export function warmEmbedSocketPath(identity: EmbeddingProviderIdentity, home: string = homedir()): string {
  const hash = createHash("sha256").update(identityKey(identity)).digest("hex").slice(0, 16);
  return join(home, ".raiminiscence", "run", `embed-${hash}.sock`);
}

/**
 * Serves `provider`'s vectors on `socketPath` and starts loading its model
 * at once. Resolves `undefined` when another server already owns the socket
 * or listening fails.
 */
export async function startWarmEmbedServer(provider: EmbeddingProvider, socketPath: string): Promise<WarmEmbedServer | undefined> {
  const server = await serveLines(socketPath, async (line) => {
    const request = parseWarmEmbedRequest(line);
    const vector = request ? await provider.embed(request.text, request.role) : null;
    return JSON.stringify({ identity: provider.identity, vector });
  });
  if (server) void provider.embed("warm-up", "query");
  return server;
}

/**
 * Asks the server on `socketPath` first. Uses its vector only when its
 * identity is exactly `local`'s; otherwise, or on any failure or timeout,
 * embeds with `local`.
 */
export function createWarmEmbeddingProvider(local: EmbeddingProvider, socketPath: string, timeoutMs = WARM_EMBED_TIMEOUT_MS): EmbeddingProvider {
  return {
    identity: local.identity,
    async embed(text: string, role: EmbedRole): Promise<number[] | null> {
      const reply = parseWarmEmbedReply(await requestLine(socketPath, JSON.stringify({ text, role }), timeoutMs));
      if (reply?.vector && sameIdentity(reply.identity, local.identity)) return reply.vector;
      return local.embed(text, role);
    },
  };
}
