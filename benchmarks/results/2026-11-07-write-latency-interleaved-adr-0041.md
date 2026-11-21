# Write latency through each MCP server, interleaved (2026-11-07)

Write cost as an agent sees it. One `remember` call to rAIminiscence's real built MCP server against one `hippo_remember` call to hippo-memory's real MCP server (`hippo mcp`), both already running, each on a store seeded with the same synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`). rAIminiscence's store is seeded with the Embedded Provider, its server's default. Each call writes a new Memory from the same corpus, the same text to both.

Both answer once the Memory is on disk and embed it after, rAIminiscence since ADR-0041. Each runs that embed in its server process, so every call is followed by a pause long enough for it to finish before the next call of either system.

Method: 2 untimed warm-up writes to each, then 21 pairs, the order flipped every pair, with a 500 ms pause after every call, so neither system's background embed lands on the other's timed call. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Vectors after exit" counts rAIminiscence's writes, warm-up included, that have a vector of the server's identity once the server has exited; a shortfall means a background embed failed or was cut off.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Vectors after exit |
|---|---|---|---|---|---|---|
| 10 | 3.7 ms | 4.9 ms | -0.9 ms [-1.3, -0.5] | 17 of 21 | 6.4 → 6.2 | 23 of 23 |
| 50 | 4.1 ms | 4.7 ms | -0.6 ms [-1.5, 0.1] | 14 of 21 | 6.3 → 5.6 | 23 of 23 |
| 150 | 5.0 ms | 5.2 ms | -0.5 ms [-1.2, 1.2] | 13 of 21 | 6.2 → 5.9 | 23 of 23 |
| 300 | 4.0 ms | 4.8 ms | -0.9 ms [-1.2, -0.3] | 17 of 21 | 6.8 → 6.7 | 23 of 23 |
| 750 | 4.2 ms | 5.0 ms | -0.2 ms [-1.8, 0.7] | 11 of 21 | 5.6 → 6.8 | 23 of 23 |
| 1500 | 4.7 ms | 5.0 ms | -0.5 ms [-1.0, 0.8] | 12 of 21 | 5.8 → 8.6 | 23 of 23 |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
