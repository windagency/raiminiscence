# Nomic embeddings carry their task prefixes

[Back to COMPARISON.md](../../benchmarks/COMPARISON.md) • [Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to docs/adr/README.md](README.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

**Status: accepted. Built 2026-11-12, not yet merged; the gate passes with it.** Tracked in [`NEXT_STEPS.md`](../../NEXT_STEPS.md).

Both Embedding Providers default to `nomic-embed-text-v1`: the Embedded Provider runs its ONNX port, Ollama serves it as `nomic-embed-text`. Its model card says the input "_must_ include a _task instruction prefix_": `search_document: ` before a text to retrieve, `search_query: ` before a query. rAIminiscence has never sent one. Queries and Memories are embedded as bare text.

The benchmark gate's first full run, against hippo-memory 3.5.1 on 2026-11-11, fails one check of 28: LongMemEval-S any-evidence R@1 against arm B, -1.2 [-3.6, +1.2] ([`benchmarks/results/2026-11-11-benchmark-gate.md`](../../benchmarks/results/2026-11-11-benchmark-gate.md)). On the 22 questions B ranks first and rAIminiscence does not, cosine similarity alone puts the wrong session above the evidence on 20. A pilot on 78 questions, cosine only, with no lexical fusion: with prefixes the evidence moves above rAIminiscence's top wrong session on 10 pairs and below it on 3. That is a direction, not proof. The change is the model's documented use, not a fitted parameter, so it needs no held-out set. The gate decides whether it stays.

## Decision

- **`embed` takes a role.** `EmbeddingProvider.embed(text, role)`, with `role` `"query"` or `"document"`. `recall` and Inspect's query mode embed a query. `remember` and Re-embedding embed a document.
- **A nomic model gets its prefixes; any other model gets none.** A model whose name contains `nomic-embed-text` gets `search_query: ` or `search_document: ` before the text. Other configured models are embedded as today, since their prompts differ.
- **The identity records the prefix scheme.** `EmbeddingProviderIdentity` gains an optional `prompt`, `"nomic-task-prefix"` for a nomic model. Two identities are compatible only when their `prompt` matches too, absence included. A vector stored without prefixes therefore mismatches a prefixed provider, and Consolidation's Re-embedding step replaces it, as it does after a model change. Until then that Memory ranks lexically.
- **Every place that persists or compares an identity carries `prompt`.** The packed embedding index on disk, the warm-embed reply (ADR-0038) and the recall socket reply (ADR-0039). Both socket paths hash it, so a server from before this change and one after never share a socket.
- **The warm-embed request carries the role.** A request without one gets no vector, and the caller embeds locally.
- **Prefixed vectors cluster at 0.87, not 0.82.** Prefixes lift every similarity. On `benchmarks/corpus/memories.json`, the median pair goes from 0.42 to 0.57 Embedded and from 0.47 to 0.61 on Ollama. At 0.82, six pairs would merge Embedded instead of one, and the confusable sibling m01/m03 would sit 0.004 below the line. `clusterSimilarityThreshold(identity)` gives 0.87 for a prefixed identity and 0.82 otherwise. Clustering and Conflict candidates both use it, as both used 0.82.

## Threshold re-check

ADR-0024's method, repeated: every pair of the 57 corpus Memories, embedded as documents, with and without prefixes, through the real Embedded Provider and a real Ollama `nomic-embed-text`. ADR-0024's pair labels were never committed, so the pairs near the line were read by hand.

| | Bare, at 0.82 | Prefixed, at 0.82 | Prefixed, at 0.87 |
|---|---|---|---|
| Embedded, pairs merged | 1: m01/m02 | 6 | 1: m01/m02 |
| Embedded, closest sibling | m40/m42 at 0.766 | m01/m03 at 0.816 | m01/m03 at 0.816 |
| Ollama, pairs merged | 5 | 11 | 4: m01/m02, m24/m25, m10/m11, m19/m20 |
| Ollama, closest sibling | m40/m42 at 0.814 | m40/m42 at 0.841 | m40/m42 at 0.841 |

At 0.87 the Embedded Provider merges exactly what it merged before, 0.054 above its closest sibling, as ADR-0024 measured. Ollama's margin over its closest sibling grows from 0.006 to 0.029, and it stops merging m28/m29 and m17/m18. The numbers are from 2026-11-12. Bare Ollama matches ADR-0024's count of five.

## Acceptance

Kept only if all of these hold:

- The benchmark gate's LongMemEval-S Embedded arm, rebuilt with prefixes, scores at least what it did without them on any-evidence R@1, and no gate check that passed on 2026-11-11 fails.
- The corpus suite's Recall@5 is not lower.
- No confusable-sibling pair on the corpus crosses the prefixed threshold, for either provider.
- A store written before this change re-embeds on its next Consolidation, and every vector after it carries the new identity.

## Result

The gate re-ran against hippo-memory 3.5.1 on 2026-11-12 and passes all 28 checks ([`benchmarks/results/2026-11-12-benchmark-gate.md`](../../benchmarks/results/2026-11-12-benchmark-gate.md)). Every acceptance item holds:

- Any-evidence R@1 rises from 86.4 to 87.6, level with arm B at +0.0 [-2.4, +2.4]. No check that passed on 2026-11-11 fails.
- The corpus suite's Recall@5 rises from 80.0% to 85.0%, Precision@5 from 31.0% to 33.0%.
- No confusable-sibling pair crosses 0.87, per the threshold re-check above.
- Re-embedding replaces a bare nomic vector, covered by `reembedding.test.ts`.

All-evidence R@5 rises from 84.9 to 86.2 and LoCoMo evidence R@1 from 33.9 to 36.5. Any-evidence R@10 falls from 98.8 to 98.6, one question. The Ollama arm was not re-run.

## Alternatives considered

- **Encode the prefix scheme in `model`.** One field fewer to carry. But Ollama's `model` is also the name sent to its API, so the identity and the request would diverge, and every reader of `model` would have to strip a suffix.
- **Prefix every model.** Other embedding models use other prompts or none; a nomic prefix could hurt them.
- **Embed sessions in chunks and score the best one.** Aims at the same long-session misses, but adds a vector per chunk and a scoring choice that only LongMemEval-S could tune, with nothing held out. Revisit if prefixes do not close the gap.
- **Leave it.** The gap is within noise. But the model is being used against its own instructions, and every store pays for that.

## Consequences

- Every existing store re-embeds once. A large store pays one embed per Memory on its next Consolidation, and ranks lexically until it does.
- A configured model that is not nomic is unaffected, and keeps its vectors.
- Recall's fused ranking is unaffected by the higher similarities: ADR-0032 min-max normalises each half over the pool. A caller's own `minScore` gates raw similarity, so the same `minScore` now admits more.
