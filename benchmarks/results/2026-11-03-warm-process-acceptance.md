# Hook-started warm process, acceptance (2026-11-03)

ADR-0040's acceptance check. rAIminiscence's real built hook shim with no MCP server running, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.

## First prompt

A call that finds no warm process, so recalls locally and then starts one, against the same call with `RAIMINISCENCE_WARM_EMBED=off`, which is today's no-server hook. 11 pairs, the order flipped every pair; every spawning call starts with no warm process and no spawn marker, and the warm process it starts is stopped before the next call. The extra cost is spawning minus today's, pair by pair, with a 95% percentile-bootstrap interval, 10,000 resamples, seed 1. The bar: at most 20 ms.

| Memories | Today's median | Spawning median | Extra cost [95% CI] | Meets the bar |
|---|---|---|---|---|
| 10 | 583.4 ms | 575.7 ms | 2.7 ms [-20.8, 21.8] | yes |
| 50 | 560.2 ms | 564.3 ms | 5.4 ms [-4.9, 13.8] | yes |
| 150 | 562.3 ms | 565.3 ms | 3.6 ms [-3.9, 24.7] | yes |
| 300 | 578.8 ms | 592.2 ms | 17.6 ms [5.6, 39.5] | yes |
| 750 | 635.6 ms | 624.6 ms | 8.3 ms [-22.5, 26.9] | yes |
| 1500 | 719.1 ms | 712.3 ms | 7.5 ms [-10.5, 18.1] | yes |

## Later prompts

After one call starts the warm process and it answers, 2 untimed warm-up calls of each, then 21 pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory: negative means rAIminiscence is faster. "Same output" means the warm-served context equals the cold one, character for character. The bar: rAIminiscence's median at or below hippo-memory's.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Same output | Load average | Meets the bar |
|---|---|---|---|---|---|---|---|
| 10 | 52.2 ms | 124.3 ms | -72.2 ms [-73.8, -71.5] | 21 of 21 | yes | 6.1 → 4.6 | yes |
| 50 | 50.4 ms | 123.3 ms | -73.1 ms [-74.1, -72.1] | 21 of 21 | yes | 4.6 → 3.6 | yes |
| 150 | 51.1 ms | 123.1 ms | -72.2 ms [-73.3, -71.7] | 21 of 21 | yes | 3.6 → 3.7 | yes |
| 300 | 51.3 ms | 122.6 ms | -70.9 ms [-72.2, -70.1] | 21 of 21 | yes | 4.5 → 3.6 | yes |
| 750 | 54.6 ms | 123.3 ms | -69.2 ms [-69.7, -68.2] | 21 of 21 | yes | 4.0 → 4.0 | yes |
| 1500 | 57.7 ms | 125.6 ms | -67.7 ms [-69.1, -66.3] | 21 of 21 | yes | 5.0 → 3.9 | yes |

## Concurrency

10 first calls started at the same moment on a 10-Memory store left 1 warm process running. The bar: exactly one.

The idle exit is covered by `packages/raiminiscence-mcp/test/warm-process.test.ts`, not timed here. Single machine, single run. Raw per-call timings are in the JSON file alongside.
