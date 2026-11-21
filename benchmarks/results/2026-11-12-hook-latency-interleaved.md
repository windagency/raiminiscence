# Per-turn hook latency, interleaved (2026-11-12)

ADR-0039's acceptance check. rAIminiscence's real built hook shim, with the real built MCP server running in the same project, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.

Method: 2 untimed warm-up calls of each, then 21 pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Meets the bar" means rAIminiscence's median is at or below hippo-memory's.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Meets the bar |
|---|---|---|---|---|---|---|
| 10 | 53.4 ms | 127.8 ms | -74.7 ms [-75.3, -74.0] | 21 of 21 | 7.2 → 6.8 | yes |
| 50 | 53.0 ms | 127.7 ms | -74.8 ms [-75.5, -74.1] | 21 of 21 | 6.0 → 5.6 | yes |
| 150 | 54.0 ms | 126.8 ms | -73.3 ms [-75.6, -72.1] | 21 of 21 | 4.3 → 4.0 | yes |
| 300 | 54.7 ms | 127.1 ms | -73.0 ms [-74.1, -72.0] | 21 of 21 | 2.6 → 2.5 | yes |
| 750 | 55.9 ms | 126.9 ms | -71.2 ms [-71.7, -70.0] | 21 of 21 | 2.5 → 2.5 | yes |
| 1500 | 58.7 ms | 127.1 ms | -68.7 ms [-69.1, -67.9] | 21 of 21 | 1.9 → 1.9 | yes |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
