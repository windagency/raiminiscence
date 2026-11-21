import { OperationalError } from "./errors.js";
import type { ConfidenceTier, Memory } from "./types.js";

/** Remember-time / Promotion-time starting tiers — never a transition target from any other tier. */
const STARTING_TIERS: Set<ConfidenceTier> = new Set(["verified", "observed", "inferred"]);

/**
 * The Confidence Tier lifecycle's one legal transition graph:
 * `{verified, observed, inferred} → stale` (Invalidation, Commit
 * Invalidation, Promotion Audit) and `{verified, observed, inferred, stale}
 * → retracted` (Forget, Supersession). `stale` is the only non-terminal
 * tier with an outgoing edge; `retracted` has none — CONTEXT.md's "no
 * reversal path" rule. This is the one place that knows which transitions
 * are legal and which side-effect fields (`staleAt`/`staleReason`,
 * `retractedAt`/`retractReason`) they require, so a caller describes *why* a
 * transition should happen and this module produces the frontmatter patch,
 * rather than each call site hand-assembling it.
 */

/**
 * `{verified, observed, inferred} → stale`. A no-op against an already-`stale`
 * Memory; throws against a `retracted` one, since `retracted` has no
 * outgoing transitions at all.
 */
export function staleMemory(memory: Memory, now: Date, staleReason: string): void {
  const tier = memory.frontmatter.confidence;
  if (tier === "stale") return;
  if (!STARTING_TIERS.has(tier)) {
    throw new OperationalError(`Cannot transition a "${tier}" Memory to "stale" — only {verified, observed, inferred} may.`);
  }
  memory.frontmatter.confidence = "stale";
  memory.frontmatter.staleAt = now.toISOString();
  memory.frontmatter.staleReason = staleReason;
}

/**
 * `{verified, observed, inferred, stale} → retracted`. A no-op against an
 * already-`retracted` Memory, reported via `alreadyRetracted` rather than
 * thrown, matching `forget()`'s existing idempotent return shape.
 */
export function retractMemory(memory: Memory, now: Date, retractReason: string | null): { alreadyRetracted: boolean } {
  if (memory.frontmatter.confidence === "retracted") {
    return { alreadyRetracted: true };
  }
  memory.frontmatter.confidence = "retracted";
  memory.frontmatter.retractedAt = now.toISOString();
  memory.frontmatter.retractReason = retractReason;
  return { alreadyRetracted: false };
}
