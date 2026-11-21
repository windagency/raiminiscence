import { z } from "zod";
import {
  ALL_CONFIDENCE_TIERS,
  ALL_MEMORY_KINDS,
  ALL_SCOPES,
  type ConfidenceTier,
  type MemoryFrontmatter,
  type MemoryKind,
  type Scope,
} from "./types.js";

const nullableString = z.string().nullable();

/**
 * A Memory file's frontmatter, as read from disk. Only this package's tools
 * write Memory files, and they are never hand-edited (ADR-0031), but they are
 * still untrusted: Shared Memory merges in files other writers produced, and
 * nothing stops a file being altered outside the server. Enforced strictly,
 * with no coercion. Schema bumps are migration-free, so every field added
 * after v1 is optional here: v2's `relatedFiles`, `staleAt`, `staleReason`
 * and feedback counts, and v11's `writer`. `.passthrough()` keeps fields
 * this version doesn't know about, so a newer writer's frontmatter survives
 * a read/write round trip through an older one.
 */
const memoryFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.number(),
    kind: z.enum(ALL_MEMORY_KINDS as [MemoryKind, ...MemoryKind[]]),
    confidence: z.enum(ALL_CONFIDENCE_TIERS as [ConfidenceTier, ...ConfidenceTier[]]),
    isError: z.boolean(),
    createdAt: z.string(),
    lastRecalledAt: nullableString,
    recallCount: z.number(),
    consolidationSurvivalCount: z.number(),
    baseHalfLifeDays: z.number(),
    retractedAt: nullableString,
    retractReason: nullableString,
    source: z.object({ client: z.string(), model: z.string().optional() }).passthrough(),
    scope: z.enum(ALL_SCOPES as [Scope, ...Scope[]]),
    originatingProject: nullableString,
    promotedFrom: z.array(z.string()).nullable(),
    relatedFiles: z.array(z.string()).nullable().optional(),
    staleAt: nullableString.optional(),
    staleReason: nullableString.optional(),
    positiveFeedbackCount: z.number().optional(),
    negativeFeedbackCount: z.number().optional(),
    writer: z.object({ gitName: z.string().optional(), gitEmail: z.string().optional(), sessionId: z.string() }).passthrough().optional(),
  })
  .passthrough();

/** The validated frontmatter, or `null` when it doesn't match a Memory's shape. */
export function parseMemoryFrontmatter(data: unknown): MemoryFrontmatter | null {
  const parsed = memoryFrontmatterSchema.safeParse(data);
  // The v2 fields are optional on disk but typed as required on MemoryFrontmatter, so pre-v2
  // files reach callers with them undefined, exactly as before this schema existed.
  return parsed.success ? (parsed.data as MemoryFrontmatter) : null;
}
