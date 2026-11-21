# Write latency through each MCP server, interleaved (2026-11-06)

Write cost as an agent sees it. One `remember` call to rAIminiscence's real built MCP server against one `hippo_remember` call to hippo-memory's real MCP server (`hippo mcp`), both already running, each on a store seeded with the same synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`). rAIminiscence's store is seeded with the Embedded Provider, its server's default. Each call writes a new Memory from the same corpus, the same text to both.

Both answer once the Memory is on disk and embed it after, rAIminiscence since ADR-0041. Each runs that embed in its server process, so every call is followed by a pause long enough for it to finish before the next call of either system.

Method: 2 untimed warm-up writes to each, then 21 pairs, the order flipped every pair, with a 500 ms pause after every call, so neither system's background embed lands on the other's timed call. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Vectors after exit" counts rAIminiscence's writes, warm-up included, that have a vector of the server's identity once the server has exited; a shortfall means a background embed failed or was cut off.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Vectors after exit |
|---|---|---|---|---|---|---|
| 10 | 6.0 ms | 5.4 ms | 1.0 ms [0.4, 1.2] | 2 of 21 | 21.8 → 16.8 | 23 of 23 |
| 50 | 5.6 ms | 5.0 ms | 0.4 ms [-0.2, 0.9] | 8 of 21 | 13.5 → 10.8 | 23 of 23 |
| 150 | 6.0 ms | 5.0 ms | 1.0 ms [0.6, 1.7] | 5 of 21 | 7.8 → 6.6 | 23 of 23 |
| 300 | 5.9 ms | 5.2 ms | 0.6 ms [0.3, 0.9] | 6 of 21 | 5.0 → 5.4 | 23 of 23 |
| 750 | 6.0 ms | 5.0 ms | 1.2 ms [0.4, 1.7] | 6 of 21 | 4.8 → 5.8 | 23 of 23 |
| 1500 | 5.8 ms | 5.0 ms | 0.9 ms [0.5, 1.5] | 5 of 21 | 6.6 → 8.4 | 23 of 23 |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
