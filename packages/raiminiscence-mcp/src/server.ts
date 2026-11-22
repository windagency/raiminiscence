#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { connectedClientName, createMcpServer, serveOverStdio, type McpServer } from "./adapters/mcp-server.js";
import { generateId } from "./core/adapters/id.js";
import { resolveEmbeddingProviderConfig, resolveStorageRoot } from "./core/project-root.js";
import { browseMemories, conflict, consolidate, feedback, forget, inspectMemory, inspectQuery, overview, recall, remember } from "./core/engine.js";
import type { BrowseMemoriesFilters, InspectMemoryResult, InspectQueryResult } from "./core/engine.js";
import { createEmbeddingProviderFromConfig, serveWarmModel } from "./core/embeddings/default-provider.js";
import { serveRecall } from "./core/served-recall.js";
import type { EmbeddingProvider } from "./core/embeddings/provider.js";
import { OperationalError } from "./core/errors.js";
import { createLogger, type ServerLogger } from "./adapters/logger.js";
import { createTelemetry, type ServerTelemetry } from "./adapters/telemetry.js";
import type { MemoryKind, Scope } from "./core/types.js";
import { settlePendingEmbeds } from "./core/pending-embeds.js";
import { PACKAGE_VERSION } from "./core/package-version.js";
import { defaultRefreshingWriterIdentity } from "./core/writer-identity.js";
import {
  conflictInput,
  consolidateInput,
  feedbackInput,
  forgetInput,
  inspectInput,
  overviewInput,
  recallInput,
  rememberInput,
} from "./tool-input-schema.js";

const CLIENT_NAME_FALLBACK = "unknown-client";
/** How long a server whose client closed stdin waits for pending vectors before it exits (ADR-0041). */
const PENDING_EMBEDS_EXIT_MS = 5_000;

function toJsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

/**
 * Every tool call passes through here: an `info` "started" line and either
 * an `info` "finished" line (success) or the operational/unexpected split
 * (failure) below, all three sharing `sessionId` and a per-call `callId` so
 * concurrent calls in the same log don't get their lines mixed together.
 * Both "started" and "finished" log at the same (`info`) level — not
 * "started" at `debug` — so a hung call (a start with no matching end) is
 * visible in the logs at the server's default level, without requiring an
 * operator to already know to turn on `debug` first. An `OperationalError`
 * (a deliberate, expected domain failure) returns its message to the client
 * verbatim; anything else is logged in full (message, stack, cause) and
 * masked behind a generic message plus the `callId`, so a report back to a
 * maintainer can be tied to the exact log line without leaking internals to
 * the calling agent. Tool-execution errors surface as `isError: true`, never
 * a thrown JSON-RPC error. Each call is also one telemetry span, ended with
 * the same outcome, and every log line carries its `traceId` when an SDK is
 * recording, so a log search and a trace view find each other.
 */
function makeHandle(logger: ServerLogger, telemetry: ServerTelemetry, sessionId: string) {
  return async function handle(tool: string, run: () => unknown | Promise<unknown>) {
    const callId = generateId();
    const start = Date.now();
    const span = telemetry.startToolCall(tool, { sessionId, callId });
    const ids = { sessionId, callId, tool, ...(span.traceId && { traceId: span.traceId }) };
    logger.info(ids, "tool call started");
    try {
      const result = await run();
      const durationMs = Date.now() - start;
      span.end("success", durationMs);
      logger.info({ ...ids, durationMs }, "tool call finished");
      return toJsonResult(result);
    } catch (error) {
      const durationMs = Date.now() - start;
      if (error instanceof OperationalError) {
        span.end("operational-error", durationMs, error);
        logger.warn({ ...ids, durationMs, error: error.message }, "tool call failed (operational)");
        return { isError: true as const, content: [{ type: "text" as const, text: error.message }] };
      }
      span.end("unexpected-error", durationMs, error);
      logger.error(
        {
          ...ids,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          cause: error instanceof Error ? error.cause : undefined,
        },
        "tool call failed (unexpected)",
      );
      return { isError: true as const, content: [{ type: "text" as const, text: `Internal error (${callId}). See server logs.` }] };
    }
  };
}

