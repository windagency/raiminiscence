# Per-turn hook latency, interleaved (2026-11-10)

ADR-0039's acceptance check. rAIminiscence's real built hook shim, with the real built MCP server running in the same project, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.

Method: 2 untimed warm-up calls of each, then 21 pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Meets the bar" means rAIminiscence's median is at or below hippo-memory's.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Meets the bar |
|---|---|---|---|---|---|---|
| 10 | 52.9 ms | 127.8 ms | -75.0 ms [-76.1, -74.2] | 21 of 21 | 6.9 → 6.4 | yes |
| 50 | 53.0 ms | 128.1 ms | -75.6 ms [-76.4, -74.1] | 21 of 21 | 5.4 → 5.0 | yes |
| 150 | 53.0 ms | 126.8 ms | -74.0 ms [-74.9, -73.0] | 21 of 21 | 3.5 → 3.5 | yes |
| 300 | 54.0 ms | 127.3 ms | -74.1 ms [-75.3, -73.1] | 21 of 21 | 2.4 → 2.5 | yes |
| 750 | 55.1 ms | 126.6 ms | -72.1 ms [-72.7, -70.7] | 21 of 21 | 2.3 → 2.3 | yes |
| 1500 | 57.5 ms | 126.2 ms | -68.6 ms [-69.7, -67.0] | 21 of 21 | 2.4 → 2.3 | yes |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
