import { z } from "zod";
import {
  ALL_CONFIDENCE_TIERS,
  ALL_CONFLICT_VERDICTS,
  ALL_CONSOLIDATE_SCOPES,
  ALL_MEMORY_KINDS,
  ALL_SCOPES,
  REMEMBER_CONFIDENCE_TIERS,
  type ConfidenceTier,
  type ConflictVerdict,
  type ConsolidateScope,
  type MemoryKind,
  type RememberConfidenceTier,
  type Scope,
} from "./core/types.js";

/**
 * Input shapes for the eight MCP tools. The MCP SDK's `registerTool` takes raw
 * Zod shapes and validates each call against them, so these are exported as
 * shapes rather than parse functions — the one place outside this file that
 * holds a Zod value is `server.ts`'s hand-off to the SDK (ADR-0027).
 */
const memoryKind = z.enum(ALL_MEMORY_KINDS as [MemoryKind, ...MemoryKind[]]);
const rememberConfidence = z.enum(REMEMBER_CONFIDENCE_TIERS as [RememberConfidenceTier, ...RememberConfidenceTier[]]);
const confidenceTier = z.enum(ALL_CONFIDENCE_TIERS as [ConfidenceTier, ...ConfidenceTier[]]);
const scope = z.enum(ALL_SCOPES as [Scope, ...Scope[]]);
const consolidateScope = z.enum(ALL_CONSOLIDATE_SCOPES as [ConsolidateScope, ...ConsolidateScope[]]);
const conflictVerdict = z.enum(ALL_CONFLICT_VERDICTS as [ConflictVerdict, ...ConflictVerdict[]]);
const inspectVerbosity = z.enum(["compact", "detailed"]);

export const rememberInput = {
  content: z.string(),
  kind: memoryKind.optional(),
  confidence: rememberConfidence.optional(),
  isError: z.boolean().optional(),
  model: z.string().optional(),
  scope: scope.optional(),
  relatedFiles: z.array(z.string()).optional(),
};

/** The query-tuning fields `recall` and `inspect`'s query mode share. */
const queryTuningInput = {
  kind: memoryKind.optional(),
  scope: scope.optional(),
  k: z.number().int().positive().optional(),
  minScore: z.number().optional(),
};

export const recallInput = {
  query: z.string(),
  ...queryTuningInput,
};

export const overviewInput = {
  scope: scope.optional(),
};

export const consolidateInput = {
  scope: consolidateScope.optional(),
  dryRun: z.boolean().optional(),
};

export const forgetInput = {
  id: z.string(),
  reason: z.string().optional(),
  scope: scope.optional(),
};

export const feedbackInput = {
  id: z.string(),
  wasHelpful: z.boolean(),
  scope: scope.optional(),
};

export const conflictInput = {
  memoryId: z.string(),
  otherMemoryId: z.string(),
  verdict: conflictVerdict,
  retractedId: z.string().optional(),
  scope: scope.optional(),
};

export const inspectInput = {
  id: z.string().optional(),
  query: z.string().optional(),
  ...queryTuningInput,
  list: z.boolean().optional(),
  filters: z
    .object({
      kind: memoryKind.optional(),
      confidenceTier: confidenceTier.optional(),
      minStrength: z.number().optional(),
      maxStrength: z.number().optional(),
      scope: scope.optional(),
      since: z.string().optional(),
      until: z.string().optional(),
    })
    .optional(),
  verbosity: inspectVerbosity.optional(),
};