const DEFAULT_INSPECT_VERBOSITY = "compact";

interface InspectToolInput {
  id?: string;
  query?: string;
  kind?: MemoryKind;
  scope?: Scope;
  k?: number;
  minScore?: number;
  list?: boolean;
  filters?: BrowseMemoriesFilters;
  verbosity?: "compact" | "detailed";
}

/** v15 (ADR-0022): `browseMemories`'s compact view — id/kind/Strength/Confidence Tier only; detailed returns everything `inspectMemory` would. */
function shapeBrowseResult(result: InspectMemoryResult, verbosity: "compact" | "detailed") {
  if (verbosity === "detailed") return result;
  return { id: result.id, kind: result.kind, strength: result.strength, confidence: result.confidence };
}

/** v15 (ADR-0022): `inspectQuery`'s compact view collapses near-misses to a count, matching the prototype's "N near-misses hidden" behaviour. */
function shapeInspectQueryResult(result: InspectQueryResult, verbosity: "compact" | "detailed") {
  if (verbosity === "detailed") return result;
  return {
    results: result.results,
    usedFallback: result.usedFallback,
    nearMissesHidden: result.nearMisses.length,
    ...(result.nearMisses.length > 0 && { hint: `${result.nearMisses.length} near-misses hidden — rerun with verbosity: "detailed" to show them` }),
  };
}

/**
 * `inspect`'s three modes — explain a Memory by id, explain how a query
 * would score right now, or browse/list Memories by filter — dispatched off
 * which one of `id`/`query`/`list` was actually set. Exactly one must be;
 * both and neither are rejected here rather than silently prioritised.
 */
async function runInspect(input: InspectToolInput, deps: { storageRoot: string; embeddingProvider: EmbeddingProvider }) {
  const modesSet = [input.id !== undefined, input.query !== undefined, input.list === true].filter(Boolean).length;
  if (modesSet !== 1) {
    throw new OperationalError('inspect requires exactly one of "id", "query", or "list: true"');
  }
  const verbosity = input.verbosity ?? DEFAULT_INSPECT_VERBOSITY;

  if (input.id !== undefined) {
    return inspectMemory({ id: input.id, scope: input.scope, storageRoot: deps.storageRoot });
  }

  if (input.query !== undefined) {
    const result = await inspectQuery({
      query: input.query,
      kind: input.kind,
      scope: input.scope,
      k: input.k,
      minScore: input.minScore,
      storageRoot: deps.storageRoot,
      embeddingProvider: deps.embeddingProvider,
    });
    return shapeInspectQueryResult(result, verbosity);
  }

  const results = browseMemories({ storageRoot: deps.storageRoot, filters: input.filters });
  return results.map((result) => shapeBrowseResult(result, verbosity));
}

export interface CreateServerOptions {
  /** Overrides the real default provider — for tests, so no call depends on a real Ollama server being reachable. */
  embeddingProvider?: EmbeddingProvider;
  /** Overrides the real stderr-only pino logger — for tests, to assert on emitted log lines without touching real stderr. */
  logger?: ServerLogger;
  /** Overrides the real OpenTelemetry adapter — for tests, to assert on spans without registering an SDK. */
  telemetry?: ServerTelemetry;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = createMcpServer("raiminiscence-mcp", PACKAGE_VERSION);

  const clientOf = () => connectedClientName(server) ?? CLIENT_NAME_FALLBACK;

