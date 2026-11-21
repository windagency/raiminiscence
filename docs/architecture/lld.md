# Low-level design

[Back to README.md](../../README.md) • [Back to flows.md](flows.md) • [Back to hld.md](hld.md) • [Back to developer-guide.md](../developer-guide.md) • [Back to how-it-works.md](../how-it-works.md) • [Back to user-guide.md](../user-guide.md) • [Back to readme-package-sections.md](../../packages/raiminiscence-mcp/docs/readme-package-sections.md) • [Back to packages/raiminiscence-mcp/README.md](../../packages/raiminiscence-mcp/README.md)

Component-level detail: schemas, algorithms, and per-tool call sequences.
File paths are given throughout — this doc trades a small amount of
rot-risk (paths can drift as the code moves) for being able to jump
straight from a diagram to the real implementation. For system-level
architecture, see the [HLD](./hld.md); for the same behaviour told
scenario by scenario, see [Flows](./flows.md).

## Memory frontmatter schema

Defined in [`packages/raiminiscence-mcp/src/core/types.ts`](../../packages/raiminiscence-mcp/src/core/types.ts),
assembled by [`createFrontmatter()`](../../packages/raiminiscence-mcp/src/core/create-frontmatter.ts)
(shared by `remember` and Promotion so the two never diverge):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` (ULID) | Also the filename. |
| `schemaVersion` | `number` | Currently `3` (bumped from `2` in v11 for the additive `writer` field); no migration tooling yet. |
| `kind` | `"episodic" \| "semantic" \| "decision" \| "checkpoint"` | Fixed at write time. `"checkpoint"` since v13 (ADR-0020) — see [Checkpoint & `currentFocus` (v13)](#checkpoint--currentfocus-v13). |
| `confidence` | `"verified" \| "observed" \| "inferred" \| "stale" \| "retracted"` | See [Confidence Tier weighting](#confidence-tier-weighting). |
| `isError` | `boolean` | Doubles the effective base half-life (Error Amplification). |
| `createdAt` | ISO 8601 string | — |
| `lastRecalledAt` | ISO 8601 string \| `null` | Decay anchor; reset by every `recall` hit. |
| `recallCount` | `number` | Incremented by every `recall` hit (Spaced Repetition). |
| `consolidationSurvivalCount` | `number` | Incremented when a Memory survives Promotion as a contributor. |
| `baseHalfLifeDays` | `number` | Set once from the Kind default at write time (`BASE_HALF_LIFE_DAYS` in `types.ts`: episodic 7, semantic 30, decision 21, checkpoint 3 — v13). |
| `retractedAt` / `retractReason` | ISO 8601 string \| `null` / `string \| null` | Set by `forget`. |
| `source` | `{ client: string; model?: string }` | `client` is derived from the MCP session handshake, never a caller input. |
| `scope` | `"project" \| "global"` | — |
| `originatingProject` | `string \| null` | Set only for `scope: "global"` — see [Project-root & scope resolution](#project-root--scope-resolution). |
| `promotedFrom` | `string[] \| null` | Set only on a Semantic Memory created by Promotion. |
| `relatedFiles` | `string[] \| null` | Optional, set by `remember`; anchors a Decision Memory to specific files for git-based Invalidation. A Memory left `null`/empty here is instead the exact candidate pool Commit Invalidation (v9) checks. |
| `staleAt` / `staleReason` | ISO 8601 string \| `null` / `string \| null` | Set by Invalidation when a related file changes after `createdAt`, by Promotion Audit (v8) when a Semantic Memory's `promotedFrom` contributors later contradict or turn net-negative, or by Commit Invalidation (v9) when a qualifying commit-subject's extracted target appears in an unanchored Memory's body (`consolidate.ts`). |
| `positiveFeedbackCount` / `negativeFeedbackCount` | `number` | Incremented by `feedback`; extends/shrinks effective half-life (Outcome Feedback) without ever changing Confidence Tier. |
| `writer` | `{ gitName?: string; gitEmail?: string; sessionId: string } \| undefined` | v11 (ADR-0018): optional, absent on any pre-v11 Memory. `gitName`/`gitEmail` from local `git config` at write time (best-effort, `undefined` on any failure); `sessionId` a `ulid()` generated once per MCP server process and reused by every write that process makes ([`writer-identity.ts`](../../packages/raiminiscence-mcp/src/core/writer-identity.ts)). |

Body: a mandated one-line summary as the first line, freeform detail
after. `summaryOf` in
[`memory-view.ts`](../../packages/raiminiscence-mcp/src/core/memory-view.ts)
returns the first line; `detail` is the whole body
([ADR-0033](../adr/0033-recall-returns-the-whole-memory-body.md)).

## Storage layout

[`storage.ts`](../../packages/raiminiscence-mcp/src/core/storage.ts):

```
<storageRoot>/.raiminiscence/memory/
├── episodic/<ulid>.md
├── semantic/<ulid>.md
├── decisions/<ulid>.md
├── checkpoints/<ulid>.md             # v13 (ADR-0020) — KIND_DIRS.checkpoint
├── embeddings/<memoryId>.json        # one file per record — see below (v11; was one packed embeddings.json through v10)
├── co-access/<sortedPairKey>.json    # no longer read or written (ADR-0037); left by older versions
└── conflict/<sortedPairKey>.json     # one file per record (v11; was one packed conflict.json through v10)
```

`writeMemory` auto-appends a `.raiminiscence/` entry to `<storageRoot>/.gitignore`
on first write (only if a `.git` directory exists there and no matching
rule is present already) — moot once Shared Memory (v11) turns
`.raiminiscence/memory/` into a tracked git worktree, since a `.gitignore`
entry only governs whether the parent repo's *own* branches track the
directory, not the worktree's own branch. `findMemoryById` scans all four
Kind subdirectories since a caller (e.g. `forget`) doesn't know a Memory's
Kind up front.

`<storageRoot>` is resolved differently depending on Scope — see
[Project-root & scope resolution](#project-root--scope-resolution). See
[Shared Memory (v11)](#shared-memory-v11) below for the per-record file
format, the git worktree wiring, and the merge driver.

## Decay & Strength scoring

[`decay.ts`](../../packages/raiminiscence-mcp/src/core/decay.ts) — a
pure function of frontmatter + an explicit `now`, never the system clock
directly:

```
anchor            = lastRecalledAt ?? createdAt
rawBonusDays      = (recallCount + consolidationSurvivalCount) × 2 + positiveFeedbackCount × 5
ceilingDays       = 4 × baseHalfLifeDays
boundedBonusDays  = ceilingDays × (1 − 0.5 ^ (rawBonusDays / 30))
effectiveHalfLife = max(1, baseHalfLifeDays × (isError ? 2 : 1)
                    + boundedBonusDays − negativeFeedbackCount × 5)
