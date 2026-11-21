# The MCP server answers `remember` before the embed finishes

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to docs/adr/README.md](README.md) • [Back to lld.md](../architecture/lld.md) • [Back to testing-guide.md](../testing-guide.md) • [Back to user-guide.md](../user-guide.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

**Status: accepted. Built 2026-11-07, not yet merged.** Tracked in [`NEXT_STEPS.md`](../../NEXT_STEPS.md).

A `remember` through the running MCP server takes 33 to 35 ms, flat from 10 to 1,500 Memories. hippo-memory 3.1.1's `hippo_remember` takes 3 to 5 ms ([`benchmarks/results/2026-11-06-write-latency-interleaved-before-adr-0041.md`](../../benchmarks/results/2026-11-06-write-latency-interleaved-before-adr-0041.md)). Almost all of rAIminiscence's time is the embed: about 9 ms back to back, and about 22 ms after an idle spell, which is how agents write. Writing the Memory file, the packed vector and both cache log lines takes 2 to 3 ms in all. Two `git config` calls for the writer identity cost 9 to 26 ms more; they already run while the embed does.

hippo-memory answers once its row is written and embeds after. `remember` waits for the vector before it answers. Nothing in the reply needs the vector: it carries the id, Kind, Confidence Tier, creation time, a redaction flag, an `embedded` flag and a consolidation flag.

## Decision

- **The MCP `remember` tool answers once the Memory is on disk.** It writes the Memory file and its record cache line, then answers. The embed, the packed vector and the embeddings cache line follow in the same process, after the answer. Library callers of `remember` keep today's behaviour by default: the benchmark shims and short-lived processes need the vector written before they exit. The server opts in with `embedInBackground: true`.
- **The reply says the vector is pending.** With `embedInBackground`, `embedded` is `"pending"` instead of `true` or `false`. A failed background embed is logged as a warning.
- **The writer identity is read once and refreshed after.** On the critical path, two `git config` calls would cost as much as the embed did. With `embedInBackground`, a write uses the identity the process last read and refreshes it in the background for the next write. The server reads it once at start. A change to the git identity mid-session reaches the second write after it, not the first.
- **Background work starts on the next turn of the event loop.** Spawning `git` and the start of an embed, which tokenizes, are synchronous work on the server's thread. Started at once, they ran before the answer went out: measured, they held a write at 6 ms against hippo-memory's 5 ms. Both now start from `setImmediate`, after the answer.
- **Readers in the same process wait for pending vectors.** Every read that ranks or clusters by vector awaits the pending embeds of its storage root first: `recall`, which includes the hook's served recall (ADR-0039), `inspect`'s query mode, and Consolidation, explicit or opportunistic. `forget` need not wait: it retracts a Memory and keeps its vector. Only Pruning deletes a vector, inside Consolidation, which waits. A read with nothing pending waits for nothing.
- **Healing covers a missing vector, not only a mismatched one.** Consolidation's Re-embedding step (v17) re-embeds Memories whose vector has the wrong identity. It now also embeds Memories with no vector at all. That covers a server killed between the answer and the vector write, and a Memory whose embed failed, which today stays on the lexical path for good.
- **A server waits for its pending vectors before it exits.** When stdin closes, the server awaits its pending embeds, up to 5 seconds, then exits as today.

## Acceptance

Built only if all of these hold:

- Through each system's running MCP server, rAIminiscence's median `remember` is at or below hippo-memory's at every store size, interleaved as in `benchmarks/write-latency-interleaved.ts`.
- A `recall` sent right after a `remember`, on the same server, ranks the new Memory by its vector, not lexically.
- Every Memory written through the server ends up with a vector of the server's identity, checked after the run.
- A Memory with no vector gets one on the next Consolidation pass.
- The corpus, LongMemEval-S and LoCoMo results are unchanged. Library `remember` behaves as today, so their runs need no re-run.

## Measured result

[`benchmarks/results/2026-11-07-write-latency-interleaved-adr-0041.md`](../../benchmarks/results/2026-11-07-write-latency-interleaved-adr-0041.md), from `benchmarks/write-latency-interleaved.ts`, through both real MCP servers. Single machine, load average 5.6 to 8.6, with other work running.

| Memories | rAIminiscence | hippo-memory 3.1.1 | Median difference [95% CI] | rAIminiscence faster | Vectors after exit |
|---|---|---|---|---|---|
| 10 | 3.7 ms | 4.9 ms | -0.9 ms [-1.3, -0.5] | 17 of 21 | 23 of 23 |
| 50 | 4.1 ms | 4.7 ms | -0.6 ms [-1.5, 0.1] | 14 of 21 | 23 of 23 |
| 150 | 5.0 ms | 5.2 ms | -0.5 ms [-1.2, 1.2] | 13 of 21 | 23 of 23 |
| 300 | 4.0 ms | 4.8 ms | -0.9 ms [-1.2, -0.3] | 17 of 21 | 23 of 23 |
| 750 | 4.2 ms | 5.0 ms | -0.2 ms [-1.8, 0.7] | 11 of 21 | 23 of 23 |
| 1500 | 4.7 ms | 5.0 ms | -0.5 ms [-1.0, 0.8] | 12 of 21 | 23 of 23 |

- Every median meets the bar. At 50, 150, 750 and 1,500 Memories the interval includes zero, so those sizes show a tie or better, not a lead.
- Before this ADR, the same benchmark measured 33 to 35 ms against 3 to 5 ms ([`2026-11-06-write-latency-interleaved-before-adr-0041.md`](../../benchmarks/results/2026-11-06-write-latency-interleaved-before-adr-0041.md)). That run timed each pair's two calls back to back.
- A first build, before background work moved to `setImmediate`, failed the bar at every size ([`2026-11-06-write-latency-interleaved-adr-0041-first-build.md`](../../benchmarks/results/2026-11-06-write-latency-interleaved-adr-0041-first-build.md)).
- Every write through the server had a vector of the server's identity once the server exited, so the wait on stdin close held.
- A recall in the same process waiting for a pending vector, and Consolidation doing the same, are tested in `packages/raiminiscence-mcp/test/background-embed.test.ts`, not timed. So is healing a missing vector, in `reembedding.test.ts`.
- Library `remember` still writes the vector before it returns, so the corpus, LongMemEval-S and LoCoMo runs are unaffected and were not re-run.

## Alternatives considered

- **Keep the embed on the critical path and make it faster.** A smaller or quantised model changes every vector, so every store re-embeds and ranking must pass the benchmark gate again. It would still not reach 5 ms on CPU.
- **Embed lazily at recall time.** Moves the cost to the hook, which ADR-0039 and ADR-0040 just brought under hippo-memory's.
- **Cache the writer identity for the whole process and stop there.** Saves the git calls but leaves the embed, the larger cost.
- **Leave it.** 30 ms is small next to an agent's own tool-call overhead. It still trails hippo-memory on every write, which is what `NEXT_STEPS.md`'s goal measures.

## Consequences

- A Memory is on disk before its vector. For up to one embed, another process reading the store, such as a hook recalling locally with no server, ranks it lexically. That is what happens to a Memory whose embed failed today.
- A reader in the server can wait up to one embed for a write it has not seen yet. With no write in flight, it waits for nothing.
- A server killed before a vector is written leaves that Memory without one until the next Consolidation pass heals it.
- The `remember` tool's `embedded` field is `"pending"` through the server. A client that reads it as a boolean sees a truthy value. It no longer signals an unreachable provider; `recall`'s `usedFallback` still does, since the query embeds through the same provider.
- A git identity change mid-session is recorded one write late in the server.
