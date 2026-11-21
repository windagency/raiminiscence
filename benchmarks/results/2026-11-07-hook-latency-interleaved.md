# Per-turn hook latency, interleaved (2026-11-07)

ADR-0039's acceptance check. rAIminiscence's real built hook shim, with the real built MCP server running in the same project, against hippo-memory's real per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context`. Both stores hold the same synthetic corpus at each size (`benchmarks/corpus/synthetic-memories.ts`); rAIminiscence's is seeded with the Embedded Provider, its hook's own default.

Method: 2 untimed warm-up calls of each, then 21 pairs, the two calls of a pair back to back and the order flipped every pair. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Meets the bar" means rAIminiscence's median is at or below hippo-memory's.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Meets the bar |
|---|---|---|---|---|---|---|
| 10 | 118.1 ms | 240.5 ms | -137.2 ms [-141.9, -109.3] | 21 of 21 | 13.5 → 13.0 | yes |
| 50 | 105.6 ms | 240.4 ms | -131.2 ms [-142.5, -119.1] | 21 of 21 | 12.2 → 11.8 | yes |
| 150 | 122.0 ms | 240.0 ms | -116.1 ms [-132.8, -112.7] | 21 of 21 | 11.0 → 11.1 | yes |
| 300 | 117.0 ms | 239.7 ms | -129.8 ms [-138.1, -120.2] | 21 of 21 | 9.4 → 9.5 | yes |
| 750 | 125.8 ms | 240.3 ms | -113.7 ms [-133.6, -108.6] | 21 of 21 | 10.1 → 9.8 | yes |
| 1500 | 117.0 ms | 239.0 ms | -123.2 ms [-130.2, -117.3] | 21 of 21 | 9.1 → 9.1 | yes |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
