import { EXCLUDED_CONFIDENCE_TIERS } from "./decay.js";
import type { Memory } from "./types.js";

export function summaryOf(body: string): string {
  return body.split("\n", 1)[0] ?? "";
}

/** Shared by recall/overview/consolidate: excludes stale/retracted Confidence Tiers. */
export function isActive(memory: Memory): boolean {
  return !EXCLUDED_CONFIDENCE_TIERS.has(memory.frontmatter.confidence);
}

/**
 * v7 (ADR-0012): a Memory whose recorded negative Outcome Feedback
 * outweighs its positive — a documented history of being unhelpful.
 * Missing counts default to 0, matching decay.ts's own `?? 0` convention.
 */
export function isNetNegativeFeedback(memory: Memory): boolean {
  return (memory.frontmatter.negativeFeedbackCount ?? 0) > (memory.frontmatter.positiveFeedbackCount ?? 0);
}
