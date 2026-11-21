# The per-turn hook asks a running MCP server for the whole recall, not just the embedding

[Back to 0040-the-hook-starts-a-warm-process-when-no-server-runs.md](0040-the-hook-starts-a-warm-process-when-no-server-runs.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

**Status: accepted. Built 2026-11-03, not yet merged.** The acceptance bar is met; see Measured result. Tracked in [`NEXT_STEPS.md`](../../NEXT_STEPS.md).

[ADR-0038](0038-a-running-server-keeps-the-embedded-model-warm-for-short-lived-callers.md) took the model load out of the hook while a server runs. The hook is still slower than hippo-memory 3.1.1's, and it slows as the store grows. From `benchmarks/extended-compare.ts` on 2026-11-02, medians of 5 calls:

| Memories | Hook, no server | Hook, server running | `recall` in-process | hippo-memory 3.1.1 hook |
| --- | --- | --- | --- | --- |
| 10 | 710.4 ms | 163.0 ms | 13.3 ms | 148.4 ms |
| 300 | 823.1 ms | 142.5 ms | 14.5 ms | 189.6 ms |
| 1,500 | 819.0 ms | 270.3 ms | 23.7 ms | 143.3 ms |

The in-process column stays near 20 ms at every size, while the server-running column grows by about 110 ms. The difference is where the recall cache lives. `recall-cache.ts` (ADR-0021, ADR-0036) keeps an in-memory copy per process and checks it against `.raiminiscence/cache/version.json` on each call. A long-lived server reads and parses the cache once. A fresh hook process reads and parses all of it, every Memory and every vector, on every prompt. The rest of the hook's cost is fixed: Node startup, about 15 ms, and importing the hook, about 63 ms, which loads the whole engine.

## Decision

- **The server answers recall requests.** When the MCP server starts, it also listens on a second local socket, one per storage root and model: `~/.raiminiscence/run/recall-<hash>.sock`. The hash covers the storage root's real path, the provider and the model. The hook computes the same path from its own resolved storage root and config. Both sides resolve symlinks, because the server's working directory is always a real path while the hook gets whatever path its client sends. A server for another project never owns that socket, so per-project servers never contend for it.
- **The request is the hook's own `recall` call.** It is one line of JSON, `{ "v": 1, "package": <version>, "storageRoot": ..., "query": ..., "k": 10 }`. The server runs the same `recall` call the hook would, always with `triggerConsolidation: false`. The reply is one line, `{ "v": 1, "package": ..., "identity": ..., "results": [...] }`, carrying `RecallResult.results` unchanged. The hook formats the lines itself with `formatSummaryLine`, as today.
- **Exact match or local recall.** The hook uses a reply only if all of these hold:
  - the protocol version, the package version and the provider identity equal its own;
  - the storage root equals its own;
  - the results pass a zod schema.

  The server refuses a request whose storage root is not its own, by replying with `results: null`. On any failure, the hook runs `recall` locally, through ADR-0038's warm embed when that answers. Failures are: no socket, a refused connection, a refusal, no reply within 250 ms, or a reply that fails a check.
- **Writes are unchanged.** `recall` writes back `lastRecalledAt` and `recallCount` and appends to the cache log. The server makes those writes to the same files the hook would. Every other process sees them through `version.json`, as it sees any write today.
- **The hot path imports only the client.** The hook's `UserPromptSubmit` path imports only the socket client, storage-root resolution and the reply schema. It imports the engine only on fallback. `raiminiscence-mcp` declares a light subpath export, `raiminiscence-mcp/recall-client`, for this. The shim loads each event's handler with `import()`, and the engine through one local module of static re-exports, so the workspace's library-only rule still sees every binding the hook pulls in. That rule now accepts a subpath the package's `exports` declares, and still rejects `dist/` and `src/`.
- **Same lifecycle and limits as ADR-0038.** The `run` directory is mode `0700`. A live socket is left to its owner, and a dead one is replaced. The listener never keeps the process alive, and the socket is removed on close or exit. The feature is off on Windows. `RAIMINISCENCE_WARM_EMBED=off` disables this socket too, so one switch turns off everything a running server shares. `core/adapters/local-socket.ts` stays the only importer of `node:net`.

## Acceptance

Built only if the real hook, timed by `extended-compare.ts`'s server-running pass, has a median below hippo-memory's at every store size. It must also return output identical to local recall on the same store. The ADR records the measured result before it moves from proposed.

## Measured result

Built on 2026-11-03, not yet merged. The real hook returns output identical to local recall: byte for byte at 1,500 Memories, median of 7 calls, 760 ms with no server and 59 ms with one. Both sockets are gone after the server exits.

Two full `extended-compare.ts` runs on the same day, medians of 5 calls, hook with a server running against hippo-memory 3.1.1's hook:

| Memories | Run 1 rAIminiscence | Run 1 hippo-memory | Run 2 rAIminiscence | Run 2 hippo-memory |
| --- | --- | --- | --- | --- |
| 10 | 58.4 ms | 128.7 ms | 97.9 ms | 213.1 ms |
| 50 | 61.5 ms | 123.3 ms | 76.1 ms | 210.6 ms |
| 150 | 57.7 ms | 128.1 ms | 75.7 ms | 249.9 ms |
| 300 | 60.9 ms | 121.0 ms | 174.8 ms | 145.8 ms |
| 750 | 65.3 ms | 145.4 ms | 135.7 ms | 140.9 ms |
| 1,500 | 71.3 ms | 222.0 ms | 166.4 ms | 193.6 ms |

Run 1 meets the bar at every size. Run 2 ran with a load average near 9 from an unrelated virtual machine, and misses it at 300 Memories. In that run, in-process recall also slowed two- to three-fold. The benchmark times rAIminiscence and hippo-memory in separate phases, so load lands on them unevenly. `benchmarks/results/` holds run 2, the later one.

The interleaved measurement settles it. `benchmarks/hook-latency-interleaved.ts` alternates the two hooks call by call, 21 pairs per size, the order flipped every pair, at a load average near 3. From `benchmarks/results/2026-11-03-hook-latency-interleaved.md`:

| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster |
| --- | --- | --- | --- | --- |
| 10 | 50.4 ms | 121.3 ms | -70.8 ms [-72.4, -69.5] | 21 of 21 |
| 50 | 52.3 ms | 123.0 ms | -71.3 ms [-72.3, -66.9] | 21 of 21 |
| 150 | 51.1 ms | 123.9 ms | -72.9 ms [-74.9, -70.2] | 21 of 21 |
| 300 | 52.1 ms | 123.5 ms | -71.7 ms [-72.3, -69.6] | 21 of 21 |
| 750 | 54.5 ms | 123.6 ms | -69.7 ms [-70.7, -68.9] | 21 of 21 |
| 1,500 | 57.8 ms | 124.5 ms | -66.2 ms [-68.5, -64.4] | 21 of 21 |

rAIminiscence's hook is faster in every one of the 126 pairs, and its cost grows by 7 ms from 10 to 1,500 Memories. The bar is met at every store size. This covers the case with a server running only. With no server, the hook still costs 600 to 760 ms.

## Alternatives considered

- **Keep the embed-only socket.** At 1,500 Memories it already trails hippo-memory by 127 ms, and the gap grows with the store.
- **Make the cache cheaper to load per process,** with a binary vector file or memory-mapped reads. That narrows the gap but keeps a cost proportional to the store in every hook process. It also helps the no-server case, so it stays open as a separate item.
- **A hook-started background process for when no server runs.** It is a separate decision. `NEXT_STEPS.md`'s Rejected list rules out a sync daemon, so it needs its own record.
- **A TCP or HTTP endpoint.** It adds a network surface that ADR-0003 keeps out. A Unix socket in an owner-only directory reaches only the user's own processes.

## Consequences

- With a server running, the hook's cost should be close to Node startup, the client import and one socket round trip, independent of store size. This is unmeasured until built.
- The server's in-memory cache already tracks writes from other processes, CLI writes, other agents and Shared Memory pulls among them, so a served recall is as fresh as a local one.
- A server busy in a consolidation pass runs on the same event loop and can miss the 250 ms budget. The hook then recalls locally. When ADR-0038's embed socket is owned by the same busy server, that also waits out its budget. The worst case is 500 ms more than local recall today, on the turns that coincide with a pass.
- Prompt text and recalled Memory text cross a socket that only the user's account can open, as ADR-0038's prompt text already does.
- A hook upgraded ahead of its long-running server gets local recall until the server restarts, because the package versions differ. Ranking never mixes two releases.
- Two servers in one project, for example two agent sessions, share the first one's socket. The second still serves its own MCP client.
