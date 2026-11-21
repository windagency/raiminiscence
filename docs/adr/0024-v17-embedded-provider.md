# v17 introduces the Embedded Provider as the new default Embedding Provider; Ollama remains an opt-in alternate

[Back to 0028-embedded-provider-runtime-is-a-regular-dependency.md](0028-embedded-provider-runtime-is-a-regular-dependency.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to lld.md](../architecture/lld.md) • [Back to user-guide.md](../user-guide.md)

Through v16, rAIminiscence's only Embedding Provider was the Ollama
Provider: every `remember`/`recall` call required a separately-installed,
separately-running Ollama server on `localhost:11434` with
`nomic-embed-text` pulled. A user who hadn't done that setup didn't get an
error — they silently got degraded, lexical-only Recall, indistinguishable
from "it's working" until semantic matches were visibly missing. v17's
direction was locked via an in-chat grilling session (2026-09-19) that
concluded rAIminiscence should work out of the box, with no external
service to install, run, or forget to start.

## Decision

1. **Runtime: `@huggingface/transformers`, running the ONNX port of
   `nomic-embed-text-v1`.** Considered against `node-llama-cpp` (closer
   weight lineage to Ollama's own GGUF model, but a second native-binding
   surface, a source-build fallback risk on uncommon platforms, and no
   built-in weight-download/caching), `onnxruntime-node` used directly (no
   meaningful advantage over `transformers.js`, which already wraps it —
   using it directly would just push tokenizer/pooling/download logic back
   onto this project's own code), and `fastembed-js` (rejected as
   archived/unmaintained). `@huggingface/transformers` is declared as an
   optional peer dependency (`peerDependenciesMeta.optional: true`) of
   `raiminiscence-mcp`, imported via a dynamic `import()` only at the
   point the Embedded Provider is actually constructed
   (`core/embeddings/embedded.ts`) — never a hard, always-installed
   dependency, so choosing Ollama instead costs nothing in install
   footprint. Model weights are never bundled in the npm package; they
   download to the runtime's own on-disk cache on first use.
2. **The Embedded Provider becomes the new default construction in
   `default-provider.ts`.** The Ollama Provider remains fully supported,
   selected by explicit configuration — nobody currently depending on
   Ollama is forced onto a different model.
3. **Config compatibility shape** (`core/project-root.ts`'s
   `resolveEmbeddingProviderConfig()`): `.raiminiscence.config.json`'s
   `embeddingProvider` block gained an explicit
   `provider: "ollama" | "embedded"` discriminant. Resolution rules: an
   absent `embeddingProvider` block resolves to `"embedded"` (the new
   default, for a project with no config at all); a block that sets
   `endpoint`/`model` but omits `provider` resolves to `"ollama"` (an
   existing user's configuration keeps meaning what it always meant); an
   explicit `provider` field always wins. This is the only way v17 avoids
   silently switching an existing installation's runtime out from under
   it.
4. **Mismatch handling + Re-embedding** (`core/embeddings/provider.ts`,
   `core/embeddings/packed-index.ts`, `core/reembedding.ts`): a different
   model produces a different, incompatible vector space, so each stored
   embedding now records the identity (provider name + model name) of
   whatever produced it, persisted alongside the vector
   (`EmbeddingProviderIdentity`, `PackedEmbeddingIndex`). At
   Clustering/Recall/Overview scoring time, a stored embedding whose
   identity doesn't match the project's currently-configured default is
   treated exactly like a failed `embed()` call — absent, triggering the
   existing lexical-fallback path — never compared against a
   differently-sourced vector (`identitiesCompatible`). A new
   Consolidation step, Re-embedding, runs first in Consolidation's
   sequence — ahead of Clustering, Promotion, Promotion Audit, Commit
   Invalidation, Pruning, and Invalidation — and recomputes + persists a
   healed vector/identity for every Memory whose stored identity no
   longer matches the current default, so every later step in the same
   pass sees an ordinary, fully-embedded Memory again. This is a
   to-and-fro transition, unlike Invalidation/Forget's one-way
   `stale`/`retracted` transitions: a healed Memory simply becomes
   indistinguishable from one that always matched. A Memory the current
   provider can't re-embed (provider unreachable) is left with its old,
   mismatched vector untouched and is retried on the next Consolidation
   pass — no bulk, one-time migration script exists or is planned.
5. **Clustering's 0.82 cosine-similarity threshold is kept unchanged.**
   See "Threshold re-validation" below for the empirical basis.

## Threshold re-validation

`CLUSTER_SIMILARITY_THRESHOLD` (`core/clustering.ts`) was calibrated
against the Ollama Provider's `nomic-embed-text` output; switching the
default provider risked silently making it too loose or too strict under
`nomic-embed-text-v1`'s different similarity distribution. This was
checked empirically, not assumed either way, by embedding
`benchmarks/corpus/memories.json`'s 57-memory corpus (already built with
deliberate near-duplicate and confusable-sibling pairs, reused rather than
inventing a new corpus) under both a real, locally-running Ollama server
and the real Embedded Provider (`@huggingface/transformers` installed
temporarily, then removed, for this one-off check only — never a
committed dependency; `raiminiscence-mcp`'s own `pnpm-lock.yaml` doesn't
resolve it, matching `embedded.test.ts`'s existing assumption that it's
never actually installed in this workspace), and computing pairwise
cosine similarity across:
14 hand-identified near-duplicate ("should cluster") pairs, 4 confusable
sibling ("same topic, distinct fact — should *not* cluster") pairs, and
all 1,578 remaining/unrelated pairs.