effectiveElapsed  = max(0, daysSince(anchor) − 14)     // 14-day grace period
strength          = 0.5 ^ (effectiveElapsed / effectiveHalfLife)
```

- **Grace period** (`DECAY_GRACE_PERIOD_DAYS = 14`): subtracted from
  elapsed time before the exponent applies — a normal absence erodes
  nothing.
- **Error Amplification** (`ERROR_AMPLIFICATION_MULTIPLIER = 2`): doubles
  the base half-life for `isError: true` Memories.
- **Spaced Repetition** (`SPACED_REPETITION_BONUS_DAYS = 2`): contributes
  +2 raw bonus-days per `recallCount` *and* per
  `consolidationSurvivalCount` — a Memory that keeps proving useful, or
  keeps surviving Promotion as a contributor, decays more slowly. This
  raw sum feeds the Reinforcement Ceiling below rather than extending
  effective half-life directly.
- **Reinforcement Ceiling** (`REINFORCEMENT_CEILING_MULTIPLIER = 4`,
  `REINFORCEMENT_HALF_SATURATION_DAYS = 30`, v12): Spaced Repetition's
  and Outcome Feedback's *positive* raw bonus-days are summed, then
  squashed through a smooth diminishing-returns curve that approaches —
  but never exceeds — `4 × baseHalfLifeDays`, reaching half of that
  ceiling at 30 raw bonus-days. Replaces what was previously unbounded,
  flat per-event growth on both mechanisms (see
  [ADR-0019](../adr/0019-v12-reinforcement-ceiling.md)). Outcome
  Feedback's negative term is untouched by this ceiling — it's bounded
  only by the existing hard floor below.

### Confidence Tier weighting

`CONFIDENCE_WEIGHT` (same file) — not pinned by the spec, chosen to be
monotonic with trust level:

| Tier | Weight |
| --- | --- |
| `verified` | `1.0` |
| `observed` | `0.85` |
| `inferred` | `0.7` |
| `stale`, `retracted` | *excluded entirely* — never weighted, never ranked (`EXCLUDED_CONFIDENCE_TIERS`, applied via `isActive()` in [`memory-view.ts`](../../packages/raiminiscence-mcp/src/core/memory-view.ts)) |

Final `recall` ranking score: `fused × strength × confidenceWeight`, where
`fused = 0.5 × minMax(similarity) + 0.5 × minMax(bm25)` over the candidate
pool ([ADR-0032](../adr/0032-recall-fuses-lexical-and-embedding-scores.md),
`core/lexical-scoring.ts`). `similarity` is cosine similarity when embeddings
are available, else the lexical fallback score — see [Embedding provider & packed index](#embedding-provider--packed-index).
With no query embedding nothing is fused and `similarity` ranks alone.
`minScore` gates on `similarity × strength × confidenceWeight`, never on the
pool-relative fused score; a fused-score tie falls back to that raw score.

## MCP tool flows

All eight tools are registered in
[`server.ts`](../../packages/raiminiscence-mcp/src/server.ts) via a
shared `handle()` wrapper: any thrown error becomes
`{ isError: true, content: [...] }` rather than a JSON-RPC failure.

### `remember`

![remember sequence: server.ts passes the call to engine.remember(), which redacts secrets, writes the Memory, embeds it and upserts the vector only when the embedding is not null, schedules a deferred consolidate() when the debounce is due, then returns the result to the agent](../images/lld-remember.svg)

A missing/unreachable embedding provider never blocks the write —
`embedded: false` is a normal outcome, not an error.

The diagram shows the library call, which writes the vector before it
returns. The MCP server's `remember` tool passes `embedInBackground`
([ADR-0041](../adr/0041-the-mcp-server-answers-remember-before-the-embed.md)):
it writes the Memory and its record cache line, answers with
`embedded: "pending"`, then embeds and writes the vector in the same
process. `core/pending-embeds.ts` tracks those writes per storage root.
`recall`, `inspect`'s query mode and Consolidation await them first, and
the server awaits them for up to 5 seconds when stdin closes. A failed
background embed is logged as a warning, and Consolidation's
Re-embedding step gives the Memory a vector on a later pass.

### `recall`

![recall sequence: engine.recall() embeds the query, reads cached embeddings and records, scores candidates through query-scoring.ts, keeps the top k, rewrites each result's recall fields, patches the cache and schedules opportunistic consolidation](../images/lld-recall.svg)

Zero matches → `{ results: [] }`, not an error. Every `RecallResultItem`
also carries `conflictCandidateWith?`/`conflictsWith?` (v5) — see
[Conflict Detection](#conflict-detection-conflict-edgets) below.

**v15** ([ADR-0022](../adr/0022-v15-inspect-side-effect-free-scoring-path.md)):
the actual scoring work — computing each candidate's scores and the
near-miss/exclusion-reason split — lives in
[`query-scoring.ts`](../../packages/raiminiscence-mcp/src/core/query-scoring.ts),
exporting one pure function, `scoreCandidatesForQuery`. `recall()` calls
it, slices the result to `k`, and performs its own mutation
(`writeMemory`) on that slice; Inspect's `inspectQuery()` (see
[`inspect` (v15)](#inspect-v15) below) calls the exact same function and
performs no mutations at all — this is what makes "provably the same
math" a property of the code, not just a claim.

A candidate qualifies when its raw similarity × Strength × Confidence
Tier weight clears `minScore`; qualifying candidates are ranked by the
fused similarity × the same weights ([ADR-0032](../adr/0032-recall-fuses-lexical-and-embedding-scores.md)).
Every `RecallResultItem` carries `surfacedVia`, always `"match"`.

Spreading Activation and Co-access Edges were removed in
[ADR-0037](../adr/0037-coaccess-and-spreading-activation-are-removed.md):
`recall` neither strengthens edges nor reads them, and `maxHops` is gone
from the tool schema and the project config. The `"connection-N"` members
of `SurfacedVia` stay in the type only so existing consumers still compile.

#### Conflict Detection (`conflict-edge.ts`)

New in v5. A **Conflict Edge** is a pair index — an unordered `pairKey`
(`pair-key.ts`), one file per pair under
`conflict/` (one packed `conflict.json` per Scope through v10) — but stores exactly one verdict per pair instead of an
accumulating weight: `"contradicts"`, `"supersedes"`, or `"no-conflict"`,
upsertable (a later call for the same pair always overwrites the
earlier verdict).

`recall`, once its top-`k` result set is finalised, compares every pair within that final
set — bounded to what's actually returned, not the full pre-filter
candidate pool, and reusing the embeddings already loaded for the call:

- No recorded verdict, and cosine similarity ≥ `CLUSTER_SIMILARITY_THRESHOLD`
  (0.82, the same constant Clustering uses — no new tunable; `clusterSimilarityThreshold` raises it to 0.87 for nomic's task-prefixed vectors, ADR-0042) → both items'
  `conflictCandidateWith` gets the other's id.
- A recorded `"contradicts"` verdict → both items' `conflictsWith` gets
  the other's id instead.
- A recorded `"supersedes"`/`"no-conflict"` verdict, a pair below the
  threshold, or either Memory missing a stored embedding → neither field.
- **v13** ([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)): either
  side being a Checkpoint Memory → neither field, unconditionally,
  regardless of cosine similarity — checked first, before the verdict/
  similarity checks above. Successive Checkpoints on the same evolving
  task are expected to be near-duplicates by construction, not a genuine
  disagreement. This is the one place Checkpoint needed a real new
  exclusion: Clustering/Promotion already operate exclusively on Episodic
  Memories, so Checkpoint is automatically outside their candidacy with no
  code change, but Conflict Candidate detection isn't Kind-scoped
  otherwise.

`overview` performs the same `conflictsWith` lookup among its own
returned set, but never computes `conflictCandidateWith` — it has no
query-time similarity computation to surface a new candidate from.

The `conflict` tool (below) is the only way a verdict gets recorded — the
*server* only ever surfaces candidates via cosine similarity; judging
whether two claims actually disagree stays entirely with the calling
agent, so this feature adds no generative-model dependency.

**v15**: this pairwise computation is `query-scoring.ts`'s
`computeConflictFields`, called by `recall()` over its mutated,
sliced-to-`k` result set and by `inspectQuery()` over its own — same
function, same rules (including the Checkpoint exclusion), applied to
each caller's own final id set.

### `overview`

Query-less: same `isActive` filter and Strength computation as `recall`,
but restricted to `semantic`/`decision` Kinds, ranked by Strength alone
(no similarity term), top 5
(`OVERVIEW_KINDS`, `OVERVIEW_TOP_N` in
[`overview.ts`](../../packages/raiminiscence-mcp/src/core/overview.ts)).
Never triggers Consolidation (kept cheap and synchronous — see
[SessionStart hook flow](#sessionstart-hook-flow), which calls this
function directly). Each `OverviewResultItem` also carries `conflictsWith?`
(v5, no `conflictCandidateWith` — see
[Conflict Detection](#conflict-detection-conflict-edgets)).

**v13** ([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)):
`OverviewResult` also carries `currentFocus: { own: OverviewResultItem |
null; project: OverviewResultItem | null }` — see
[Checkpoint & `currentFocus` (v13)](#checkpoint--currentfocus-v13) below
for the full lookup.

### `forget`

![forget sequence: engine.forget() looks the Memory up; an unknown id throws, an already-retracted one returns alreadyRetracted true, otherwise it is rewritten with confidence retracted, retractedAt and retractReason](../images/lld-forget.svg)

Immediate exclusion from `recall`/`overview` (via the same `isActive`
filter); the file itself is only physically deleted later, by Pruning.

### `feedback`

Outcome Feedback (v2): reports whether a previously recalled Memory
actually helped. `feedback(id, wasHelpful, scope?)` →
`engine.feedback()` → `mutateMemoryById(effectiveRoot, id, ...)` in
[`storage.ts`](../../packages/raiminiscence-mcp/src/core/storage.ts),
incrementing `positiveFeedbackCount` (`wasHelpful: true`) or
`negativeFeedbackCount` (`false`) — never touching Confidence Tier.
Accepted regardless of the Memory's current tier, including
`stale`/`retracted`; a genuinely unknown id throws → `isError: true`, the
same `mutateMemoryById`-driven validation `forget` and `conflict` share.
`POSITIVE_FEEDBACK_BONUS_DAYS`/`NEGATIVE_FEEDBACK_PENALTY_DAYS` (both 5,
in [`decay.ts`](../../packages/raiminiscence-mcp/src/core/decay.ts)).
The positive term feeds the same shared Reinforcement Ceiling (v12,
see [Decay & Strength scoring](#decay--strength-scoring)) as Spaced
Repetition's own `+2` per `recallCount`/`consolidationSurvivalCount`,
rather than extending effective half-life unboundedly on its own. The
negative term is untouched by that ceiling — a floor
(`MIN_EFFECTIVE_HALF_LIFE_DAYS = 1`) keeps accumulated negative feedback
from driving effective half-life to zero or below.

### `conflict`

![conflict sequence: engine.conflict() checks both Memories exist and that a supersedes verdict names one of them, records the verdict through conflict-edge.ts, and for supersedes retracts the named Memory through engine.forget()](../images/lld-conflict.svg)

New in v5 (see [Conflict Detection](#conflict-detection-conflict-edgets)
above). Both ids are validated the same way `forget`/`feedback` already
do (`assertMemoryExists`, factored out of `mutateMemoryById` in
`storage.ts` so all three share one "no such Memory" error message). The
pair need not have been previously surfaced as a `conflictCandidateWith`
by any prior `recall` — any two existing ids are accepted. `"supersedes"`
calls `forget()` directly on the named `retractedId` rather than a
parallel retraction implementation; `"contradicts"`/`"no-conflict"` only
write the verdict, leaving both Memories' Confidence Tier and Strength
untouched. A later call for the same pair overwrites its previously
recorded verdict. v11: `upsertConflictVerdict` also attaches the calling
process's `writer` identity, and protects the write with an optimistic
compare-and-swap against same-instant local collisions with one retry —
see [Shared Memory (v11)](#shared-memory-v11) below.

### `consolidate`

See [Consolidation algorithm](#consolidation-algorithm) below for the
Clustering/Promotion/Pruning detail this wraps.

![consolidate sequence: for each scope, consolidate.ts re-embeds mismatched Memories, clusters and promotes episodic Memories, runs the promotion audit, commit invalidation, pruning and file invalidation, each mutating step only when not a dry run, then flushes Shared Memory](../images/lld-consolidate.svg)

### `inspect` (v15)

Read-only and diagnostic, never a Recall — see
[ADR-0022](../adr/0022-v15-inspect-side-effect-free-scoring-path.md) for
why it needs its own scoring path at all. Lives in
[`inspect.ts`](../../packages/raiminiscence-mcp/src/core/inspect.ts),
exporting three pure functions, all read via `storage.ts`/`recall-cache.ts`
directly (no writes anywhere in this module):

- **`inspectMemory(id, scope?)`** — a plain `findMemoryById` lookup, then
  `decay.ts`'s `computeStrength`/`computeReinforcement` (the latter
  factored out of `computeStrength` by this same version, so both share
  one formula rather than two copies) to report Strength, base/effective
  Half-life, Reinforcement Ceiling usage (`rawBonusDays`,
  `boundedBonusDays`, `ceilingDays`, and `percentUsed` derived from them),
  Confidence Tier, age, and the existing reinforcement counters
  (`recallCount`, `consolidationSurvivalCount`, `positiveFeedbackCount`,
  `negativeFeedbackCount`, `lastRecalledAt`). Throws the same "no such
  Memory" error every id-accepting tool throws for an unknown id.
- **`inspectQuery(query, opts)`** — calls `query-scoring.ts`'s
  `scoreCandidatesForQuery` (the same function `recall()` calls, over the
  same v14 active-only records cache) and returns its qualifying result
  set unmutated, in `RecallResultItem`'s exact shape (`surfacedVia`,
  `conflictsWith`, `conflictCandidateWith` reused verbatim, via the same
  `computeConflictFields`), plus every near-miss. A non-qualifying
  candidate from that same active pool gets
  `exclusionReason: "below-min-score"`; a `stale`/`retracted` Memory
  matching the same Kind filter — invisible to the active-only cache
  `scoreCandidatesForQuery` scores, so read separately via a second,
  uncached `readAllMemories` pass — gets `"stale"`/`"retracted"`
  respectively. Always fresh: there is no persisted record of a past
  `recall` call to reference instead (ADR-0022).
- **`browseMemories(filters)`** — filters by `kind`, `confidenceTier`, a
  `minStrength`/`maxStrength` threshold, `scope`, and a `since`/`until`
  `createdAt` range; sorted by Strength ascending by default. Reads every
  Memory Kind via a direct `readAllMemories` call, unfiltered by
  `isActive` — deliberately *not* the v14 records cache (which is
  active-only), the same reason `pruning.ts`/`invalidation.ts` already
  bypass that cache: listing `stale` Semantic Memories or Memories near
  Pruning (any Confidence Tier) is one of Inspect's own use cases.

![inspect sequence: id, query and list modes route to inspectMemory, inspectQuery and browseMemories; query mode reuses scoreCandidatesForQuery and reads stale or retracted near-misses uncached, and no mode writes anything](../images/lld-inspect.svg)

The `inspect` MCP tool's input is a discriminated union on which of `id` /
`query` / `list` is set — exactly one must be, both and neither are
rejected with a clear error at dispatch time (`server.ts`'s `runInspect`),
not via a Zod-level cross-field schema. `verbosity` (`"compact"` default,
or `"detailed"`) is a presentation-layer concern applied to the tool's
response and the CLI's formatted text alike, never part of the core
functions' own return shape: compact `inspectQuery` collapses `nearMisses`
to a count (`nearMissesHidden`) plus a rerun hint; compact `browseMemories`
trims each result to `{ id, kind, strength, confidence }`.

`raiminiscence-cli` (`packages/raiminiscence-cli/`) is a new workspace
package — the same `workspace:*` dependency pattern `raiminiscence-hooks`
already uses — with one bin, `raiminiscence-inspect`, that imports these
same three functions directly and formats them as terminal text
(box-drawing panels, plain-English glosses like "decaying about 3x slower
than an untouched Decision memory would"). `src/args.ts` does hand-rolled
flag splitting on top of `raiminiscence-argv`'s `flag` (no arg-parsing
library, the same helper `raiminiscence-hooks/src/run-install-cli.ts`
uses), with flag values validated by `raiminiscence-argv`'s `flag-value-schema.ts`: a bare positional
argument is an id lookup, `--query="..."` is query-explain mode, `--list`
(with `--kind=`/`--tier=`/`--min-strength=`/`--max-strength=`/`--scope=`/
`--since=`/`--until=`) is browse mode, `--detailed` toggles full verbosity
on any mode; a nonsensical combination (e.g. a bare id with `--list`) is
rejected the same way the MCP tool rejects it. `src/run.ts` is the
testable orchestration layer (fixture-storage-root tests call it
directly); `src/inspect-cli.ts` is the thin shebang entry point.

## Consolidation algorithm

[`consolidate.ts`](../../packages/raiminiscence-mcp/src/core/consolidate.ts)
sequences six independently-tested concerns, each in its own module —
[`reembedding.ts`](../../packages/raiminiscence-mcp/src/core/reembedding.ts)
(v17, Re-embedding),
[`clustering.ts`](../../packages/raiminiscence-mcp/src/core/clustering.ts)
(Clustering + Promotion),
[`promotion-audit.ts`](../../packages/raiminiscence-mcp/src/core/promotion-audit.ts)
(v8, Promotion Audit),
[`commit-invalidation.ts`](../../packages/raiminiscence-mcp/src/core/commit-invalidation.ts)
(v9, Commit Invalidation),
[`pruning.ts`](../../packages/raiminiscence-mcp/src/core/pruning.ts), and
[`invalidation.ts`](../../packages/raiminiscence-mcp/src/core/invalidation.ts)
— and merges their counts per scope:

**Re-embedding** (`mismatchedEmbeddings`/`reembedMismatched`, in
`reembedding.ts`, v17, [ADR-0024](../adr/0024-v17-embedded-provider.md))
— runs first, ahead of everything below, so no later step reasons about a
mismatched vector. `mismatchedEmbeddings` filters the cached active-Memory
list down to those with a stored embedding whose recorded
`EmbeddingProviderIdentity` (`provider` + `model`) isn't
`identitiesCompatible` with the `embeddingProvider` this `consolidate()`
call was given (`params.embeddingProvider ?? defaultProvider()` — the same
provider `remember`/`recall` used for the call that triggered this
opportunistic pass, threaded through `triggerOpportunisticConsolidation`,
or the server's own configured provider for an explicit tool call). A
Memory with no stored embedding at all is never a candidate — it's simply
unembedded, unchanged from before v17. When not `dryRun`,
`reembedMismatched` calls `embeddingProvider.embed(memory.body)` for each
candidate and, on a non-`null` result, `upsertVector`s the healed
vector + identity; a `null` result (provider unreachable) leaves that
Memory's old vector/identity untouched, to be retried on a future pass.
Any Memory actually healed invalidates the embeddings cache (via
`upsertVector`'s own writer), so `consolidate.ts` re-reads
`getCachedEmbeddings` before `clusterEpisodicMemories` runs — Clustering
below always sees the healed vector, never the stale one, within the same
pass. `dryRun` reports `mismatched.length` as `memoriesReembedded` without
calling `embed()` or mutating anything. This is a to-and-fro transition,
unlike every other step below — a healed Memory becomes indistinguishable
from one that always matched, rather than moving to a one-way `stale`/
deleted state.

**Clustering** (`clusterEpisodicMemories`, in `clustering.ts`) — simple greedy single-pass
grouping, not full transitive-closure clustering: each not-yet-assigned
Episodic Memory (that has a stored embedding) seeds a cluster, pulling in
every other unassigned Memory whose cosine similarity to the seed is
`≥ clusterSimilarityThreshold(identity)`: 0.82, or 0.87 for nomic's task-prefixed vectors (ADR-0042). A "cluster" of size 1 doesn't
count — only groups of 2+ are returned. Memories with no stored
embedding (never embedded, or the provider was unreachable at write
time) can't be clustered. **v17** — a seed/candidate pair whose stored
`EmbeddingProviderIdentity`s aren't `identitiesCompatible` is silently
skipped before the similarity check runs, the same as either side having
no stored embedding at all (never counted as blocked); Re-embedding
(above) already heals any Memory it could reach earlier in the same
pass, so a mismatch reaching this point means the provider couldn't
re-embed it this run.

**v6** ([ADR-0011](../adr/0011-v6-conflict-edges-block-clustering.md))
— before the similarity check runs, a candidate carrying a confirmed
`"contradicts"` verdict against the seed (looked up in the same
`conflict/` store and `pairKey` scheme Conflict Detection
reads — see [Conflict Detection](#conflict-detection-conflict-edgets)) is
excluded from that Cluster unconditionally, regardless of similarity;
`"supersedes"`/`"no-conflict"`/no recorded verdict leave clustering
unchanged. The comparison is seed-to-candidate only, matching the
similarity check's own granularity — two non-seed members with their own
`"contradicts"` edge are not cross-checked. Prevention-only: a Semantic
Memory a prior run already promoted is never retroactively re-examined.
Each exclusion increments `blockedJoinAttempts` on the `consolidate`
result — once per blocked (seed, candidate) attempt, not per distinct
Memory.

**v7** ([ADR-0012](../adr/0012-v7-feedback-excludes-clustering-candidates.md))
— before `clusterEpisodicMemories` is even called, `consolidate.ts`
applies one more predicate to the episodic candidate pool it already
built (`isActive` and not-already-promoted): exclude any Memory where
`negativeFeedbackCount > positiveFeedbackCount` ("net-negative"), reading
both fields straight off frontmatter and defaulting a missing value to
`0` (the same `?? 0` convention `computeStrength`/`decay.ts` already
uses). Unlike v6's gate, this is a property of one Memory rather than a
relationship between two, so it's checked once per Memory up front,
before the seed/candidate loop runs at all — a net-negative Memory can
neither seed a Cluster nor join one. It composes with v6's gate without
either knowing about the other: this filter runs first and shrinks the
pool; v6's seed-to-candidate `"contradicts"` check then runs unchanged
against whatever remains. Prevention-only, same as v6: a Semantic Memory
a prior run already promoted from a Memory that only later turned
net-negative is left untouched, with no retroactive scan of
`promotedFrom` ids. Net-feedback status is recomputed fresh from current
counts on every run, so a Memory excluded on one Consolidation pass
becomes eligible again on a later pass if enough positive feedback
subsequently arrives. Each distinct Memory removed by this filter
increments `feedbackExcludedCount` on the `consolidate` result — once
per Memory, not per attempt, unlike `blockedJoinAttempts`.

**Re-promotion guard** (`alreadyPromotedIds`, in `clustering.ts`) — before clustering, every
existing Semantic Memory's `promotedFrom` array is unioned into a set;
episodic candidates already in that set are excluded from clustering.
Without this, the opportunistic inline trigger (which runs on every
`remember`/`recall`) would re-detect the same cosine-similar group and
mint a duplicate Semantic Memory on every subsequent call.

**Promotion** (`promoteCluster`, in `clustering.ts`) — one new Semantic Memory per cluster:
`confidence: "inferred"`, `promotedFrom` set to the contributing
Episodic ids, body synthesized as `"Consolidated pattern from N related
observations."` followed by the contributors' summary lines joined with
`"; "`. Each contributing Memory's `consolidationSurvivalCount` is
incremented (extending its own effective half-life — see
[Decay & Strength scoring](#decay--strength-scoring)) and rewritten to
disk; the contributors themselves are **not** deleted or altered
otherwise.

**Promotion Audit** (`eligibleForPromotionAudit`, in `promotion-audit.ts`,
v8, [ADR-0013](../adr/0013-v8-promotion-audit-retroactively-stales-semantic-memories.md))
— runs after Promotion (so it can see Semantic Memories minted earlier in
this same run) and before Pruning (so it sees Conflict Edges and feedback
counts before Pruning can delete a contributor, and with it that
contributor's Conflict Edges, in the same pass). Unlike v6/v7, which only
ever gate Clustering at the moment it runs, Promotion Audit looks
backward: it re-examines every currently-active (`isActive`) Semantic
Memory's `promotedFrom` contributors against Conflict Edge and Outcome
Feedback state *as it stands now*, not as it stood at Promotion time.

- **Conflict-Edge check**: every unordered pair within `promotedFrom` is
  looked up in the same `conflict/`/`conflictVerdict` store v6's gate
  already uses. This is deliberately
  all-pairs, not seed-to-candidate like live Clustering — `promotedFrom`
  is a flat `string[]` with no seed identity preserved past Promotion, so
  an all-pairs check is the only shape that doesn't invent an ordering
  contract nothing else relies on. As a side effect this also catches
  ADR-0011's own named non-seed blind spot for already-promoted data.
- **Feedback check**: any `promotedFrom` id that currently resolves to an
  Episodic Memory with `isNetNegativeFeedback` true (unchanged from v7)
  flags the Semantic Memory.
- **Missing contributors**: a `promotedFrom` id no longer resolving to any
  Memory (already removed by an earlier Pruning pass) is silently skipped
  by both checks — not an error, not a separate flagged state.
- **Transition**: a flagged Semantic Memory has `confidence` set to
  `"stale"`, with `staleAt`/`staleReason` set — the same frontmatter
  fields and the same `stale` transition Invalidation performs, but
  recorded as Promotion Audit's own evidence rather than folded into
  Invalidation, which stays anchored to Related Files/git evidence
  specifically. A Semantic Memory flagged by both signals in the same run
  transitions to `stale` once.
- **Stateless**: every `consolidate` call re-derives the candidate pool
  and re-runs both checks from scratch — no watermark field, no
  `schemaVersion` bump. An already-stale/retracted Semantic Memory is
  excluded from the candidate pool by the same `isActive` guard
  Invalidation uses, so it's never reprocessed.
- **Result counts**: `promotionAuditConflictCount` and
  `promotionAuditFeedbackCount` — each counts distinct Semantic Memories
  flagged by that signal this run; a Memory hit by both is counted in
  both fields. Deliberately two separate counts, never combined, and
  deliberately not named anything containing "Invalidated" — matching
  v7's standing discipline against conflating what two distinct
  mechanisms count.

**Commit Invalidation** (`eligibleForCommitInvalidation`, in
`commit-invalidation.ts`, v9,
[ADR-0014](../adr/0014-v9-commit-invalidation.md)) — runs after Promotion
Audit and before Pruning, mirroring Promotion Audit's own precedent, so a
Memory eligible for Pruning in the same pass is still evaluated by Commit
Invalidation before Pruning's deletion loop can remove it. Where existing
Invalidation only ever protects a Memory anchored with `relatedFiles`,
Commit Invalidation covers the exact complement: every currently-active
Memory of any Kind whose `relatedFiles` is `null`/empty.

- **Commit lookup**: `commitSubjects` (real default
  `gitCommitSubjects`, in `git.ts`; an injectable override in tests) is
  queried once for the whole pass — a single unbounded `git log` call
  reading each commit's timestamp and subject line only, never a diff or
  message body. Never throws: a non-repo or unreachable git binary yields
  an empty list, matching `gitFileChangeTimestamps`'s own behaviour.
- **Extraction**: a small set of regexes recognises four commit-subject
  shapes — `migrate/switch/move/convert/transition/upgrade ... from X to
  Y`, `replace X with Y`, `deprecate X`, `remove/drop X` — and always
  captures the outgoing target X, never the incoming replacement Y.
- **Guardrail**: an extracted target shorter than 3 characters, or one of
  a small stopword set (`the`, `a`, `it`, …), is rejected before any
  matching runs — more load-bearing here than it would be for a
  fuzzy-matching approach, precisely because plain substring matching was
  chosen (see the ADR).
- **Matching**: for each eligible Memory, for each qualifying commit dated
  after that Memory's own `createdAt`, the extracted target is checked
  against the Memory's full body (summary line plus freeform detail) as a
  case-insensitive, word-boundary-matched substring (`\btarget\b`) — so
  `"vite"` matches `"Vite"` but never the `"vite"` inside `"invite"`.
- **Transition**: a flagged Memory has `confidence` set to `"stale"`, with
  `staleAt`/`staleReason` set — the same frontmatter fields Invalidation
  already introduced in v2, naming the triggering commit's extracted
  target. No new schema field, no `schemaVersion` bump.
- **Stateless**: every `consolidate` call re-derives the candidate pool
  and re-scans commit history from scratch — no watermark, no
  "last-scanned-commit" field. An already-stale/retracted Memory is
  excluded from the candidate pool by the same `isActive` guard existing
  Invalidation uses, so it's never reprocessed.
- **Result count**: `memoriesCommitInvalidated` — distinct Memories staled
  by this mechanism this run, kept separate from `memoriesInvalidated`;
  the two never compete, since their candidate pools are exact
  complements of each other.
- **Unconditional**: no separate MCP tool, no config flag — matching
  every gate since v5.

**Pruning** (`eligibleForPruning`, in `pruning.ts`) — runs after Commit
Invalidation in the same pass (so a freshly-bumped survivor's extended
half-life applies before its own eligibility is checked, and so Promotion
Audit and Commit Invalidation both see a Memory's Conflict Edges/content
before Pruning can sweep it away), across
**all** Kinds and Confidence Tiers: any Memory whose
`computeStrength(...) < PRUNE_STRENGTH_THRESHOLD (0.05)` is physically
deleted (`storage.ts`'s `deleteMemory`, called from `consolidate.ts`), and every index entry
referencing it is dropped alongside the file: `removeVector` (packed
embedding) and `removeConflictEdgesForId` (v5) — neither lives in `pruning.ts` itself, which only
computes *eligibility*; the cleanup calls are sequenced in
`consolidate.ts`.

**Invalidation** (`eligibleForInvalidation`, in `invalidation.ts`) — runs
after Pruning in the same pass: for each active Memory with a non-empty
`relatedFiles`, checks (via `gitFileChangeTimestamps`, or an injected
`fileChangeTimestamps` override for tests) whether any of those files'
most recent git commit postdates the Memory's `createdAt`. A match sets
`confidence: "stale"` plus `staleAt`/`staleReason` (the triggering
file(s)) — excluding it from `recall`/`overview` via the same `isActive`
filter Forget uses, without physically deleting it. Purely git-derived;
no filesystem-mtime or content-hash comparison.

**`scope: "both"`** runs the entire pipeline above independently against
the project root and the global root, then sums the result counters —
Clustering never sees memories from both scopes at once.

**Opportunistic trigger** — `remember`/`recall` both call
`triggerOpportunisticConsolidation()` (in
[`opportunistic-consolidation.ts`](../../packages/raiminiscence-mcp/src/core/opportunistic-consolidation.ts)),
which schedules a full `consolidate({ scope, storageRoot,
globalStorageRoot })` via `setImmediate` — deferred past the current
call's return so the caller never waits on a full
Clustering/Pruning pass, with any failure caught and swallowed (this is
best-effort, not the explicit tool call). `overview` never triggers it at
all (no `triggerConsolidation` param); the hooks shim's own `recall()`
call (v10's per-turn auto-recall) passes `triggerConsolidation: false`
explicitly, opting out of a mechanism it would otherwise be eligible
for — see [SessionStart hook flow](#sessionstart-hook-flow) and
[Per-turn auto-recall hook flow](#per-turn-auto-recall-hook-flow-v10).

**v19** ([ADR-0025](../adr/0025-v19-opportunistic-consolidation-debounce.md)):
the trigger is debounced per storage root
([`opportunistic-consolidation.ts`](../../packages/raiminiscence-mcp/src/core/opportunistic-consolidation.ts)).
It fires only when 15 minutes (`OPPORTUNISTIC_CONSOLIDATION_INTERVAL_MS`)
or 20 calls (`OPPORTUNISTIC_CONSOLIDATION_CALL_THRESHOLD`) have passed
since the last real pass; otherwise it just counts the call. A store with
no completed pass on record is always due. The state lives in
`.raiminiscence/cache/`, local-only and never synced. Any completed
non-`dryRun` pass resets it, whatever triggered it. An in-process flag
also skips the trigger while a previously scheduled pass is still
running, so two passes never overlap in one process.

## Embedding provider & packed index

**Provider interface**
([`embeddings/provider.ts`](../../packages/raiminiscence-mcp/src/core/embeddings/provider.ts)):
`{ readonly identity: EmbeddingProviderIdentity; embed(text: string, role: EmbedRole):
Promise<number[] | null> }`, `role` `"query"` or `"document"` (ADR-0042) — `embed` never throws; `null` means
unreachable/misconfigured, a normal outcome. `identity` (`{ provider:
string; model: string; prompt?: string }`, v17; `prompt` ADR-0042) is synchronous and always set — reading it
never loads a model or otherwise triggers `embed`'s deferred work.
`identitiesCompatible(a, b)` (v17) is `true` when either side is the
`"unspecified"` sentinel (`UNSPECIFIED_IDENTITY` — `upsertVector`'s
default for the many pre-v17 callers/tests that insert a vector directly,
bypassing `remember`) or `provider`, `model` and `prompt` all match exactly,
an absent `prompt` included (ADR-0042). A nomic model's identity carries
`prompt: "nomic-task-prefix"`, and its `embed` puts `search_query: ` or
`search_document: ` before the text by `role`.

**Default provider** (`default-provider.ts`, v17,
[ADR-0024](../adr/0024-v17-embedded-provider.md)):
`createEmbeddingProviderFromConfig(resolveEmbeddingProviderConfig())`,
lazily constructed once per process. `config.provider === "embedded"`
(the default for a project with no `embeddingProvider` config at all —
see [Project-root & scope resolution](#project-root--scope-resolution))
constructs the **Embedded Provider**
([`embeddings/embedded.ts`](../../packages/raiminiscence-mcp/src/core/embeddings/embedded.ts)):
runs the ONNX port of `nomic-embed-text-v1` in-process via
`@huggingface/transformers` (a regular dependency since
[ADR-0028](../adr/0028-embedded-provider-runtime-is-a-regular-dependency.md),
`import()`ed dynamically by `core/adapters/feature-extraction.ts` so it only
loads when first used), lazily loading and memoising one
`feature-extraction` pipeline per provider instance; a missing runtime, a
model-load failure, or an inference error all resolve to `null`.
Otherwise (an explicit `"ollama"`, or a legacy bare `{ endpoint, model }`
block with no `provider` field) constructs the **Ollama Provider**
([`embeddings/ollama.ts`](../../packages/raiminiscence-mcp/src/core/embeddings/ollama.ts)):
`POST http://localhost:11434/api/embed` with model
`nomic-embed-text`, which truncates input past the model's context rather
than rejecting it as the legacy `/api/embeddings` does, and a 2-second
internal timeout via `AbortController`;
any non-OK response, malformed body, or timeout resolves to `null`
rather than throwing. Both providers' `identity.model` reflects whatever
model string was actually configured/constructed, not a hardcoded
literal.

**Warm model**
([`embeddings/warm-embed.ts`](../../packages/raiminiscence-mcp/src/core/embeddings/warm-embed.ts),
[ADR-0038](../adr/0038-a-running-server-keeps-the-embedded-model-warm-for-short-lived-callers.md)):

- **Server side.** With the Embedded Provider, `server.ts`'s `main`
  calls `serveWarmModel`. It listens on
  `~/.raiminiscence/run/embed-<hash>.sock`, where the hash covers the
  provider and model, and starts loading the model at once.
- **Protocol.** One request line `{ "text" }`, one reply line
  `{ "identity", "vector" }`, through `core/adapters/local-socket.ts`,
  the only module that imports `node:net`. Both lines are validated in
  `warm-embed-schema.ts`.
- **Client side.** `defaultProvider()` wraps an Embedded Provider in
  `createWarmEmbeddingProvider`. It asks the socket first and uses the
  reply only when the identity matches exactly and the vector is a
  non-empty list of finite numbers. Otherwise, or after 250 ms, it embeds
  locally.
- **Ownership.** A live socket is left to its owner and a dead one is
  replaced. The `run` directory is created `0700`. The server listens on
  a private path and renames it into place, because Node unlinks a
  socket's listen path on close. `owned()` compares the file's inode with
  the one it created. The listener is `unref`'d, and the socket file is
  removed on close or process exit while it is still the server's.
- **Warm process**
  ([`warm-process.ts`](../../packages/raiminiscence-mcp/src/core/warm-process.ts),
  [`warm-spawn.ts`](../../packages/raiminiscence-mcp/src/core/warm-spawn.ts),
  [ADR-0040](../adr/0040-the-hook-starts-a-warm-process-when-no-server-runs.md)).
  When no server answers, the hook recalls locally, then calls
  `startWarmProcess` from `raiminiscence-mcp/recall-client`. It claims
  `~/.raiminiscence/run/warm-<hash>.spawned` with an exclusive create, at
  most once a minute, and spawns `dist/warm.js` detached through
  `core/adapters/detached-process.ts`. `warm.ts` waits for the hook's pid
  to exit before importing `core/warm-process-main.ts`. `runWarmProcess` serves the
  recall socket, then the embed socket. It stops when another server
  already serves the recall, when its socket is replaced, after a
  request from another package version, or after 30 idle minutes.
- **Off** on Windows and when `RAIMINISCENCE_WARM_EMBED=off`. The test
  setup sets it, so no test reaches a developer's running server.

**Packed index**
([`embeddings/packed-index.ts`](../../packages/raiminiscence-mcp/src/core/embeddings/packed-index.ts)):
one JSON file per Memory id under `.raiminiscence/memory/embeddings/`
(`<memoryId>.json`, shape `{ vector: number[]; identity:
EmbeddingProviderIdentity; updatedAt: string }` — the `identity` field
added v17; through v16 it was `{ vector: number[]; updatedAt: string }`;
through v10 this was one shared `embeddings.json` blob, `Record<id,
number[]>`), not stored inline in each Memory's frontmatter.
`readPackedIndex` still assembles every record back into that same
`Record<id, EmbeddingRecord>` shape for every caller — the per-record
split is storage-layer only, no external signature changed beyond the
v17 `identity` addition. `upsertVector` defaults `identity` to
`UNSPECIFIED_IDENTITY` when not passed explicitly (real callers —
`remember`, Re-embedding — always pass their provider's real identity);
`removeVector` keeps the index in sync with `remember`/Pruning.
`cosineSimilarity(a, b)` returns `0` for mismatched-length or
zero-magnitude vectors rather than dividing by zero — callers check
`identitiesCompatible` themselves first (Clustering, Re-embedding);
`cosineSimilarity` itself has no identity awareness.

**Fallback scoring** — `recall` embeds the query once; if that fails,
every candidate is scored via `naiveScore` (case-insensitive
token-overlap ratio against the body) instead of cosine similarity, and
the response's `usedFallback: true` reports this. A candidate Memory
that individually lacks a stored vector (even when the query itself
embedded successfully) also falls back to lexical scoring for that one
comparison. **v17** ([`query-scoring.ts`](../../packages/raiminiscence-mcp/src/core/query-scoring.ts),
shared by `recall`/`overview`/`inspect`): a candidate whose stored
`identity` isn't `identitiesCompatible` with the query embedding's own
`identity` (the calling `EmbeddingProvider`'s current identity) is
treated exactly like that candidate having no stored vector at all —
lexical fallback for that one comparison, never a cosine-similarity
comparison across incompatible vector spaces. Re-embedding (see
[Consolidation algorithm](#consolidation-algorithm)) is what eventually
heals a mismatched Memory back onto the semantic-scoring path; Recall
itself never re-embeds anything.

## Project-root & scope resolution

[`project-root.ts`](../../packages/raiminiscence-mcp/src/core/project-root.ts):

- **`detectProjectRoot(startDir)`** — walks up from `startDir` looking
  for the nearest `.git` directory (bounded to `MAX_WALK_DEPTH = 50`
  levels); falls back to `startDir` itself if none is found. Re-run
  fresh on every server start/tool call — never cached.
- **`resolveStorageRoot(startDir)`** — checks `startDir` for a
  `.raiminiscence.config.json` with a `storageRoot` field first (opt-in
  monorepo-subpackage isolation); otherwise defers to
  `detectProjectRoot`. This is what `server.ts` calls for every tool
  invocation's `storageRoot` parameter.
- **`resolveOriginatingProject(projectRoot)`** — parses
  `<projectRoot>/.git/config` for `[remote "origin"] url = ...` via a
  regex (no shelling out to the `git` binary); falls back to the
  absolute `projectRoot` path if no remote is configured or no `.git`
  exists.
- **`resolveEmbeddingProviderConfig(startDir)`** (v17,
  [ADR-0024](../adr/0024-v17-embedded-provider.md)) — reads the same
  `.raiminiscence.config.json`'s `embeddingProvider` block and resolves
  it to a discriminated `{ provider: "ollama" | "embedded"; ... }`: an
  absent block resolves to `"embedded"` (the new default for a project
  with no config at all); a block setting `endpoint`/`model` but omitting
  `provider` resolves to `"ollama"` (an existing pre-v17 config keeps
  meaning what it always meant); an explicit `provider` field always
  wins over both. `default-provider.ts`'s
  `createEmbeddingProviderFromConfig` reads this result to decide which
  provider to construct — see [Embedding provider & packed
  index](#embedding-provider--packed-index).
- **`effectiveStorageRoot(scope, location)`** — the actual read/write
  location for a given call, where `location` is a `StorageLocation`
  (`{ storageRoot, globalStorageRoot? }`, the `storageRoot`/
  `globalStorageRoot` data clump every scope-aware tool's params
  interface extends): `location.storageRoot` (the project root) for
  `scope: "project"`, or `location.globalStorageRoot ?? homedir()` for
  `scope: "global"` — a fixed, project-independent location so a global
  Memory is reachable from any project.
  `storageRoot` itself is always passed through unchanged for
  `originatingProject` computation, regardless of which root the write
  actually lands in.

## SessionStart hook flow

[`raiminiscence-hooks`](../../packages/raiminiscence-hooks) never talks
MCP — it calls the core engine's `overview()` as a plain function:

![SessionStart hook sequence: the shim resolves the storage root, asks primer.ts for an overview-based primer with a 2 second budget, asks shared-memory-sync.ts to set up and pull Shared Memory when enabled, and writes the combined additionalContext or an empty object](../images/lld-hook-session-start.svg)

`primer.ts` races the `overview()` call against a 2-second timer
(`DEFAULT_TIMEOUT_MS`) via `hook-utils.ts`'s shared `withTimeout`; on either a timeout or a thrown
error, `primerText` returns `""` and the shim emits `{}` — the session
starts unprimed that time, never blocked or errored. Output is always
summary-line-only (`formatSummaryLine`: `` `[${kind}, ${confidence}]
${summary}` ``), never full Memory detail. `overview()` itself never
triggers Consolidation, so this path stays cheap regardless of store
size. `sharedMemorySessionStartNote` (v11) runs after the primer and is
itself wrapped in its own try/catch — never throws, and a setup/pull
failure degrades to the same silent `""` the primer's own timeout does;
see [Shared Memory (v11)](#shared-memory-v11) below.

Identical shim/mechanism across all three clients for `SessionStart` —
only the hook-registration config format differs (JSON for Claude
Code/Cursor, TOML for Codex CLI); see
[`raiminiscence-hooks`'s README](../../packages/raiminiscence-hooks/README.md).

**v13** ([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)):
`primerText` appends up to two more lines from the same `overview()`
response's `currentFocus` field — `formatCurrentFocusLine("own", ...)` when
`currentFocus.own` is non-null, then `formatCurrentFocusLine("project",
...)` only when `currentFocus.project` is also non-null *and* its `id`
differs from `own`'s (the common non-Shared-Memory case has exactly one
writer, so the two are always the same Checkpoint and only the `own` line
appears). No second core call — `currentFocus` rides along on the
`overview()` call this flow already makes. See
[Checkpoint & `currentFocus` (v13)](#checkpoint--currentfocus-v13) below
for how `own`/`project` are computed.

## Per-turn auto-recall hook flow (v10)

Claude Code and Codex CLI only — Cursor's only per-turn hook,
`beforeSubmitPrompt`, can allow/block a prompt but not inject context
back into it, so Cursor keeps `SessionStart`-only priming
([ADR-0015](../adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)).
The same `shim.ts` binary now branches on the hook payload's
`hook_event_name`:

![UserPromptSubmit hook sequence: the shim resolves the storage root and calls prompt-recall.ts, which runs engine.recall() directly with triggerConsolidation false; results become summary lines, a timeout or error becomes an empty string](../images/lld-hook-prompt-recall.svg)

Every recalled Memory still resets its decay anchor (Spaced Repetition),
exactly as an explicit `recall` MCP call already does —
this is Recall itself, automatically triggered, not a separate
side-effect model. `prompt-recall.ts` uses the same shared `withTimeout`
as `primer.ts` (same 2-second `DEFAULT_TIMEOUT_MS`, same
fail-open-to-`""` behaviour), independent of whatever timeout budget the
host hook itself allows (Claude Code defaults `UserPromptSubmit` to 30s,
Codex CLI to 600s). `hook_event_name` values other than
`UserPromptSubmit` (including a missing one) fall through to the
`SessionStart`/`primer.ts` path above unchanged.

Installing this hook (`installPromptRecallHook` in
[`install.ts`](../../packages/raiminiscence-hooks/src/install.ts)) is
restricted to `PromptRecallHookClient` (`"claude-code" | "codex"`) at
the TypeScript type level — a narrower type than the three-client
`HookClient`/`HOOK_CLIENTS` that `installHook`/`SessionStart` still use —
so Cursor can't even be passed to it. No `matcher` is written (unlike
`SessionStart`'s reason-based one): `UserPromptSubmit` fires
unconditionally on every prompt. No config toggle exists for either
hook; the only "off switch" is not registering it.

## SessionEnd hook flow (v11)

Claude Code only — no other client's `SessionEnd` (or equivalent) hook
support is confirmed, mirroring how `UserPromptSubmit`/per-turn
auto-recall stayed Claude Code/Codex-only in v10. The same `shim.ts`
binary branches on `hook_event_name === "SessionEnd"` before falling
through to the `SessionStart`/`UserPromptSubmit` branches:

![SessionEnd hook sequence: the shim resolves the storage root and calls runSharedMemorySessionEnd, which waits for any in-flight opportunistic pass and pending push, then runs a full consolidate() with an awaited push for every project; failures are logged and swallowed, and the shim always prints an empty object](../images/lld-hook-session-end.svg)

**v19** ([ADR-0025](../adr/0025-v19-opportunistic-consolidation-debounce.md)):
the step is no longer gated on Shared Memory. For every project it first
waits for anything this process already started (an in-flight
opportunistic pass, then a pending fire-and-forget push), then runs a full
`consolidate({ storageRoot, awaitPush: true })`. That pass bypasses the
Opportunistic Consolidation debounce, like an explicit `consolidate` tool
call, and resets its clock. Its closing `flushSharedMemory()` is still a
no-op outside a Shared Memory worktree; inside one, the push is awaited
rather than fired and forgotten.

No `additionalContext` is ever returned — the session is ending, there's
nothing left to inject. `runSharedMemorySessionEnd` never throws, matching
every other hook step's fail-open contract: a failure is logged and
swallowed.
`installSessionEndHook` (`SessionEndHookClient = "claude-code"`) is
restricted the same way `installPromptRecallHook` is, at the type level.

## Stop hook flow (v13)

Claude Code and Cursor only — Codex CLI's `Stop`-hook continuation isn't
reliable yet, the same posture as v10's Cursor gap for per-turn
auto-recall ([ADR-0015](../adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)),
mirrored here for a different client/mechanism pair
([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)). The same
`shim.ts` binary branches on `hook_event_name === "Stop"` (Claude Code) or
`"stop"` (Cursor) before falling through to the `SessionStart`/
`UserPromptSubmit` branches:

![Stop hook sequence: checkpoint-nudge.ts reads the session's nudge state, counts the turn, and returns nothing for a stop-hook continuation, a client-specific nudge with a state reset when 15 minutes or 20 turns have passed, or nothing with updated state otherwise](../images/lld-hook-stop.svg)

`isCheckpointNudgeDue`/`checkpointNudgeOutput` (`checkpoint-nudge.ts`) are
pure — given `{ elapsedMs, turnsSinceNudge }` (and, for Claude Code,
`stopHookActive`) they never read a real clock or counter, which is what
makes them fast/deterministic to unit test. The stateful wrapper,
`checkpointNudge`, is the only piece that touches the filesystem — one
small JSON file per session under
`.raiminiscence/hooks-state/checkpoint-nudge/`, since each hook invocation
is a fresh process with nothing else to carry the turn count forward.
`CHECKPOINT_NUDGE_INTERVAL_MS` (15 minutes) and
`CHECKPOINT_NUDGE_TURN_THRESHOLD` (20 turns) are fixed constants, no
config surface. Never throws — any failure (including a corrupt or
unreadable state file) is swallowed and treated as "not due", matching
every other hook step's fail-open contract.

This is a *soft* suggestion only: a due nudge fires once, resets the
debounce state, and doesn't re-fire until the next threshold crossing —
whether or not the agent actually calls `remember` with
`kind: "checkpoint"` in response. Claude Code's own `stop_hook_active`
field is checked unconditionally before the debounce state, so a blocked
turn's own resulting `Stop` event can never trigger a second block (which
would otherwise risk running into Claude Code's default 8-block Stop-hook
cap). Cursor has no equivalent field; its `stop` hook's own `loop_limit`
(default 5 auto-follow-ups) is an independent safety net, but what
actually prevents this hook from re-firing on the very next `stop` event
is the same debounce-state reset every client shares.

`installStopHook` (`StopHookClient = "claude-code" | "cursor"`) is
restricted the same way `installPromptRecallHook` is, at the type level —
Codex can't be passed to it.

## Checkpoint & `currentFocus` (v13)

New Memory Kind ([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)):
`"checkpoint"`, a lightweight, personal continuity pointer refreshed
periodically (via the [Stop hook flow](#stop-hook-flow-v13) above) rather
than written once. Purely additive to `MemoryKind`'s domain — no
`CURRENT_SCHEMA_VERSION` bump, no migration.

- **Half-life**: `BASE_HALF_LIFE_DAYS.checkpoint = 3` — shorter than every
  other Kind, since each new Checkpoint instantly obsoletes the previous
  one for the lookup that matters, and a stale one should clear the
  Pruning threshold (0.05) sooner than a raw observation would.
- **`remember`**: accepts `kind: "checkpoint"` exactly like `"semantic"`/
  `"decision"` — no special-cased validation.
- **Clustering/Promotion**: no code change needed — both already read
  only `["episodic"]` (`consolidate.ts`), so a Checkpoint is automatically
  outside their candidacy.
- **Conflict Candidate detection**: a real new exclusion, since this check
  isn't Kind-scoped otherwise — see
  [Conflict Detection](#conflict-detection-conflict-edgets) above.
- **`overview`**: excluded from the default top-N (`OVERVIEW_KINDS` stays
  `["semantic", "decision"]`), but surfaced via a new `currentFocus` field
  instead:

![currentFocus sequence: engine.overview() reads checkpoint Memories, keeps active ones sorted newest first, takes the first as project focus and the first matching the writer identity as own focus](../images/lld-current-focus.svg)

`own`/`project` are fetched by `createdAt` descending — recency, not
Strength — a distinct lookup from `overview`'s existing top-N ranking, and
additive to it rather than displacing anything. `matchesWriter` compares
`memory.frontmatter.writer?.gitName`/`gitEmail` against the calling
process's own identity (`writerIdentityProvider`, the same one `remember`
already uses — see [Shared Memory (v11)](#shared-memory-v11) below) with
plain field equality and no special-casing for a missing `writer`: when
neither side has a real git identity, both are `undefined` and the
comparison succeeds anyway, which is exactly what makes the common
single-writer (non-Shared-Memory) case collapse to "`own` and `project`
are always the same Checkpoint" without any extra logic. Matching is
against `gitName`/`gitEmail` only, never `sessionId` — `sessionId` is
unique per MCP server process, and matching on it would defeat the whole
point of continuity across sessions. No new frontmatter field beyond the
Kind value itself — "most recent by `createdAt`" needs no explicit
chaining/`supersedes` pointer between successive Checkpoints.

## Shared Memory (v11)

Sharing is delivered entirely over git, not a new live-sync mechanism —
see [ADR-0017](../adr/0017-v11-shared-memory-via-git-worktree.md) and
[ADR-0018](../adr/0018-v11-shared-memory-writer-identity.md) for the full
design rationale. New module:
[`packages/raiminiscence-mcp/src/core/shared-memory/`](../../packages/raiminiscence-mcp/src/core/shared-memory/).

**Per-record storage** (prerequisite every other piece below depends on)
— [`record-index.ts`](../../packages/raiminiscence-mcp/src/core/record-index.ts)
replaces `packedJsonIndex.ts`'s one-blob-per-index-type storage (now
deleted) with one small JSON file per record:

```
readRecord<T>(storageRoot, indexName, key): T | undefined
writeRecord<T>(storageRoot, indexName, key, record): void
removeRecord(storageRoot, indexName, key): void
recordKeys(storageRoot, indexName): string[]
readAllRecords<T>(storageRoot, indexName): Record<string, T>
withRecord<T>(storageRoot, indexName, key, mutator): void
writeRecordIfUnchanged<T extends { updatedAt: string }>(storageRoot, indexName, key, expectedUpdatedAt, next): boolean
```

`conflict-edge.ts` and `embeddings/packed-index.ts` are rewritten against
this module (`conflict/` and `embeddings/` as their `indexName`s; Co-access
Edges used `co-access/` until ADR-0037 removed them), but every external
function signature (`upsertVector`, etc.) is unchanged as far as the
per-record storage swap itself goes — callers elsewhere in the codebase
(Consolidation, Clustering) needed no changes at all for it. `upsertConflictVerdict` separately gains
an optional trailing `writer` parameter for writer identity (below), a
distinct, backward-compatible change layered on afterward. Every record gains an
`updatedAt` ISO timestamp, set on every write — the field the merge
driver keys on. A pair key like `"01ABC...|01DEF..."` is filename-escaped
(`|` → `__`) since `|` isn't a safe filename character on every platform;
`recordKeys` decodes it back.

**Local write safety** — `upsertConflictVerdict` (`conflict-edge.ts`) gets
an optimistic compare-and-swap: read the target record's current
`updatedAt`, attempt `writeRecordIfUnchanged`; on a detected change,
re-read the fresh state and retry once; if that second attempt also
raced, the write applies unconditionally (no unbounded retry loop) —
same-machine, same-instant collisions between two local processes are
expected to be extremely rare.

**Writer identity** (ADR-0018) —
[`writer-identity.ts`](../../packages/raiminiscence-mcp/src/core/writer-identity.ts):
`createWriterIdentityProvider(sessionId = ulid())` returns a function that
re-reads `git config user.name`/`user.email` on every call (best-effort,
`undefined` on failure — never throws) but always reports the same
`sessionId`, generated once. `defaultWriterIdentityProvider` is a
module-level singleton, computed once per process — every `remember`/
`conflict` call in that process shares one `sessionId` unless a caller
injects its own provider (tests only). Threaded into `remember()`
(`MemoryFrontmatter.writer`) and `conflict()`
(`upsertConflictVerdict`'s `writer` param) only — not embeddings, since nothing consumes attribution on a purely
derived/mechanical signal.

**Opt-in & worktree setup** (ADR-0017) —
[`shared-memory/setup.ts`](../../packages/raiminiscence-mcp/src/core/shared-memory/setup.ts):

- `resolveSharedMemory(startDir)` (`project-root.ts`) reads
  `sharedMemory: boolean` from `.raiminiscence.config.json`. `false` by default.
- `isSharedMemoryWorktree(storageRoot)` — checks whether
  `.raiminiscence/memory/.git` exists as a *file* (a worktree checkout's
  `.git` is a file pointing at the real gitdir, unlike a normal repo's
  `.git` directory).
- `ensureSharedMemoryWorktree(storageRoot, git = runGit)` — idempotent,
  called from the `SessionStart` hook only when `resolveSharedMemory` is
  true: no-op if already a worktree; otherwise verifies git is runnable
  (throwing a clear, descriptive error if not — sharing genuinely cannot
  work without git, unlike Invalidation's silent-empty-list fallback);
  backs up any pre-existing local-only content to a temp dir; creates the
  `raiminiscence-memory` orphan branch if it doesn't exist locally or on
  `origin` (`git worktree add --orphan -b raiminiscence-memory <path>`) or
  fetches + checks out the existing one; registers the merge driver
  (below); restores the backed-up content as a new "seed shared memory"
  commit if there was any.
- `RunGit = (cwd, args) => string` (`shared-memory/git.ts`) mirrors
  `git.ts`'s `FileChangeTimestamps`/`CommitSubjects` injection pattern —
  real by default (`execFileSync`, stderr piped rather than inherited to
  keep normal operation quiet), swappable for a stub in tests.

**Merge driver** (ADR-0017) —
[`shared-memory/merge-driver.ts`](../../packages/raiminiscence-mcp/src/core/shared-memory/merge-driver.ts)
(`resolveMergeDriverConflict`, a pure function — no standalone test file,
exercised only via the real-git
integration test below) +
[`shared-memory/merge-driver-cli.ts`](../../packages/raiminiscence-mcp/src/core/shared-memory/merge-driver-cli.ts)
(the thin file-I/O wrapper git actually invokes via `merge.<name>.driver`
git config, registered automatically by `ensureSharedMemoryWorktree` —
never hand-configured). Given both conflicting sides of a record file
(`%A`/current, `%B`/other), parses each side's `updatedAt` and keeps
whichever is later, discarding the other entirely — never a field-level
union merge, never raw conflict markers. Falls back to keeping `%A`
(ours) unchanged when either side doesn't parse as JSON or lacks
`updatedAt` (e.g. a Memory file, which has no such field) — still counted
as a genuine conflict via `git merge`'s own `"Auto-merging <path>"` output
(see `pullSharedMemory` below), just resolved by a simpler rule than
recency. Scoped via a `.gitattributes` file committed into the shared
branch itself (`co-access/*`, `conflict/*`, `embeddings/*`, `*.md`, all
`merge=raiminiscence-memory`). `co-access/*` stays after ADR-0037 so edge
files from a machine on an older version still merge cleanly.

**Sync automation** (ADR-0017) —
[`shared-memory/sync.ts`](../../packages/raiminiscence-mcp/src/core/shared-memory/sync.ts):

![Shared Memory flush sequence: sync.ts does nothing outside a Shared Memory worktree; otherwise it stages, commits when anything is staged, pushes, retries with set-upstream when there is no upstream, and swallows a final push failure](../images/lld-shared-memory-flush.svg)

`pullSharedMemory(storageRoot, git = runGit)` (called from the
`SessionStart` hook, never silently in the background): a no-op if not a
Shared Memory worktree, or if `git fetch` fails (offline — silent, not an
error). Otherwise `git merge origin/raiminiscence-memory --no-edit`;
a merge failure *outside* the driver's own scope is a genuine error,
surfaced rather than swallowed. Compares HEAD before/after: unchanged →
`{ pulled: false, autoResolvedFiles: [] }` (nothing to reconcile); changed
→ `{ pulled: true, autoResolvedFiles }`, where `autoResolvedFiles` is
parsed from `git merge`'s own `"Auto-merging <path>"` output lines rather
than diffed after the fact — git prints one only for a path both sides
genuinely changed since diverging (exactly the paths a merge strategy, or
this driver for a path its `.gitattributes` scope covers, had to
reconcile); a path only one side touched merges in cleanly with no such
line, so a plain fast-forward or a merge that happens to bring in
unrelated new files both correctly report `autoResolvedFiles: []`. The
`SessionStart` hook appends a note naming these files to the session's
primer only when the list is non-empty.

**No new MCP tool** — everything above is internal to `consolidate()`
(`flushSharedMemory` called unconditionally at the end of every
`consolidateOneRoot`, itself a no-op for a non-shared-memory root) and the
hooks layer (`shared-memory-sync.ts`, `SessionStart`/`SessionEnd`); this
feature adds no new tool to the MCP surface.

**Testing** — two seams: the per-record
format, local write safety, and writer identity extend the existing
`conflict-edge.test.ts`/`engine.test.ts`/
`schema-v2.test.ts` suites (seam 1, no new test file); worktree setup, sync
automation, and the merge driver get one new file,
`shared-memory.test.ts`, run against real temporary git repositories end
to end — a mocked-out git layer would validate almost nothing about a
subsystem whose entire correctness is "does real git actually do what we
think" (seam 2, mirroring `benchmarks/`'s own precedent of real execution
over narrative claims). It needs `pnpm build` first, since the merge driver
runs as a real subprocess git invokes by path; its `beforeAll` fails
with that instruction when the build output is missing. It never
rebuilds `dist/` itself: that raced `raiminiscence-hooks`'
shim-contract suite, which loads the same `dist/` from a parallel worker.

## Fix Nudge & Open Failure (v18)

Claude Code only ([ADR-0023](../adr/0023-v18-fix-nudge-via-post-tool-use-hook.md)):
detects a configured **Watched Command** (`watchedCommands` in
`.raiminiscence.config.json`, resolved by `resolveWatchedCommands`
alongside `resolveSharedMemory`/
`resolveEmbeddingProviderConfig` — `[]` by default) going from failing to
succeeding within one session, and nudges the agent to call `remember`
with `isError: true` describing the failure and its fix. No Memory Kind,
schema, decay, Recall, or Overview change — the only new state is
**Open Failure**, hook-only bookkeeping deliberately separate from
Checkpoint (see [Checkpoint & `currentFocus`](#checkpoint--currentfocus-v13)
above): a per-session, per-Watched-Command-pattern record of `{ command,
stderrTail }`, never a Memory, never Recall/Overview/Inspect candidacy.

Unlike every other hook event this project wires (`SessionStart`/
`UserPromptSubmit`/`SessionEnd`/`Stop`), there is no single Claude Code
event covering both a Bash command's success and failure: `PostToolUse`
fires only once a tool call *succeeds*, while a failing one instead fires
the separate `PostToolUseFailure` event, whose payload shape differs (a
combined `error` string, `"Exit code N"` then interleaved stdout+stderr,
rather than a clean `stderr` field). `shim.ts` branches on both event
names before falling through to the `Stop`/`SessionStart` branches, and
translates each event's distinct shape into `fix-nudge.ts`'s
client-agnostic `{ command, exitCode, stderr }` outcome — restricted to
`tool_name: "Bash"` (any other tool is ignored), and an aborted
`PostToolUseFailure` (`is_interrupt: true`) is treated as no failure at
all, not a command failure worth tracking:

![Fix Nudge sequence: for Bash PostToolUse and PostToolUseFailure events, fix-nudge.ts matches the command against every watched pattern, records a failure's stderr tail, and on a later success of the same pattern clears the record and emits a nudge](../images/lld-hook-fix-nudge.svg)

`matchWatchedCommands`/`fixNudgeTransition`/`truncateStderrTail`/
`fixNudgeText` (`fix-nudge.ts`) are pure, mirroring `checkpoint-nudge.ts`'s
own pure-function-plus-injectable-state-store split — tested with a fake,
in-memory store, no real disk. `truncateStderrTail` keeps only the last 40
lines (the tail, not the head — that's where a compiler/test-runner's
actionable summary lives). A pattern is tried as regex first, falling back
to a plain substring test when it isn't valid regex syntax, so a command
retried with slightly different arguments still counts as the same
Watched Command. Several patterns matching the same command are tracked
independently, keyed within one per-session JSON file under
`.raiminiscence/hooks-state/fix-nudge/`. Never throws — any failure here
is swallowed, matching every other hook step's fail-open contract; a
nudge fires exactly once per failure→success transition, then the record
clears, so it never re-fires for the same fix.

`installFixNudgeHook` (`FixNudgeHookClient = "claude-code"`) is restricted
the same way `installSessionEndHook` is, at the type level — it merges
both the `PostToolUse` and `PostToolUseFailure` entries into
`.claude/settings.json` together (no `matcher`; Fix Nudge restricts to
`Bash` internally, in the shim itself, not via the hook registration).
Cursor's and Codex CLI's nearest equivalents (exit-code visibility plus
context injection, together) aren't confirmed against primary
documentation yet — the same posture as
[ADR-0015](../adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)'s
Cursor exclusion and [ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)'s
Codex CLI exclusion.

## Logging & error classification (`raiminiscence-mcp`)

[`adapters/logger.ts`](../../packages/raiminiscence-mcp/src/adapters/logger.ts) wraps
`pino`, writing to fd 2 (stderr) only — fd 1 is this server's MCP
JSON-RPC transport, so a log line on stdout would corrupt the protocol
stream. Level defaults to `info`, overridable via
`RAIMINISCENCE_LOG_LEVEL`. `server.ts` depends on the narrow
`ServerLogger` interface (`debug`/`info`/`warn`/`error`, each `(fields,
msg?)`), not `pino` directly, so a test injects a plain stub instead of
spinning up a real logger.

Every tool call is routed through `server.ts`'s `makeHandle(logger,
telemetry, sessionId)` → `handle(tool, run)`, which logs one `info` "tool call
started" line, a per-call `callId` (ULID) attached to every line so
concurrent calls in the same log stay distinguishable, and then one of:

- **Success** — an `info` "tool call finished" line with `durationMs`.
- **`OperationalError`** (`core/errors.ts`) — a deliberate, expected
  domain failure (bad input shape, an id that doesn't resolve, a state
  that doesn't allow the requested operation). Logged at `warn`, and its
  message is returned to the calling agent verbatim via `isError: true`.
- **Anything else (unexpected)** — logged at `error` with the full
  message, stack, and `cause`, then masked behind a generic `Internal
  error (<callId>). See server logs.` response — a maintainer can tie a
  bug report back to the exact log line via `callId` without leaking
  internals to the calling agent.

"Started" and "finished" both log at `info`, deliberately not "started"
at `debug` — a hung call (a start with no matching finish) needs to be
visible at the server's default log level, without an operator already
knowing to turn on `debug` first. Tool-execution errors always surface
as `isError: true` on the MCP response, never as a thrown JSON-RPC
error, regardless of which branch above produced them.

Each call is also one OpenTelemetry span, from
[`adapters/telemetry.ts`](../../packages/raiminiscence-mcp/src/adapters/telemetry.ts),
ended with the same outcome as the log line: `success`,
`operational-error` or `unexpected-error`. A failure's exception is
recorded on the span with an `ERROR` status. The same call increments
`raiminiscence.tool.calls` and records `raiminiscence.tool.duration`.
When an SDK is recording, the span's `traceId` goes on every log line
for that call. With no SDK registered, all of it is a no-op. Like the
logger, `server.ts` depends on the narrow `ServerTelemetry` interface,
so a test injects a stub.
[ADR-0030](../adr/0030-opentelemetry-api-only-with-operator-registered-sdk.md).
