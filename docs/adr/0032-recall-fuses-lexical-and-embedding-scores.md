# Recall ranks by a fused lexical and embedding score, and gates on similarity alone

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to CONTEXT.md](../../CONTEXT.md) • [Back to docs/adr/README.md](README.md) • [Back to flows.md](../architecture/flows.md) • [Back to lld.md](../architecture/lld.md)

Recall ranked by cosine similarity x Strength x Confidence Tier weight, and lexical scoring ran only as the fallback when no embedding was available. On LongMemEval-S, run through hippo-memory's own harness, that ranking put the right session first for 76.6% of the 500 questions. Plain BM25 over the same stores reached 86.4%.

An offline replay over the same 500 stores tried two fusions with textbook parameters, none tuned. The replay first reproduced the shipped `recall`'s top 10 for 500 of 500 questions. Reciprocal rank fusion gave R@1 86.0 and R@5 97.0. An equal-weight mix of min-max-normalised scores gave R@1 89.8 and R@5 98.4. hippo-memory's best run on the same data gives R@1 87.8 and R@5 97.4. Against it, the paired bootstrap difference is +2.0 [0.0, +4.0] at R@1 and +1.0 [-0.2, +2.4] at R@5.

## Decision

When the query has an embedding, each candidate in the Scope- and Kind-filtered pool gets two raw scores. The dense score is what Recall already computed: cosine similarity, or `naiveScore` for a candidate without a compatible embedding. The lexical score is Okapi BM25 over Memory bodies, with k1 = 1.2 and b = 0.75 and the pool as the corpus. Each score is min-max normalised over the pool. The fused similarity is `0.5 * dense + 0.5 * lexical`.

- **Ranking** uses fused similarity x Strength x Confidence Tier weight. Ties fall back to the raw dense score.
- **Qualifying** is unchanged: the raw dense score x Strength x Confidence Tier weight must exceed `minScore`. Normalised scores have no absolute meaning, so they would empty `minScore` of meaning, drop the lowest candidate at the default of 0, and score a single-Memory pool as 0.
- **Degenerate pools** where every value is equal normalise to 1 if that value is positive, and to 0 otherwise. A pool with no term overlap anywhere gets no lexical signal.
- **Fallback** with no query embedding is unchanged.

The mix was chosen over reciprocal rank fusion after seeing both scores on the evaluation data. This record states that selection. The claim the change supports is "at least as good as hippo-memory's best run", not "better". The published comparison comes from a fresh run of hippo's harness against this code, not from the replay.

## Consequences

- `recall` and Inspect's `inspectQuery` share `scoreCandidatesForQuery`, so both change together.
- A returned `score` is relative to the pool it came from. Comparing scores across separate calls was never meaningful, and it is no longer even approximately so.
- Every Recall tokenises the whole pool. Per-turn latency at large store sizes needs re-measuring. Caching term statistics in the Recall Cache is the follow-up if it regresses.
- A Memory that shares the query's words can now outrank one that is semantically closer. The "embedding wins outright" behaviour from v1 is gone.

**Addendum (2026-11-01):** the fused ranking scores lower on this repo's own hand-labelled corpus of 57 Memories and 20 queries. Re-run through `benchmarks/compare.ts`, Recall@5 fell from 90.0% to 80.0% and Precision@5 from 35.0% to 31.0%, which puts precision below hippo-memory's 31.8%. Run against frozen builds, the build before this record finds 35 of the 39 relevant Memories in the top 5. The build with it, and the current code, find 31 each, with identical rankings. Four queries lose one relevant Memory each, and none gains. The decision stands: on LongMemEval the same change raised R@1 from 76.6 to 89.8, over 500 questions. With 20 queries, the corpus cannot say which effect is typical. See [`benchmarks/README.md`](../../benchmarks/README.md)'s "Honest caveats" and [`corpus-attribution/`](../../benchmarks/corpus-attribution/2026-11-01-results/).
