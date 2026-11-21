import { z } from "zod";
import { ALL_CONFIDENCE_TIERS, ALL_MEMORY_KINDS, ALL_SCOPES, type ConfidenceTier, type MemoryKind, type Scope } from "./types.js";
import type { RecallResultItem } from "./recall.js";

/** ADR-0039: the one protocol version both sides must share. */
export const RECALL_SOCKET_PROTOCOL = 1;

const identitySchema = z.object({ provider: z.string(), model: z.string(), prompt: z.string().optional() });

/** ADR-0039: a served-recall request, validated where it crosses the local socket. */
const recallRequestSchema = z.object({
  v: z.number(),
  package: z.string(),
  storageRoot: z.string(),
  query: z.string(),
  k: z.number().int().positive(),
});

const recallResultItemSchema = z.object({
  id: z.string(),
  kind: z.enum(ALL_MEMORY_KINDS as [MemoryKind, ...MemoryKind[]]),
  confidence: z.enum(ALL_CONFIDENCE_TIERS as [ConfidenceTier, ...ConfidenceTier[]]),
  scope: z.enum(ALL_SCOPES as [Scope, ...Scope[]]),
  source: z.object({ client: z.string(), model: z.string().optional() }),
  summary: z.string(),
  detail: z.string(),
  score: z.number(),
  strength: z.number(),
  surfacedVia: z.enum(["match", "connection-1", "connection-2", "connection-3"]),
  conflictCandidateWith: z.array(z.string()).optional(),
  conflictsWith: z.array(z.string()).optional(),
});

/** ADR-0039: a served-recall reply. `results` is `null` when the server refuses the request. */
const recallReplySchema = z.object({
  v: z.number(),
  package: z.string(),
  identity: identitySchema,
  results: z.array(recallResultItemSchema).nullable(),
});

export type RecallSocketRequest = z.infer<typeof recallRequestSchema>;

export interface RecallSocketReply {
  v: number;
  package: string;
  identity: { provider: string; model: string; prompt?: string };
  results: RecallResultItem[] | null;
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** A request line's fields, or `null` when the line isn't the expected shape. */
export function parseRecallSocketRequest(line: string): RecallSocketRequest | null {
  const parsed = recallRequestSchema.safeParse(parseLine(line));
  return parsed.success ? parsed.data : null;
}

/** A reply line's fields, or `null` when there is no line or it isn't the expected shape. */
export function parseRecallSocketReply(line: string | null): RecallSocketReply | null {
  if (line === null) return null;
  const parsed = recallReplySchema.safeParse(parseLine(line));
  return parsed.success ? parsed.data : null;
}
