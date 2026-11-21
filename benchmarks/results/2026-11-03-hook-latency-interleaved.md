# Per-turn hook latency, interleaved (2026-11-03)

ADR-0039's acceptance check. rAIminiscence's real built hook shim, with the real built MCP server running in the same project, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.

Method: 2 untimed warm-up calls of each, then 21 pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Meets the bar" means rAIminiscence's median is at or below hippo-memory's.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Meets the bar |
|---|---|---|---|---|---|---|
| 10 | 50.4 ms | 121.3 ms | -70.8 ms [-72.4, -69.5] | 21 of 21 | 2.7 → 2.6 | yes |
| 50 | 52.3 ms | 123.0 ms | -71.3 ms [-72.3, -66.9] | 21 of 21 | 3.0 → 3.3 | yes |
| 150 | 51.1 ms | 123.9 ms | -72.9 ms [-74.9, -70.2] | 21 of 21 | 4.2 → 3.9 | yes |
| 300 | 52.1 ms | 123.5 ms | -71.7 ms [-72.3, -69.6] | 21 of 21 | 3.3 → 3.3 | yes |
| 750 | 54.5 ms | 123.6 ms | -69.7 ms [-70.7, -68.9] | 21 of 21 | 3.1 → 3.1 | yes |
| 1500 | 57.8 ms | 124.5 ms | -66.2 ms [-68.5, -64.4] | 21 of 21 | 2.9 → 2.8 | yes |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
