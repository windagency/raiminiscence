# A running MCP server keeps the Embedded model warm for short-lived callers

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to 0039-the-per-turn-hook-asks-a-running-server-for-the-whole-recall.md](0039-the-per-turn-hook-asks-a-running-server-for-the-whole-recall.md) • [Back to docs/adr/README.md](README.md) • [Back to lld.md](../architecture/lld.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

The per-turn hook runs as a fresh process on every prompt. With the Embedded Provider, the default since v17, each of those processes loads the ONNX model before it can embed the prompt. Timed in fresh Node processes on one machine:

| Phase | Time |
| --- | --- |
| Node startup | 15 ms |
| Importing the hook | ~63 ms |
| First embed, including the model load | ~300 ms, 605 ms cold |
| A second embed in the same process | 7.6 ms |
| `recall` itself at 1,500 Memories | 21 ms |

The extended benchmark measured the hook at 697.7 ms against hippo-memory's 79.9 ms at 1,500 Memories. Most of the gap is the model load, repeated on every prompt. The MCP server is usually running during the same session and holds the same model.

## Decision

- **The server serves embeddings.** When the MCP server starts with the Embedded Provider, it listens on a local socket and loads its model straight away. A request is one line of JSON, `{ "text": ... }`. The reply is one line, `{ "identity": ..., "vector": ... }`, from the server's own provider.
- **Short-lived callers ask it first.** `defaultProvider()`, which the hook and the CLI use, wraps the Embedded Provider. It asks the socket for the vector and uses the reply only if the identity matches its own and the vector is a non-empty list of finite numbers. On any failure, it embeds locally, as before: no socket, a refused connection, no reply within 250 ms, or a reply that fails those checks.
- **One socket per user and model.** The path is `~/.raiminiscence/run/embed-<hash>.sock`, where the hash covers the provider and model. The `run` directory is created with mode `0700`. A server that finds a live socket leaves it to its owner. A server that finds a dead one replaces it. A server removes the socket it owns when it closes. The listener never keeps the process alive.
- **Off on Windows.** Named pipes there are not covered by a home directory's permissions, so neither side uses the socket. The hook embeds locally, as before.
- **Opt-out.** `RAIMINISCENCE_WARM_EMBED=off` disables both sides. The test setup sets it, so no test reaches a developer's running server.
- **The Ollama Provider is unchanged.** Ollama already keeps its model loaded between calls.

## Consequences

- A hook call no longer pays the model load while a server for the same user and model is running. Measured on the real hook at 1,500 Memories, median of 7 calls: 583.2 ms with no server and 147.9 ms with one, with identical output. `extended-compare.ts` times the shim both ways on the same store, with no server and then with the real server running.
- A Unix socket path is capped near 104 bytes. A home directory deep enough to exceed it gets no warm path, and the hook embeds locally as before.
- The server holds the model from the moment it starts, rather than from its first `remember` or `recall`.
- A server that is busy, for example in a consolidation pass, can miss the 250 ms budget. The hook then embeds locally and the turn costs 250 ms more than before.
- The prompt text crosses a local socket that only the user's own account can open.
- The vectors are the same model's output on the same machine, so ranking does not change.