Results at the existing 0.82 threshold:

| | should-cluster recall | sibling false-positives | unrelated false-positives |
|---|---|---|---|
| Ollama (`nomic-embed-text`) | 4/14 | 0/4 | 1/1578 |
| Embedded (`nomic-embed-text-v1`) | 1/14 | 0/4 | 0/1578 |

The one Ollama-side "unrelated" false-positive (m19/m20, both describing
the same GitHub-Actions staging→production deploy flow) is a gap in the
hand-curated ground truth, not a genuine false merge — a related pair I'd
missed when building the "should cluster" list, not miscounted by the
metric. The Embedded Provider doesn't cross 0.82 on that same pair.

Two findings drove the decision to leave 0.82 unchanged:

1. **0.82 was already a high-precision, low-recall threshold under
   Ollama**, not a threshold this corpus shows as loose. Lowering it to
   e.g. 0.80 already introduces a false-positive merge against a
   confusable-sibling pair under Ollama's *existing*, already-shipped
   behaviour (1/4 siblings cross 0.80) — so any lowering would be a
   regression for users staying on Ollama, not a fix.
2. **The Embedded Provider's similarity distribution is lower but
   directionally similar**, and 0.82 sits with *more* margin above its
   confusable-sibling max (0.82 − 0.766 ≈ 0.054) than it does above
   Ollama's (0.82 − 0.815 ≈ 0.006). The new default's recall on the
   hand-picked near-duplicate pairs is lower (1/14 vs 4/14) — a real,
   measured reduction — but Consolidation is opportunistic and cumulative
   across many runs, not a single-shot classifier, and zero false-positive
   merges is the property this threshold exists to guarantee. Moving the
   threshold to chase recall on this already-low-recall metric would trade
   away that guarantee's safety margin for a benefit neither provider's
   distribution supports doing cheaply.

No change to `clustering.ts` follows from this ticket beyond the doc
comment recording that the re-validation happened.

## CONTEXT.md

The `_(planned)_` marker on **Re-embedding** is removed now that it's
implemented, and the **Embedding Provider** and **Consolidation** entries'
"planned"/"through v16" language is updated to describe the Embedded
Provider as the existing default, not a future one.

## Out of scope (carried from the v17 spec)

Bit-exact parity with Ollama's own output; bundling model weights in the
npm package; `node-llama-cpp`/GGUF as the default; `fastembed-js`; any
chat/completion LLM capability; a bulk re-embedding migration script;
changes to Recall/Overview/Inspect's scoring formula beyond the threshold
re-validation above; the benchmark harness's comparison methodology
itself; Team-Shared/hosted multi-tenant evolution (ADR-0016, checked for
drift here and confirmed unaffected — it doesn't reference the embedding
pipeline); the npm-publish/release pipeline.
