# Co-access Edges and Spreading Activation are removed

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to CONTEXT.md](../../CONTEXT.md) • [Back to docs/adr/README.md](README.md) • [Back to flows.md](../architecture/flows.md) • [Back to hld.md](../architecture/hld.md) • [Back to lld.md](../architecture/lld.md) • [Back to how-it-works.md](../how-it-works.md) • [Back to testing-guide.md](../testing-guide.md) • [Back to user-guide.md](../user-guide.md)

Spreading Activation ranked recall results using Co-access Edges, links between Memories that a recall had returned together. It was measured three times, each against the same store with its edges removed:

| Workload | Build | What the edges did |
| --- | --- | --- |
| LongMemEval-S, the per-turn hook replayed on 324 questions | Before ADR-0035 | R@1 fell from 90.7 to 10.8, a runaway clique |
| The same replay | ADR-0035 | R@1 -0.6 [-1.5, +0.0]; all evidence in the top 5 unchanged |
| Repeated work: Flask's and Hono's own commit histories, 692 test commits | ADR-0035 | File recall@10 -0.1 [-0.2, +0.0]; ranking changed for 1 commit |

In the third workload the edges did carry the signal. From a correct top result, edge weight picked out the other changed files with an AUC of 0.84 on Flask and 0.96 on Hono, about what the true co-change history gives. ADR-0035's bounded boost hands nearly every Memory the same capped amount, so none of that reached the ranking. A boost weighed against each partner's strongest edge was then tuned on Flask, +3.5 [+1.9, +5.1]. On Hono, held out, it lost: -2.9 [-4.9, -0.9]. Under the rule registered before the run, it did not ship.

Every way of turning the edges into a ranking was either inert or harmful. The mechanism still cost a write per returned pair on every recall, a graph walk on every query, and a `maxHops` setting.

## Decision

- **Removed.** `recall` no longer strengthens Co-access Edges, and scoring no longer reads them. A result is ranked by its fused similarity × Strength × Confidence Tier weight (ADR-0032) alone. Nothing surfaces through a connection.
- **`surfacedVia` stays.** Every result carries it, always `"match"`. The `"connection-N"` members stay in the TypeScript type, so a consumer's exhaustive check still compiles.
- **`maxHops` goes.** It is no longer in `recall`'s or `inspect`'s schema, in `.raiminiscence.config.json`, or exported. The MCP layer strips unknown arguments, so a client that still sends it gets a normal result. A config file that still sets it loads, and the key is ignored.
- **Old edge files stay on disk.** `memory/co-access/` is never read, written or pruned again, and can be deleted by hand. Shared Memory keeps its `co-access/*` merge rule, so edge files written by a machine still on an older version merge cleanly.

This supersedes ADR-0002's deferral, ADR-0006 to ADR-0010, and ADR-0035. Conflict Edges still block Clustering (ADR-0011). ADR-0034's three results stand on their token cost alone.

## Consequences

- A behaviour change for clients that read `"connection-N"` results or set `maxHops`: a MAJOR release.
- A recall writes only its results' recall fields, and its cache log line carries no pairs. Old log lines with pairs replay as before, minus the pairs.
- If co-retrieval is revisited, it starts from a held-out evaluation, not a mechanism.
