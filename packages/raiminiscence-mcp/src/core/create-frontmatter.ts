import { generateId } from "./adapters/id.js";
import { BASE_HALF_LIFE_DAYS, CURRENT_SCHEMA_VERSION } from "./types.js";
import type { ConfidenceTier, MemoryFrontmatter, MemoryKind, MemorySource, MemoryWriter, Scope } from "./types.js";

export interface CreateFrontmatterOptions {
  kind: MemoryKind;
  confidence: ConfidenceTier;
  isError?: boolean;
  createdAt: string;
  source: MemorySource;
  scope: Scope;
  originatingProject?: string | null;
  promotedFrom?: string[] | null;
  relatedFiles?: string[] | null;
  writer?: MemoryWriter;
}

/** Shared by `remember` (fresh Memories) and Promotion (derived Semantic Memories). */
export function createFrontmatter(options: CreateFrontmatterOptions): MemoryFrontmatter {
  return {
    id: generateId(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: options.kind,
    confidence: options.confidence,
    isError: options.isError ?? false,
    createdAt: options.createdAt,
    lastRecalledAt: null,
    recallCount: 0,
    consolidationSurvivalCount: 0,
    baseHalfLifeDays: BASE_HALF_LIFE_DAYS[options.kind],
    retractedAt: null,
    retractReason: null,
    source: options.source,
    scope: options.scope,
    originatingProject: options.originatingProject ?? null,
    promotedFrom: options.promotedFrom ?? null,
    relatedFiles: options.relatedFiles ?? null,
    staleAt: null,
    staleReason: null,
    positiveFeedbackCount: 0,
    negativeFeedbackCount: 0,
    ...(options.writer && { writer: options.writer }),
  };
}
