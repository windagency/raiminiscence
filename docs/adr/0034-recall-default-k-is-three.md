# Recall returns three results by default; the per-turn hook keeps ten

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to docs/adr/README.md](README.md) • [Back to flows.md](../architecture/flows.md) • [Back to packages/raiminiscence-hooks/README.md](../../packages/raiminiscence-hooks/README.md)

With the whole body as `detail` ([ADR-0033](0033-recall-returns-the-whole-memory-body.md)), a default `recall` of ten results returned a median of 29,656 tokens on LongMemEval-S. hippo-memory's default returns 3,922. Recall without a `k` now returns three.

Measured on the same 500 rankings, rAIminiscence with Ollama, against hippo-memory B at its default. Paired bootstrap, 10,000 resamples, seed 1:

| Default | R | answer_in_content | Median tokens |
| --- | --- | --- | --- |
| hippo-memory B | 87.6 | 38.4 | 3,922 |
| `k` = 1 | 89.8 | 38.0 | 3,438 |
| `k` = 2 | 95.0, +7.4 [+5.0, +9.8] | 46.2, +7.8 [+5.4, +10.4] | 6,728 |
| `k` = 3 | 96.2, +8.6 [+6.2, +11.2] | 48.4, +10.0 [+7.4, +12.8] | 9,673 |
| `k` = 10 | 99.2 | 51.8 | 29,656 |

## Decision

- `recall` and `inspectQuery` default `k` to 3. A caller can still pass any `k`.
- The per-turn auto-recall hook passes `k` = 10 explicitly. It injects summary lines only, so its cost barely changes, and it keeps strengthening Co-access Edges as before.

`k` = 1 would match hippo-memory's cost, but a single result forms no Co-access Edge, which Spreading Activation needs. `k` = 2 forms one edge per call; `k` = 3 forms three. Three is the smallest default that keeps building the graph at a useful rate and still leads hippo-memory's default on both measures. It costs about 2.5 times hippo-memory's tokens on LongMemEval's 12,000-character sessions; agent-written Memories are far shorter.

## Consequences

- A surfaced-only Memory fills only slots left after the qualifying ones. At the default `minScore` of 0, nearly every candidate with an embedding qualifies, so surfacing rarely had a slot at ten either. Callers that rely on surfacing pass a higher `minScore` and a larger `k`.
- Explicit `recall` calls strengthen three Co-access pairs instead of 45. Most strengthening comes from the per-turn hook, which is unchanged.
- The LongMemEval default runs published on 2026-10-31 used `k` = 10. The `k` = 3 row above comes from their whole-haystack rankings, not a new harness run.
