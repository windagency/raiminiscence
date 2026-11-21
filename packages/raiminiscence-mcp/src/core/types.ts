export type MemoryKind = "episodic" | "semantic" | "decision" | "checkpoint";

export const ALL_MEMORY_KINDS: MemoryKind[] = ["episodic", "semantic", "decision", "checkpoint"];

export type ConfidenceTier = "verified" | "observed" | "inferred" | "stale" | "retracted";

export const ALL_CONFIDENCE_TIERS: ConfidenceTier[] = ["verified", "observed", "inferred", "stale", "retracted"];

/** `remember`'s narrowed input: `stale`/`retracted` are only reachable via Invalidation/Forget. */
export type RememberConfidenceTier = Extract<ConfidenceTier, "verified" | "observed" | "inferred">;

export const REMEMBER_CONFIDENCE_TIERS: RememberConfidenceTier[] = ["verified", "observed", "inferred"];

export type Scope = "project" | "global";

export const ALL_SCOPES: Scope[] = ["project", "global"];

/** `consolidate`'s widened scope input: `"both"` is only ever meaningful there, never a Memory's own recorded Scope. */
export type ConsolidateScope = Scope | "both";

export const ALL_CONSOLIDATE_SCOPES: ConsolidateScope[] = ["project", "global", "both"];

/** A recorded Conflict Edge verdict for a pair of Memories: confirmed, resolved, or dismissed. */
export type ConflictVerdict = "contradicts" | "supersedes" | "no-conflict";

export const ALL_CONFLICT_VERDICTS: ConflictVerdict[] = ["contradicts", "supersedes", "no-conflict"];

/** Where a Memory store lives on disk: the data clump every scope-aware tool resolves via `effectiveStorageRoot`. */
export interface StorageLocation {
  storageRoot: string;
  globalStorageRoot?: string;
}

export const BASE_HALF_LIFE_DAYS: Record<MemoryKind, number> = {
  episodic: 7,
  semantic: 30,
  decision: 21,
  checkpoint: 3,
};

export interface MemorySource {
  client: string;
  model?: string;
}

/** v11 (ADR-0018): who wrote a Memory, once Shared Memory can have more than one writer touching a store. */
export interface MemoryWriter {
  gitName?: string;
  gitEmail?: string;
  sessionId: string;
}

export interface MemoryFrontmatter {
  id: string;
  schemaVersion: number;
  kind: MemoryKind;
  confidence: ConfidenceTier;
  isError: boolean;
  createdAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
  consolidationSurvivalCount: number;
  baseHalfLifeDays: number;
  retractedAt: string | null;
  retractReason: string | null;
  source: MemorySource;
  scope: Scope;
  originatingProject: string | null;
  promotedFrom: string[] | null;
  relatedFiles: string[] | null;
  staleAt: string | null;
  staleReason: string | null;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  /** v11 (ADR-0018): absent on any Memory written before Shared Memory existed — schemaVersion bumps are migration-free. */
  writer?: MemoryWriter;
}

export interface Memory {
  frontmatter: MemoryFrontmatter;
  body: string;
}

export const CURRENT_SCHEMA_VERSION = 3;
