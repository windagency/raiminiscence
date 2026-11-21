# The per-turn hook starts a short-lived warm process when no MCP server runs

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to docs/adr/README.md](README.md) • [Back to lld.md](../architecture/lld.md) • [Back to user-guide.md](../user-guide.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

**Status: accepted. Built 2026-11-03, not yet merged.** Tracked in [`NEXT_STEPS.md`](../../NEXT_STEPS.md).

[ADR-0039](0039-the-per-turn-hook-asks-a-running-server-for-the-whole-recall.md) made the hook fast while an MCP server runs: 50 to 58 ms against hippo-memory 3.1.1's 121 to 125 ms, interleaved call by call. With no server, nothing has changed. Every prompt loads the Embedded model, imports the engine and parses the recall cache, at 600 to 760 ms from 10 to 1,500 Memories. That happens when a client runs the hook but not the MCP server, before the server has started, and after it exits.

## Decision

- **The hook starts a warm process once, then gets out of the way.** When the hook's served recall gets no answer, it recalls locally, as today. Then it spawns one detached process and does not wait for it: `node <raiminiscence-mcp>/dist/warm.js <storageRoot> <hookPid>`. It spawns after its own recall, and the warm process imports nothing heavy until that pid has exited, at most 10 seconds. Measured, a warm process that loaded the engine and the model at once added 17 to 76 ms to the prompt that started it, growing with the store; waiting for the hook removed that. The process has `stdio: "ignore"`, is unref'd, and runs from the same installed package as the hook.
- **The warm process serves what a server serves, and nothing else.** It serves ADR-0038's embed socket and ADR-0039's recall socket for that storage root, with the same code the MCP server runs. It never speaks MCP, never writes a Memory, never runs Consolidation and never touches git or Shared Memory. Its only writes are the `lastRecalledAt` and `recallCount` writeback a local recall would make anyway.
- **It exits on its own.** It exits after 30 minutes with no request on either socket, and removes its sockets on exit. It exits at once when another process already serves the recall socket, so an MCP server, an older warm process or a concurrent spawn always wins. The embed socket alone is no reason to stay: a hook that is served its recall never embeds.
- **It makes way for another release.** A recall request carries the client's package version. After answering a request from another version, which that client rejects, the warm process exits, so the newer hook's next spawn can take the sockets. Without this, an outdated warm process kept alive by the newer hook's own requests would never idle out.
- **It never deletes a socket that isn't its own.** Node unlinks a Unix socket's path when its server closes, so a server that another had replaced would delete its successor's socket. Every socket server now listens on a private path and renames it into place, and removes the public path only while its inode is still the one it created. The warm process also checks that inode every minute, and exits once another server has replaced its socket.
- **One spawn per project per minute at most.** Before spawning, the hook claims a marker file, `~/.raiminiscence/run/warm-<hash>.spawned`, in the same owner-only directory, with the same hash as the recall socket. The claim is an exclusive create, so one of several concurrent hooks wins. A marker over 60 seconds old is replaced. This bounds the cost of a warm process that cannot start, for example when an older server holds the sockets.
- **Same switch and limits as ADR-0038 and ADR-0039.** `RAIMINISCENCE_WARM_EMBED=off` disables the spawn as well as both sockets. It is off on Windows. The test setup already sets the switch, so no test spawns a process.

## Why this is not the rejected sync daemon

`NEXT_STEPS.md` rejects "a live sync protocol or daemon". [ADR-0017](0017-v11-shared-memory-via-git-worktree.md) rejected it for adding a transport and infrastructure surface that [ADR-0003](0003-stdio-only-transport.md) rules out, to share Memories between writers. The warm process differs on each count:

- It shares nothing between users or machines. Shared Memory still moves only over git.
- It adds no network surface. Its two Unix sockets are ADR-0038's and ADR-0039's, in an owner-only directory.
- It holds no state of its own. It is a cache of what is on disk, rebuilt from the files, and losing it at any moment changes no result.
- It is not installed or always on. Nothing starts it but a hook call, and it exits after 30 idle minutes.

What it does share with a daemon is that it is a background process nobody started by hand. The user guide must say so, with the opt-out switch next to it.

## Acceptance

Built only if all of these hold, measured on the real hook with no MCP server:

- From the second prompt of a session on, the hook's median is at or below hippo-memory's at every store size, interleaved as in `benchmarks/hook-latency-interleaved.ts`.
- The first prompt costs no more than 20 ms over today's no-server hook.
- Output is identical to local recall.
- Ten concurrent first hook calls leave exactly one warm process.
- The process exits after its idle timeout and leaves no socket behind.

## Measured result

[`benchmarks/results/2026-11-03-warm-process-acceptance.md`](../../benchmarks/results/2026-11-03-warm-process-acceptance.md), from `benchmarks/warm-process-acceptance.ts`, on the real built hook with no MCP server. Single machine, load average 3.6 to 6.1.

| Memories | First prompt, extra cost [95% CI] | Later prompts, rAIminiscence | hippo-memory 3.1.1 | rAIminiscence faster |
|---|---|---|---|---|
| 10 | 2.7 ms [-20.8, 21.8] | 52.2 ms | 124.3 ms | 21 of 21 |
| 50 | 5.4 ms [-4.9, 13.8] | 50.4 ms | 123.3 ms | 21 of 21 |
| 150 | 3.6 ms [-3.9, 24.7] | 51.1 ms | 123.1 ms | 21 of 21 |
| 300 | 17.6 ms [5.6, 39.5] | 51.3 ms | 122.6 ms | 21 of 21 |
| 750 | 8.3 ms [-22.5, 26.9] | 54.6 ms | 123.3 ms | 21 of 21 |
| 1500 | 7.5 ms [-10.5, 18.1] | 57.7 ms | 125.6 ms | 21 of 21 |

- Every median meets its bar. At 300 Memories the interval's upper end, 39.5 ms, passes the 20 ms budget, so that size's first-prompt cost is not shown to be under it.
- The warm-served context equals the cold one at every size.
- Ten first calls at the same moment left exactly one warm process.
- The idle exit and the removal of its sockets are tested in `packages/raiminiscence-mcp/test/warm-process.test.ts`, not timed on a real 30-minute idle.

## Alternatives considered

- **A smaller quantised Embedded model.** No background process, but it changes every vector, so every store re-embeds and ranking must pass the benchmark gate again. It still pays Node startup, the engine import and the cache parse on every prompt.
- **Start the MCP server itself in the background.** It speaks MCP over stdio and expects a client on its stdin; detached, it would exit or need a second mode. A separate entry point keeps the server unchanged.
- **An OS service, launchd or systemd.** It needs an install step and per-platform code, and it would run when no agent does.
- **Leave it.** With Claude Code, the MCP server usually runs all session, so the no-server case is uncommon. It still costs 600 ms or more on every prompt where it happens.

## Consequences

- The first prompt in a session with no server still pays the local recall. Later prompts pay Node startup, the client import and one socket round trip.
- A prompt that arrives while the warm process is still loading its model waits out the 250 ms socket timeout, then recalls locally. That is at most a few seconds after the first prompt.
- `node:child_process` is now allowed in a second adapter, `core/adapters/detached-process.ts`, beside `core/adapters/git.ts`. Both architecture tests that contain it say so.
- A warm process holds the Embedded model in memory. A running server measured on macOS peaked near 890 MB while loading the model and settled to 70 to 120 MB resident once idle. That cost lasts up to 30 minutes after the last prompt.
- A CLI `remember` or `recall` in the same project also reaches the warm embed socket, so it skips the model load too.
- A warm process from an older release can hold the sockets until it idles out. Hooks from a newer release fall back to local recall meanwhile, and the spawn marker keeps them from spawning on every prompt.
- `ps` shows a `node` process the user did not start. The user guide documents it and the switch that turns it off.
