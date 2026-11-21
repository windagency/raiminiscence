import type { ConfidenceTier, Memory, MemoryKind, Scope, StorageLocation } from "./types.js";
import { readAllMemories } from "./storage.js";
import { computeStrength } from "./decay.js";
import { resolveScope } from "./project-root.js";
import { isActive, summaryOf } from "./memory-view.js";
import { conflictsAmong, readConflictIndex } from "./conflict-edge.js";
import { defaultWriterIdentityProvider, type WriterIdentityProvider } from "./writer-identity.js";

const OVERVIEW_KINDS: MemoryKind[] = ["semantic", "decision"];
const OVERVIEW_TOP_N = 5;

export interface OverviewParams extends StorageLocation {
  scope?: Scope;
  now?: Date;
  /** Injectable for testing; defaults to the real per-process git-identity + sessionId provider. */
  writerIdentityProvider?: WriterIdentityProvider;
}

export interface OverviewResultItem {
  id: string;
  kind: MemoryKind;
  confidence: ConfidenceTier;
  scope: Scope;
  summary: string;
  score: null;
  strength: number;
  /** Confirmed Conflicts among Overview's own returned set; never `conflictCandidateWith` (no similarity computation here). */
  conflictsWith?: string[];
}

/**
 * v13 (ADR-0020): the most recent Checkpoint, fetched by recency
 * (`createdAt`) rather than Strength — `own` is the calling writer's own
 * most recent Checkpoint, `project` is the most recent overall. Both are
 * `null` when no active Checkpoint exists yet.
 */
export interface CurrentFocus {
  own: OverviewResultItem | null;
  project: OverviewResultItem | null;
}

export interface OverviewResult {
  results: OverviewResultItem[];
  currentFocus: CurrentFocus;
}

function toOverviewItem(memory: Memory, strength: number, conflictsWith?: string[]): OverviewResultItem {
  return {
    id: memory.frontmatter.id,
    kind: memory.frontmatter.kind,
    confidence: memory.frontmatter.confidence,
    scope: memory.frontmatter.scope,
    summary: summaryOf(memory.body),
    score: null,
    strength,
    conflictsWith,
  };
}

/**
 * Whether `memory`'s recorded `writer` matches `identity` — direct field
 * equality with no special-casing for a missing `writer` (pre-v11 data, or
 * a Shared-Memory-disabled project): when neither side has a real git
 * identity, both sides are `undefined` and the comparison naturally
 * succeeds anyway, which is exactly what makes the single-writer case
 * collapse to "always own" without extra logic.
 */
function matchesWriter(memory: Memory, identity: { gitName?: string; gitEmail?: string }): boolean {
  return memory.frontmatter.writer?.gitName === identity.gitName && memory.frontmatter.writer?.gitEmail === identity.gitEmail;
}

/**
 * Query-less top standing knowledge: ranked by Strength alone (no cosine
 * similarity involved), restricted to semantic/decision Kinds since a raw
 * episodic observation is unhelpful without a topic to match against.
 * Since v13 (ADR-0020), also reports `currentFocus`: the most recent active
 * Checkpoint, additive to (never displacing) the Strength-ranked results.
 */
export function overview(params: OverviewParams): OverviewResult {
  const now = params.now ?? new Date();
  const { root: effectiveRoot } = resolveScope(params);

  const ranked = readAllMemories(effectiveRoot, OVERVIEW_KINDS)
    .filter(isActive)
    .map((memory) => ({ memory, strength: computeStrength(memory.frontmatter, now) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, OVERVIEW_TOP_N);

  const conflicts = conflictsAmong(
    readConflictIndex(effectiveRoot),
    ranked.map(({ memory }) => memory.frontmatter.id),
  );

  const checkpoints = readAllMemories(effectiveRoot, ["checkpoint"])
    .filter(isActive)
    .sort((a, b) => new Date(b.frontmatter.createdAt).getTime() - new Date(a.frontmatter.createdAt).getTime());

  const project = checkpoints[0];
  const identity = (params.writerIdentityProvider ?? defaultWriterIdentityProvider)();
  const own = checkpoints.find((memory) => matchesWriter(memory, identity));

  return {
    results: ranked.map(({ memory, strength }) => toOverviewItem(memory, strength, conflicts.get(memory.frontmatter.id))),
    currentFocus: {
      own: own ? toOverviewItem(own, computeStrength(own.frontmatter, now)) : null,
      project: project ? toOverviewItem(project, computeStrength(project.frontmatter, now)) : null,
    },
  };
}
