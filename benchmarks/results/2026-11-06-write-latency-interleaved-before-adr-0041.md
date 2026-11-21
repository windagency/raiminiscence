# Write latency through each MCP server, interleaved (2026-11-06)

Write cost as an agent sees it. One `remember` call to rAIminiscence's real built MCP server against one `hippo_remember` call to hippo-memory's real MCP server (`hippo mcp`), both already running, each on a store seeded with the same synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`). rAIminiscence's store is seeded with the Embedded Provider, its server's default. Each call writes a new Memory from the same corpus, the same text to both.

The two answer at different points. rAIminiscence embeds the Memory and runs its write-time conflict and dedupe pass before it answers. hippo-memory answers once the row is written, and embeds in the background after.

Method: 2 untimed warm-up writes to each, then 21 pairs, the two calls of a pair back to back and the order flipped every pair, with a 500 ms pause after each pair so hippo-memory's background embed doesn't land on the next timed call. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Embedded" counts timed rAIminiscence writes whose reply says the Memory was embedded; a shortfall means a write skipped the model and its timing is not comparable.

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Embedded |
|---|---|---|---|---|---|---|
| 10 | 33.0 ms | 5.0 ms | 29.1 ms [25.4, 31.7] | 0 of 21 | 3.6 → 3.0 | 21 of 21 |
| 50 | 33.5 ms | 3.3 ms | 30.3 ms [25.2, 32.9] | 0 of 21 | 3.1 → 2.9 | 21 of 21 |
| 150 | 33.3 ms | 4.3 ms | 29.9 ms [25.6, 31.5] | 0 of 21 | 2.7 → 2.4 | 21 of 21 |
| 300 | 32.9 ms | 4.6 ms | 27.5 ms [24.7, 32.1] | 0 of 21 | 2.1 → 1.9 | 21 of 21 |
| 750 | 34.3 ms | 4.8 ms | 30.4 ms [25.1, 32.3] | 0 of 21 | 2.2 → 2.2 | 21 of 21 |
| 1500 | 34.9 ms | 3.8 ms | 29.9 ms [24.8, 32.5] | 2 of 21 | 2.8 → 2.4 | 21 of 21 |

Single machine, single run. Raw per-call timings are in the JSON file alongside.
