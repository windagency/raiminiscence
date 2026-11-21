# How rAIminiscence works

[Back to README.md](../README.md) • [Back to packages/raiminiscence-mcp/README.md](../packages/raiminiscence-mcp/README.md)

`remember` and `recall` are the whole interface, but there's a real
model underneath them — closer to how the term "memory" is used in
cognitive science than to a cache or a key-value store. This page is
the deep version; the [domain glossary](../CONTEXT.md) is the canonical,
one-definition-per-term reference it's drawn from.

## Four kinds of Memory, not one bucket

Every Memory belongs to exactly one **Memory Kind**, fixed at write
time, each with its own base **Half-life** — how long it takes to decay
to half its original **Strength**:

| Kind         | Base half-life | What it holds                                                                                                                                                                                                                                              |
| ------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `episodic`   | 7 days         | A raw, timestamped observation from a single session. Noisy, context-specific, the default when no kind is given.                                                                                                                                          |
| `semantic`   | 30 days        | A distilled, reusable pattern — usually produced automatically by Consolidation's Promotion step from a cluster of related episodic memories.                                                                                                              |
| `decision`   | 21 days        | An architectural or design choice, captured with its rationale at the moment it happened. A staging layer only — distinct from a human-curated ADR, and never reads or writes `docs/adr/` ([ADR-0004](./adr/0004-memory-complements-static-docs.md)). |
| `checkpoint` | 3 days         | A transient "what I was in the middle of" pointer, refreshed periodically rather than written once. Fetched by recency, not Strength, and excluded from Clustering/Conflict detection entirely.                                                            |

Independent of Kind, a Memory also carries a **Confidence Tier** —
`verified`, `observed`, `inferred`, `stale`, or `retracted` — that says
how much to trust its content. `stale` and `retracted` are the two tiers
that actually matter operationally: both are excluded from `recall`/
`overview` ranking the moment they're set, not just flagged for display.

## Strength: continuous, not a flag

A Memory's **Strength** — its current decayed relevance — is a pure
function, recomputed on every read, never stored: `0.5 ^ (elapsed /
halfLife)`. Underneath that one formula:

- **Decay Grace Period** — the first 14 days of elapsed time since a
  Memory was last touched never count against it, so an ordinary gap
  (a holiday, a slow week) costs nothing.
- **Spaced Repetition** — every time `recall` returns a Memory, or it
  survives a Consolidation pass, its effective Half-life gets a raw +2
  days.
- **Error Amplification** — a Memory written with `isError: true`
  (a corrected mistake) starts with 2× its Kind's base Half-life —
  mistakes are retained longer than routine facts, deliberately.
- **Outcome Feedback** — the agent can explicitly report whether a
  recalled Memory actually helped: +5 raw days on a positive report,
  −5 on a negative one, with a hard floor so effective Half-life never
  drops below 1 day.
- **Reinforcement Ceiling** (v12) — Spaced Repetition's and Outcome
  Feedback's combined *positive* contribution approaches, but never
  exceeds, 4× a Memory's base Half-life, via a smooth diminishing-returns
  curve rather than a hard cutoff — so a handful of high-feedback
  memories can't come to dominate every recall indefinitely
  ([ADR-0019](./adr/0019-v12-reinforcement-ceiling.md)).

![Strength decay curves for the four Memory Kinds: checkpoint (3-day half-life) and episodic (7-day) drop off fast after the 14-day grace period, decision (21-day) and semantic (30-day) decay much more slowly](./images/decay-curves.svg)

*Plotted directly from `computeStrength()` in
[`decay.ts`](../packages/raiminiscence-mcp/src/core/decay.ts), with no
reinforcement applied — the pure effect of each Kind's base Half-life.*

## Consolidation: turning noise into knowledge

Periodically — explicitly, opportunistically inline during
`remember`/`recall` (debounced, [ADR-0025](./adr/0025-v19-opportunistic-consolidation-debounce.md)),
or forced at session end — `consolidate` runs a fixed pipeline over the
whole store, in this order:

![Consolidation pipeline: re-embedding, clustering, promotion, promotion audit, commit invalidation, pruning, then invalidation, in that fixed order over the whole store](./images/consolidation-pipeline.svg)

1. **Re-embedding** — heals any Memory whose stored vector no longer
   matches the project's current Embedding Provider.
2. **Clustering** — groups cosine-similar (≥ 0.82; 0.87 for nomic's task-prefixed vectors, ADR-0042) episodic memories
   into candidate clusters, skipping any pair with a confirmed
   `"contradicts"` verdict between them and any memory with net-negative
   Outcome Feedback.
3. **Promotion** — turns a cluster into one new `semantic` Memory
   (`inferred` confidence) and reinforces its surviving contributors.
4. **Promotion Audit** (v8) — retroactively re-checks every already-
   promoted semantic Memory's contributors against *current* conflict/
   feedback state, not the state at Promotion time, and stales it if
   the evidence has since changed.
5. **Commit Invalidation** (v9) — for a Memory with no Related Files set,
   parses recent git commit subjects for a migration shape (`migrate X
   to Y`, `remove X`, …) and stales it if its body mentions the outgoing
   target.
6. **Pruning** — the only step that physically deletes a file: any
   Memory, any Kind, any tier, whose Strength has decayed below 0.05.
7. **Invalidation** (v2) — stales a Memory whose explicit `relatedFiles`
   were touched by a later git commit.

## No graph layer, by measurement

Earlier versions linked Memories that `recall` returned together with
**Co-access Edges**, and **Spreading Activation** used those links to
boost or surface results. On a LongMemEval replay and on two real repos'
commit histories it did nothing useful or made retrieval worse, so it
was removed ([ADR-0037](./adr/0037-coaccess-and-spreading-activation-are-removed.md);
numbers in [the benchmark README](../benchmarks/README.md#co-access-edges-and-the-recall-cache-adr-0035-to-adr-0037)).
`recall` ranks by similarity × Strength × Confidence Tier weight alone,
and every result's `surfacedVia` is `"match"`.

## Conflicts are surfaced, never silently resolved

When `recall` finds two memories similar enough to plausibly disagree
(≥ the clustering threshold) with no recorded verdict yet, it flags them
to each other as a **Conflict Candidate** — never auto-resolved, since
the server has no basis to decide which one is right. The agent judges
it via the `conflict` tool: `"contradicts"` (both stay recallable; the
disagreement itself is the signal), `"supersedes"` (the named loser is
retracted), or `"no-conflict"` (dismissed). Confirmed conflicts block
Clustering from treating the pair as related, so a disagreement can't
quietly get baked into a consolidated pattern.

## Storage: files, not a database

Every Memory is one Markdown file with YAML frontmatter under
`.raiminiscence/memory/{episodic,semantic,decisions,checkpoints}/`,
gitignored by default — readable, greppable, and editable with zero
tooling ([ADR-0001](./adr/0001-flat-file-markdown-storage.md)). A
few small per-record JSON files alongside it index embeddings and
Conflict Edges — derived, rebuildable, never the
source of truth. No database, no vector store, no background service:
the MCP server is a subprocess your client starts and stops, speaking
stdio only ([ADR-0003](./adr/0003-stdio-only-transport.md)).

Full mechanism-by-mechanism detail, formulas, and sequence diagrams:
**[Low-level design](./architecture/lld.md)** ·
**[High-level design](./architecture/hld.md)** ·
**[Domain glossary](../CONTEXT.md)**.
