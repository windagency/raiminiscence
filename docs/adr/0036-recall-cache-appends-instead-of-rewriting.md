# The recall cache appends each change to a log instead of rewriting itself

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to CONTEXT.md](../../CONTEXT.md) • [Back to docs/adr/README.md](README.md) • [Back to flows.md](../architecture/flows.md)

The recall cache (ADR-0021) kept each slot as one JSON file. Every `remember` rewrote both slots whole, and every `recall` rewrote the records slot. Writing 5 Memories into a store of 15,000, with the Embedded provider:

| Store | Time per write | `JSON.stringify` | Embedding | Written per write |
| --- | --- | --- | --- | --- |
| 1,500 | 241 ms | 160 ms | 23 ms | 25.7 MB |
| 15,000 | 1,560 ms | 1,387 ms | 18 ms | 256 MB |

Each write cost grew with the store, so building a store cost O(n²). Building 15,000 Memories took 6,095 seconds.

## Decision

- **Base plus log.** Each slot keeps its base file `{ version, data }` and gains an append-only log beside it, `records.log.jsonl` and `embeddings.log.jsonl`. Each line is `{ version, prev, op }`: the change that takes the slot from version `prev` to `version`.
- **Appends.** `remember` appends one line per slot: the new Memory, and its vector. `recall` appends one records line: the returned Memories' new recall fields and the pairs it strengthened. Both still build their line from a snapshot taken before their own underlying writes, as ADR-0021 requires.
- **Reads.** A reader starts from the base and follows the log's chain, `prev` to `version`, until it reaches the marker's version. If the chain cannot reach it, it rebuilds from the memory files, as before.
- **Compaction.** When the next line would make the log larger than its base, the write rewrites the base and empties the log instead. Amortised over the writes between compactions, a write costs about the size of its own change.
- **Unchanged.** Full writes (`consolidate`'s refresh, `forget`, `feedback`, `conflict`) and invalidation work as before.

## Consequences

- At 15,000 Memories a write takes 44 ms, of which 17 ms is embedding. At 1,500 it takes 52 ms.
- A process that has not read the slot yet parses the base and replays at most a base-sized log: up to twice today's cold read.
- Two processes appending from the same version write two lines with the same `prev`. Readers follow the first; if the marker names the second, the chain breaks and the reader rebuilds. Compaction by one process can also strand another's line. Both cases fall back to a rebuild, the same self-correcting class of race ADR-0021 accepts.
- Log lines are envelope-checked on read, like slot files (ADR-0031). A torn last line ends the usable log.
