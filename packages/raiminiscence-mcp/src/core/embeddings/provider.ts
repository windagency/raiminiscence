/** Which Provider + model produced a vector — recorded alongside every stored embedding (v17). */
export interface EmbeddingProviderIdentity {
  provider: string;
  model: string;
  /** ADR-0042: the input template the text went through, `"nomic-task-prefix"` for a nomic model; absent for bare text. */
  prompt?: string;
}

/** ADR-0042: what a text is embedded as. A nomic model prefixes each role differently. */
export type EmbedRole = "query" | "document";

export const NOMIC_TASK_PREFIX = "nomic-task-prefix";
const NOMIC_PREFIXES: Record<EmbedRole, string> = { query: "search_query: ", document: "search_document: " };

/** ADR-0042: the identity of `model`'s vectors, which records nomic's task prefixes when the model is nomic's. */
export function identityFor(provider: string, model: string): EmbeddingProviderIdentity {
  return model.includes("nomic-embed-text") ? { provider, model, prompt: NOMIC_TASK_PREFIX } : { provider, model };
}

/** ADR-0042: `text` as `identity`'s model should see it for `role`. */
export function promptedText(identity: EmbeddingProviderIdentity, text: string, role: EmbedRole): string {
  return identity.prompt === NOMIC_TASK_PREFIX ? NOMIC_PREFIXES[role] + text : text;
}

/** Whether two identities name the same vector space exactly; sockets use it, where no identity is unspecified. */
export function sameIdentity(a: EmbeddingProviderIdentity, b: EmbeddingProviderIdentity): boolean {
  return a.provider === b.provider && a.model === b.model && a.prompt === b.prompt;
}

/** A string that differs whenever `sameIdentity` would say no, for hashing into a socket path. */
export function identityKey(identity: EmbeddingProviderIdentity): string {
  return [identity.provider, identity.model, ...(identity.prompt === undefined ? [] : [identity.prompt])].join("\0");
}

/**
 * `upsertVector`'s fallback identity for a vector inserted directly,
 * bypassing `remember()` (as many pre-v17 tests do) — never produced by a
 * real `EmbeddingProvider`. Always compatible with any other identity so
 * those fixtures keep comparing exactly as they did before identity
 * tracking existed.
 */
export const UNSPECIFIED_IDENTITY: EmbeddingProviderIdentity = { provider: "unspecified", model: "unspecified" };

/** Whether two stored/query vectors came from a provider+model close enough to compare by cosine similarity. */
export function identitiesCompatible(a: EmbeddingProviderIdentity, b: EmbeddingProviderIdentity): boolean {
  if (a.provider === "unspecified" || b.provider === "unspecified") return true;
  return sameIdentity(a, b);
}

/**
 * Pluggable embedding provider. `embed` returns `null` (never throws) when
 * the provider is unreachable or misconfigured, so callers can treat a
 * failed embed as a normal, expected outcome rather than an error.
 * `identity` is synchronous and always set — reading it never loads a model
 * or otherwise triggers the real work `embed` defers until first use.
 */
export interface EmbeddingProvider {
  readonly identity: EmbeddingProviderIdentity;
  embed(text: string, role: EmbedRole): Promise<number[] | null>;
}
