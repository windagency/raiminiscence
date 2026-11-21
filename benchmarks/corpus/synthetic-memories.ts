/**
 * Synthetic, procedurally-generated memories for the latency/store-size
 * benchmark (extended-compare.ts). Unlike corpus/memories.json (hand-authored,
 * ground-truth-labeled, used for Recall@k/Precision@k scoring), these have no
 * relevance labels — the latency pass only measures wall-clock time and
 * output size as store size grows, not retrieval quality, so no ground truth
 * is needed. Shared by both runners so store sizes are populated identically
 * on both sides.
 */
export type SyntheticMemoryKind = "episodic" | "semantic" | "decision";

export interface SyntheticMemory {
  id: string;
  kind: SyntheticMemoryKind;
  content: string;
}

const TOPICS = [
  "authentication",
  "caching",
  "database indexing",
  "error handling",
  "logging",
  "rate limiting",
  "the CI pipeline",
  "deployment",
  "testing strategy",
  "API versioning",
  "dependency management",
  "the code review process",
  "monitoring",
  "feature flags",
  "configuration management",
  "the build system",
  "session handling",
  "input validation",
  "retry logic",
  "background job processing",
];

const TEMPLATES: Array<(topic: string, i: number) => { kind: SyntheticMemoryKind; content: string }> = [
  (topic, i) => ({
    kind: "decision",
    content: `Chose approach #${i} for ${topic} after comparing alternatives; picked it for long-term maintainability over short-term speed.`,
  }),
  (topic, i) => ({
    kind: "semantic",
    content: `The ${topic} module (variant ${i}) is implemented with a layered design that keeps I/O concerns separate from business logic.`,
  }),
  (topic, i) => ({
    kind: "episodic",
    content: `Debugged an issue in ${topic} (case ${i}) caused by a stale cached value; fixed by invalidating the cache entry on write.`,
  }),
];

/** Deterministic: same `count` always yields the same memories, for reproducible re-runs. */
export function generateSyntheticMemories(count: number): SyntheticMemory[] {
  const memories: SyntheticMemory[] = [];
  for (let i = 0; i < count; i++) {
    const topic = TOPICS[i % TOPICS.length]!;
    const template = TEMPLATES[i % TEMPLATES.length]!;
    const { kind, content } = template(topic, i);
    memories.push({ id: `synth-${i}`, kind, content });
  }
  return memories;
}
