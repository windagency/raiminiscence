import { parseOllamaEmbedding } from "./embedding-schema.js";
import { identityFor, promptedText, type EmbeddingProvider, type EmbedRole } from "./provider.js";
import type { ServerLogger } from "#src/adapters/logger.js";

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_TIMEOUT_MS = 2000;

export interface OllamaEmbeddingProviderOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  /**
   * Optional because `core/` itself has no logger dependency — threaded in
   * from `server.ts` via `createEmbeddingProviderFromConfig`, mirroring
   * `recall`/`remember`'s own `logger` param. When present, a failed
   * `embed()` call logs the degrade-to-null at `warn` instead of staying
   * silent.
   */
  logger?: ServerLogger;
}

/**
 * Local-first default embedding provider. Never throws: a missing/unreachable
 * Ollama instance, a timeout, or an unexpected response all resolve to
 * `null` so `remember` can fall back to `embedded: false` without blocking.
 */
export function createOllamaEmbeddingProvider(options: OllamaEmbeddingProviderOptions = {}): EmbeddingProvider {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger;
  const identity = identityFor("ollama", model);

  return {
    identity,
    async embed(text: string, role: EmbedRole): Promise<number[] | null> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // `/api/embed`, not the legacy `/api/embeddings`: current Ollama
        // rejects legacy input longer than the model's context with a 500,
        // while `/api/embed` truncates it by default.
        const response = await fetch(`${endpoint}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, input: promptedText(identity, text, role) }),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return parseOllamaEmbedding(await response.json());
      } catch (error) {
        // Fallback-expected, per this function's own doc comment: a
        // missing/unreachable Ollama instance, a timeout, or a network error
        // all degrade to `null` so `remember` can fall back to lexical-only —
        // but that degrade is now visible instead of silent.
        logger?.warn(
          { endpoint, model, error: error instanceof Error ? error.message : String(error) },
          "ollama embed request failed; falling back to lexical-only",
        );
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