  const sessionId = generateId();
  const logger = options.logger ?? createLogger();
  const handle = makeHandle(logger, options.telemetry ?? createTelemetry(), sessionId);
  const embeddingProvider = options.embeddingProvider ?? createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig(), logger);

  server.registerTool(
    "remember",
    {
      description: "Record an observation, pattern, or decision as a persistent Memory.",
      inputSchema: rememberInput,
    },
    ({ content, kind, confidence, isError, model, scope, relatedFiles }) =>
      handle("remember", () =>
        remember({
          content,
          kind,
          confidence,
          isError,
          model,
          scope,
          relatedFiles,
          client: clientOf(),
          storageRoot: resolveStorageRoot(),
          embeddingProvider,
          logger,
          // ADR-0041: answer once the Memory is on disk; its vector follows in this process.
          embedInBackground: true,
        }),
      ),
  );

  server.registerTool(
    "recall",
    {
      description: "Recall Memories relevant to a query.",
      inputSchema: recallInput,
    },
    ({ query, kind, scope, k, minScore }) =>
      handle("recall", () =>
        recall({
          query,
          kind,
          scope,
          k,
          minScore,
          storageRoot: resolveStorageRoot(),
          embeddingProvider,
          logger,
        }),
      ),
  );

  server.registerTool(
    "overview",
    {
      description: "Query-less primer: the top standing semantic/decision knowledge for a project, by Strength alone.",
      inputSchema: overviewInput,
    },
    ({ scope }) => handle("overview", () => overview({ scope, storageRoot: resolveStorageRoot() })),
  );

  server.registerTool(
    "consolidate",
    {
      description: "Cluster related episodic memories into a promoted semantic pattern and prune decayed memories.",
      inputSchema: consolidateInput,
    },
    ({ scope, dryRun }) => handle("consolidate", () => consolidate({ scope, dryRun, storageRoot: resolveStorageRoot(), embeddingProvider, logger })),
  );

  server.registerTool(
    "forget",
    {
      description: "Retract a Memory, excluding it from future recall/overview immediately.",
      inputSchema: forgetInput,
    },
    ({ id, reason, scope }) => handle("forget", () => forget({ id, reason, scope, storageRoot: resolveStorageRoot() })),
  );

  server.registerTool(
    "feedback",
    {
      description:
        "Report whether a previously recalled Memory actually helped, reinforcing or fading it accordingly. Never changes Confidence Tier.",
      inputSchema: feedbackInput,
    },
    ({ id, wasHelpful, scope }) => handle("feedback", () => feedback({ id, wasHelpful, scope, storageRoot: resolveStorageRoot() })),
  );

  server.registerTool(
    "conflict",
    {
      description:
        'Record a verdict for a pair of Memories that plausibly disagree: "contradicts" (both stand, flagged to each other), "supersedes" (retractedId is retracted), or "no-conflict" (dismissed).',
      inputSchema: conflictInput,
    },
    ({ memoryId, otherMemoryId, verdict, retractedId, scope }) =>
      handle("conflict", () => conflict({ memoryId, otherMemoryId, verdict, retractedId, scope, storageRoot: resolveStorageRoot() })),
  );

  server.registerTool(
    "inspect",
    {
      description:
        "Read-only diagnostic, never a Recall: explain one Memory by id, explain how a query would score right now, or browse/list Memories by filter. Never mutates recallCount or lastRecalledAt.",
      inputSchema: inspectInput,
    },
    (input) => handle("inspect", () => runInspect(input, { storageRoot: resolveStorageRoot(), embeddingProvider })),
  );

  return server;
}

async function main() {
  const logger = createLogger();
  const embeddingProvider = createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig(), logger);
  // ADR-0038: keep the Embedded model warm for the per-turn hook and other short-lived callers.
  const warm = await serveWarmModel(embeddingProvider);
  if (warm) logger.info({ socketPath: warm.socketPath }, "serving warm embeddings");
  // ADR-0039: answer the per-turn hook's whole recall, so it skips the engine import and the cache parse.
  const served = await serveRecall({ storageRoot: resolveStorageRoot(), embeddingProvider, logger });
  if (served) logger.info({ socketPath: served.socketPath }, "serving recall");
  // ADR-0041: the first background write uses an identity already read.
  void defaultRefreshingWriterIdentity();
  // ADR-0041: a closing client doesn't cost the vectors still being written.
  process.stdin.once("close", () => void settlePendingEmbeds(PENDING_EMBEDS_EXIT_MS));
  await serveOverStdio(createServer({ logger, embeddingProvider }));
}

// Real paths: npx and MCP client configs start this file through node_modules/.bin, a symlink to it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
