# Write latency through each MCP server, interleaved (2026-11-11)

Write cost as an agent sees it. One `remember` call to rAIminiscence's real built MCP server against one `hippo_remember` call to hippo-memory's real MCP server (`hippo mcp`), both already running, each on a store seeded with the same synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`). rAIminiscence's store is seeded with the Embedded Provider, its server's default. Each call writes a new Memory from the same corpus, the same text to both.

Both answer once the Memory is on disk and embed it after, rAIminiscence since ADR-0041. Each runs that embed in its server process, so every call is followed by a pause long enough for it to finish before the next call of either system.

Method: 2 untimed warm-up writes to each, then 21 pairs, the order flipped every pair, with a 500 ms pause after every call, so neither system's background embed lands on the other's timed call. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Vectors after exit" counts rAIminiscence's writes, warm-up included, that have a vector of the server's identity once the server has exited; a shortfall means a background embed failed or was cut off.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Vectors after exit |
|---|---|---|---|---|---|---|
| 10 | 5.3 ms | 6.8 ms | -1.4 ms [-2.0, -1.1] | 18 of 21 | 1.2 → 1.4 | 23 of 23 |
| 50 | 5.3 ms | 6.9 ms | -1.5 ms [-2.1, -1.1] | 19 of 21 | 1.7 → 1.5 | 23 of 23 |
| 150 | 5.3 ms | 6.5 ms | -1.0 ms [-1.9, -0.6] | 19 of 21 | 1.8 → 1.8 | 23 of 23 |
| 300 | 5.5 ms | 6.8 ms | -1.1 ms [-1.7, -0.6] | 18 of 21 | 2.2 → 2.4 | 23 of 23 |
| 750 | 5.8 ms | 6.5 ms | -1.0 ms [-1.3, -0.6] | 16 of 21 | 2.8 → 2.8 | 23 of 23 |
| 1500 | 5.8 ms | 6.6 ms | -1.3 ms [-1.8, -0.3] | 16 of 21 | 2.0 → 3.5 | 23 of 23 |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
