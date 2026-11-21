import type { ConfidenceTier, Memory, MemoryKind, MemoryWriter, RememberConfidenceTier, Scope, StorageLocation } from "./types.js";
import { REMEMBER_CONFIDENCE_TIERS } from "./types.js";
import { writeMemory } from "./storage.js";
import { redactSecrets } from "./redaction.js";
import { resolveOriginatingProject, resolveScope } from "./project-root.js";
import { createFrontmatter } from "./create-frontmatter.js";
import type { EmbeddingProvider, EmbeddingProviderIdentity } from "./embeddings/provider.js";
import { defaultProvider } from "./embeddings/default-provider.js";
import { upsertVector } from "./embeddings/packed-index.js";
import { triggerOpportunisticConsolidation, type OpportunisticConsolidationOptIn } from "./opportunistic-consolidation.js";
import { defaultAsyncWriterIdentityProvider, defaultRefreshingWriterIdentity, type AsyncWriterIdentityProvider } from "./writer-identity.js";
import { trackPendingEmbed } from "./pending-embeds.js";
import { appendCachedEmbeddings, appendCachedRecords, snapshotCachedEmbeddings, snapshotCachedRecords } from "./recall-cache.js";
import { OperationalError } from "./errors.js";
import type { ServerLogger } from "#src/adapters/logger.js";

const REMEMBER_CONFIDENCE_TIER_SET: Set<RememberConfidenceTier> = new Set(REMEMBER_CONFIDENCE_TIERS);

export interface RememberParams extends StorageLocation, OpportunisticConsolidationOptIn {
  content: string;
  kind?: MemoryKind;
  confidence?: RememberConfidenceTier;
  isError?: boolean;
  model?: string;
  client: string;
  scope?: Scope;
  relatedFiles?: string[];
  embeddingProvider?: EmbeddingProvider;
  now?: Date;
  /** Injectable for testing; defaults to the real per-process git-identity + sessionId provider. */
  writerIdentityProvider?: AsyncWriterIdentityProvider;
  /**
   * ADR-0041: answer once the Memory is on disk and write its vector after, in
   * this process. The MCP server sets it; a short-lived caller must not, or it
   * may exit before the vector is written.
   */
  embedInBackground?: boolean;
  /** Surfaces a detached opportunistic-consolidation-pass failure; unset in tests that don't care. */
  logger?: ServerLogger;
}

export interface RememberResult {
  id: string;
  kind: MemoryKind;
  confidence: ConfidenceTier;
  createdAt: string;
  redacted: boolean;
  /** `"pending"` when `embedInBackground` answered before the vector was written (ADR-0041). */
  embedded: boolean | "pending";
  /** This call scheduled a pass — not a guarantee this call's Memory is covered by the very next one (a nearby call may already have triggered and settled one). */
  consolidationTriggered: boolean;
}

function validatedConfidence(confidence: RememberParams["confidence"]): RememberConfidenceTier {
  const tier = confidence ?? "observed";
  if (!REMEMBER_CONFIDENCE_TIER_SET.has(tier)) {
    throw new OperationalError(`"${tier}" is not a valid confidence for remember — stale/retracted are only reached via Invalidation/forget.`);
  }
  return tier;
}

function buildMemory(
  params: RememberParams,
  fields: { confidence: RememberConfidenceTier; createdAt: string; content: string; scope: Scope; writer: MemoryWriter },
): Memory {
  return {
    frontmatter: createFrontmatter({
      kind: params.kind ?? "episodic",
      confidence: fields.confidence,
      isError: params.isError,
      createdAt: fields.createdAt,
      source: params.model ? { client: params.client, model: params.model } : { client: params.client },
      scope: fields.scope,
      originatingProject: fields.scope === "global" ? resolveOriginatingProject(params.storageRoot) : null,
      relatedFiles: params.relatedFiles ?? null,
      writer: fields.writer,
    }),
    body: fields.content,
  };
}

