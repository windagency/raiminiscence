# Recall and Inspect return the whole Memory body as detail

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to 0034-recall-default-k-is-three.md](0034-recall-default-k-is-three.md) • [Back to docs/adr/README.md](README.md) • [Back to lld.md](../architecture/lld.md)

`recall`, `inspectQuery` and `inspectMemory` cut each Memory's `detail` to 280 characters. The cap assumed short coding-agent Memories. On LongMemEval-S, run through hippo-memory's own harness with the ADR-0032 ranking, it left the answer's words in the top 5 results for 14.0% of the 500 questions. hippo-memory returns whole sessions and scores 50.6%.

An offline sweep rebuilt `detail` from the same ranking at other caps. It reproduced the shipped 14.0 at 280 characters first.

| Cap, characters | Answer in top 5 | Tokens for top 5, about |
| --- | --- | --- |
| 280 | 14.0 | 350 |
| 2,000 | 27.2 | 2,500 |
| 4,000 | 36.6 | 4,900 |
| 8,000 | 44.4 | 9,200 |
| None | 50.8 | 15,400 |

Every cap below the whole body stays behind hippo-memory.

## Decision

`detail` is the whole Memory body. There is no per-result cap. `summary` is unchanged: the body's first line.

## Consequences

- An explicit `recall` or `inspect` call costs as many tokens as the Memories it returns. With `k` at 10, ten long Memories can be large. `k` is the caller's lever.
- The per-turn and session-start hooks inject `summary` only, so their cost does not change.
- The 280-character rationale in the earlier LongMemEval write-up no longer describes the product. The next published run replaces it.