export async function remember(params: RememberParams): Promise<RememberResult> {
  const confidence = validatedConfidence(params.confidence);
  const now = params.now ?? new Date();
  const createdAt = now.toISOString();
  const { content, redacted } = redactSecrets(params.content);
  const { scope, root: effectiveRoot } = resolveScope(params);
  const provider = params.embeddingProvider ?? defaultProvider();

  if (params.embedInBackground) {
    const writer = await (params.writerIdentityProvider ?? defaultRefreshingWriterIdentity)();
    const memory = buildMemory(params, { confidence, createdAt, content, scope, writer });
    writeMemoryAndRecord(effectiveRoot, memory);
    trackPendingEmbed(effectiveRoot, embedAndWriteVector(effectiveRoot, memory, provider, params.logger));
    return result(
      memory,
      redacted,
      "pending",
      triggerOpportunisticConsolidation(scope, params, now, params.triggerConsolidation ?? true, provider, params.logger),
    );
  }

  // The writer identity's git reads run while the embed does, instead of before it.
  const [vector, writer] = await Promise.all([
    provider.embed(content, "document"),
    (params.writerIdentityProvider ?? defaultAsyncWriterIdentityProvider)(),
  ]);
  const memory = buildMemory(params, { confidence, createdAt, content, scope, writer });
  writeMemoryAndRecord(effectiveRoot, memory);
  if (vector !== null) writeVector(effectiveRoot, memory, vector, provider.identity);
  return result(
    memory,
    redacted,
    vector !== null,
    triggerOpportunisticConsolidation(scope, params, now, params.triggerConsolidation ?? true, provider, params.logger),
  );
}

function writeMemoryAndRecord(effectiveRoot: string, memory: Memory): void {
  // v14 (ADR-0021): the snapshot is fetched *before* the write below, so the
  // patched value written back afterward can't double up on top of a
  // rebuild the write's own safety-net invalidation would otherwise trigger
  // (see `writeCachedRecords`'s doc comment).
  const recordsBeforeWrite = snapshotCachedRecords(effectiveRoot);
  writeMemory(effectiveRoot, memory);
  // ADR-0036: one log line per slot, not a rewrite of every Memory and vector.
  appendCachedRecords(effectiveRoot, recordsBeforeWrite, { upsertMemories: [memory] });
}

/** Synchronous from snapshot to append, so no other write can land between them. */
function writeVector(effectiveRoot: string, memory: Memory, vector: number[], identity: EmbeddingProviderIdentity): void {
  const embeddingsBeforeWrite = snapshotCachedEmbeddings(effectiveRoot);
  upsertVector(effectiveRoot, memory.frontmatter.id, vector, identity);
  appendCachedEmbeddings(effectiveRoot, embeddingsBeforeWrite, {
    upsert: { [memory.frontmatter.id]: { vector, identity, updatedAt: memory.frontmatter.createdAt } },
  });
}

/** ADR-0041: never rejects. A Memory whose vector doesn't land stays lexical until Re-embedding heals it. */
async function embedAndWriteVector(
  effectiveRoot: string,
  memory: Memory,
  provider: EmbeddingProvider,
  logger: ServerLogger | undefined,
): Promise<void> {
  // A provider's embed runs synchronously up to its first await, tokenizing on this thread; starting it
  // on the next turn of the event loop lets the answer go out first.
  await new Promise((resolve) => setImmediate(resolve));
  try {
    const vector = await provider.embed(memory.body, "document");
    if (vector !== null) {
      writeVector(effectiveRoot, memory, vector, provider.identity);
      return;
    }
    logger?.warn({ id: memory.frontmatter.id }, "background embed failed; the Memory stays lexical until Consolidation re-embeds it");
  } catch (error) {
    logger?.warn(
      { id: memory.frontmatter.id, err: error },
      "background vector write failed; the Memory stays lexical until Consolidation re-embeds it",
    );
  }
}

function result(memory: Memory, redacted: boolean, embedded: boolean | "pending", consolidationTriggered: boolean): RememberResult {
  return {
    id: memory.frontmatter.id,
    kind: memory.frontmatter.kind,
    confidence: memory.frontmatter.confidence,
    createdAt: memory.frontmatter.createdAt,
    redacted,
    embedded,
    consolidationTriggered,
  };
}
