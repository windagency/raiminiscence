# High-level design

[Back to README.md](../../README.md) • [Back to flows.md](flows.md) • [Back to lld.md](lld.md) • [Back to developer-guide.md](../developer-guide.md) • [Back to how-it-works.md](../how-it-works.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md) • [Back to packages/raiminiscence-mcp/README.md](../../packages/raiminiscence-mcp/README.md)

System-level architecture only — no code-level detail. For the
algorithms, schemas, and per-tool call sequences, see the
[LLD](./lld.md); for step-by-step runtime behaviour per scenario, see
[Flows](./flows.md).

> **Diagram note**: these are C4-style diagrams (Context and Container
> levels), drawn as theme-aware SVG files in `docs/images/`. Node labels
> carry the C4 element type (`[Person]`, `[Software System]`,
> `[Container]`) as plain text. Parallel edges between the same two
> containers are drawn as one connector with a combined label.

## System context (C4 level 1)

![System context: the developer installs, configures and inspects rAIminiscence; the AI coding agent calls its tools over MCP; rAIminiscence reads and writes the project filesystem, optionally embeds through Ollama, and optionally fetches and pushes a git remote for Shared Memory](../images/hld-context.svg)

**Actors**: the **developer** installs and configures rAIminiscence and
may hand-inspect memory files; the **AI coding agent** (running inside
Claude Code, Cursor, or Codex CLI) is the actual caller of the eight MCP
tools during a session.

**External dependencies**: since v17 the default Embedding Provider (the
Embedded Provider, `nomic-embed-text-v1` via `@huggingface/transformers`)
runs in-process inside the Core engine — no external system at all for a
project with no `embeddingProvider` config. **Ollama** is now an opt-in
alternate, selected by explicit configuration; a missing/unreachable
provider (either one) never blocks a write or a read, only degrades
`recall` to lexical-fallback scoring (`usedFallback: true`) and `remember`
to `embedded: false` ([ADR-0024](../adr/0024-v17-embedded-provider.md)).
The **project filesystem** is the only persistence
layer — no database, no vector store, no network service
([ADR-0001](../adr/0001-flat-file-markdown-storage.md)). The **git
remote** is v11's Shared Memory only, itself entirely optional — it's
reused git infrastructure the project already depends on, not a new
service ([ADR-0017](../adr/0017-v11-shared-memory-via-git-worktree.md)).

## Containers (C4 level 2)

![Containers: the agent reaches the MCP server over stdio and the hooks shim through command-type hooks; the developer runs the inspect CLI directly; the server, the shim and the CLI all call the core engine, which owns the Memory store and its indices, calls the shared-memory subsystem, and optionally embeds through Ollama; the shim also keeps its own nudge state files, and Shared Memory syncs the store with an optional git remote](../images/hld-containers.svg)

**`raiminiscence-mcp` server** — a thin MCP adapter (`server.ts`, on
the SDK wrapper in `adapters/mcp-server.ts`):
zod-validated tool schemas, session-handshake-derived `source.client`,
and a shared `handle()` wrapper that turns any thrown error into an
`isError: true` tool result rather than a JSON-RPC failure.

**Core engine** (`src/core/`) — a plain importable library with no MCP
dependency: storage read/write, decay/Strength scoring, redaction,
embeddings (the in-process Embedded Provider by default, v17;
Ollama as an opt-in alternate), Consolidation, project-root/scope
resolution. Deliberately factored this way so `raiminiscence-hooks` can
call `overview()` directly without going through MCP at all (confirmed
necessary — see
[LLD § SessionStart hook flow](./lld.md#sessionstart-hook-flow)).

**`raiminiscence-hooks` shim** — a separate package/binary
(`raiminiscence-hooks-shim`) invoked by each client's `SessionStart`-style
hook, and — for Claude Code and Codex CLI only, v10 — also by
`UserPromptSubmit`, firing `recall()` with that turn's prompt text as the
query instead of `overview()`, and — for Claude Code only, v11 — also by
`SessionEnd`, forcing a full, awaited `consolidate()` that also flushes
Shared Memory (v19, [ADR-0025](../adr/0025-v19-opportunistic-consolidation-debounce.md)), and — for Claude Code and Cursor
only, v13 — also by `Stop`/`stop`, firing a debounced checkpoint nudge.
Never talks MCP; imports `raiminiscence-mcp`'s public library functions
directly. One shared shim binary across all three target clients for
`SessionStart`, per [ADR-0005](../adr/0005-one-shared-hooks-package.md) —
only the hook-registration config format differs (JSON for Claude
Code/Cursor, TOML for Codex CLI). `UserPromptSubmit` breaks that
three-client parity: Cursor has no per-turn hook capable of injecting
context back into a turn, so it keeps `SessionStart`-only priming
([ADR-0015](../adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)).
`SessionEnd` (v11) is Claude Code only for the same reason `UserPromptSubmit`
isn't universal: no other client's equivalent hook is confirmed to exist.
`Stop`/`stop` (v13) is Claude Code and Cursor only — Codex CLI's own
`Stop`-hook continuation isn't reliable yet
([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)), the same
posture as ADR-0015's Cursor gap for a different client/mechanism pair.
For Claude Code only, v18 — also by `PostToolUse`/`PostToolUseFailure`,
firing Fix Nudge on a configured Watched Command's failure→fix transition
([ADR-0023](../adr/0023-v18-fix-nudge-via-post-tool-use-hook.md)). Two
events rather than one, since — unlike `Stop`/`stop` — no single Claude
Code event covers both a Bash command's success and failure. Cursor's and
Codex CLI's nearest equivalents aren't confirmed yet, the same posture as
the other two client gaps above.

**`raiminiscence-inspect` CLI (v15)** — a third package,
`raiminiscence-cli`, with one bin (`raiminiscence-inspect`), same pattern
as `raiminiscence-hooks`: imports `raiminiscence-mcp`'s public library
functions directly (`inspectMemory`/`inspectQuery`/`browseMemories`),
never talks MCP. Read-only and diagnostic — explains one Memory by id,
explains how a query would score right now, or browses/lists Memories by
filter — on a scoring path that never mutates `recallCount` or
`lastRecalledAt` the way `recall` itself does. The
same three functions are also registered as the eighth MCP tool, `inspect`,
so the agent can call it mid-session too
([ADR-0022](../adr/0022-v15-inspect-side-effect-free-scoring-path.md)).

**Flat-file store & per-record indices** — no database, no vector store;
one Markdown file per Memory. Through v10, three shared packed-JSON
indices per Scope (`embeddings.json`, `co-access.json`, `conflict.json`)
each held every record of their kind in one blob; v11 splits each into
one small file per record instead — `embeddings/<memoryId>.json`,
`co-access/<sortedPairKey>.json` (unused since
[ADR-0037](../adr/0037-coaccess-and-spreading-activation-are-removed.md)),
`conflict/<sortedPairKey>.json` — so
concurrent writers to *different* records never collide and the format
stays git-mergeable, the prerequisite Shared Memory needs
([ADR-0017](../adr/0017-v11-shared-memory-via-git-worktree.md)).

**`shared-memory/` subsystem (v11)** — a new subsystem alongside the core
engine's storage/index layer: one-time, idempotent opt-in setup
(`ensureSharedMemoryWorktree`, turning `.raiminiscence/memory/` into a
`git worktree` of a dedicated `raiminiscence-memory` orphan branch),
commit/push automation (`flushSharedMemory`, called at the end of every
`consolidate()`, including the one the `SessionEnd` hook forces), an explicit pull step (`pullSharedMemory`,
called from the `SessionStart` hook), and the recency-keyed merge driver
itself (a small script git invokes by path, registered automatically via
the worktree's `.gitattributes` + local git config as part of opt-in).
No new MCP tool — entirely hooks-layer and internal to `consolidate()`
([ADR-0017](../adr/0017-v11-shared-memory-via-git-worktree.md)).

**Checkpoint nudge (v13)** — a new module in `raiminiscence-hooks`
(`checkpoint-nudge.ts`), invoked from `shim.ts`'s `Stop`/`stop` dispatch: a
pure debounce decision (15 minutes or 20 turns since the session's last
checkpoint nudge, whichever comes first) plus a thin stateful wrapper that
persists per-session turn/time bookkeeping as one small JSON file per
session under `.raiminiscence/hooks-state/checkpoint-nudge/` — the only
way to track "turns since last nudge" across the fresh process each hook
invocation runs in. Its only core-engine dependency is
`ensureGitignoreEntry`, through the shared `hook-state-store.ts` (reused
for its own state directory, not the Memory store); it never calls `overview()`/`recall()` — the new
Checkpoint Memory Kind itself is written by the agent's own `remember`
call, prompted by this nudge, not by the hook. A no-op (`{}`) when not
due; otherwise a client-specific soft suggestion
(`{"decision":"block","reason":"..."}` for Claude Code,
`{"followup_message":"..."}` for Cursor) that never blocks/forces
compliance beyond that one suggestion
([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)).

## Package boundaries

![Package boundaries: raiminiscence-hooks modules and the raiminiscence-cli run module import raiminiscence-mcp's core or shared-memory exports; the shim and run import flag() from raiminiscence-argv; inside raiminiscence-mcp the MCP adapter calls the core, which calls the shared-memory subsystem](../images/hld-packages.svg)

`raiminiscence-hooks` and `raiminiscence-cli` each depend on
`raiminiscence-mcp` (`workspace:*`) for its library exports only — never
for the MCP server itself. That covers the root entry and the subpaths
the package's `exports` declares, such as the light
`raiminiscence-mcp/recall-client` the per-turn hook loads first
([ADR-0039](../adr/0039-the-per-turn-hook-asks-a-running-server-for-the-whole-recall.md)).
Both also depend on `raiminiscence-argv` the
same way, a fourth package holding the `flag()` `--name=value`
argv-parsing helper the two had hand-rolled identically, and the Zod
validators for flag values. These are the
only inter-package dependencies in the monorepo.

## Data flow overview

1. An agent calls `remember` → content is redacted → written to disk as
   a new Memory file → embedded (best-effort) → an opportunistic,
   non-blocking Consolidation pass is scheduled.
2. In a later session, the agent calls `recall` with a query (or gets an
   automatic `overview` primer via the hooks shim at session start, and,
   on Claude Code/Codex CLI only, an automatic `recall` against that
   turn's own prompt text via the hooks shim on every `UserPromptSubmit` —
   v10) → candidates are ranked by fused lexical + embedding similarity
   × Strength × Confidence Tier weight (ADR-0032) → the recalled Memories' decay anchors reset (Spaced
   Repetition) → results return. **(v13)** That same `overview` call also
   returns `currentFocus` — the most recent active Checkpoint Memory,
   fetched by recency rather than Strength: the calling writer's own, and
   (when Shared Memory makes them differ) the project's most recent
   overall — surfaced in the `SessionStart` primer text alongside the
   existing top-N summary lines.
3. Periodically (explicitly, or opportunistically inline),
   `consolidate` clusters cosine-similar Episodic Memories into a new
   Semantic Memory (Promotion) and physically deletes anything decayed
   past the Pruning threshold. A candidate confirmed to `"contradicts"`
   the Cluster's seed is excluded from Clustering regardless of
   similarity (v6). Before any of that, a Memory with net-negative
   Outcome Feedback (`negativeFeedbackCount` exceeding
   `positiveFeedbackCount`) is removed from the candidate pool entirely —
   it can neither seed nor join a Cluster (v7). After Promotion and
   before Pruning, Promotion Audit re-examines every already-promoted,
   active Semantic Memory's contributors against *current* Conflict Edge
   and Outcome Feedback state — not the state as it stood at Promotion
   time — and sets a caught Semantic Memory `stale` (v8). Before Pruning
   runs, Commit Invalidation then re-examines every currently-active
   Memory of any Kind with no `relatedFiles` set — the exact complement of
   existing Invalidation's own candidate pool — and stales one whose body
   mentions the outgoing target (e.g. "webpack") extracted from a git
   commit subject matching a migration/breaking-change shape (e.g.
   "migrate build from webpack to vite"), dated after that Memory's own
   `createdAt` (v9). After Pruning physically deletes anything decayed,
   Invalidation stales any remaining Memory whose `relatedFiles` was
   touched by a later git commit.
4. When `recall` returns two Memories cosine-similar enough to plausibly
   disagree with no recorded verdict yet, it flags them to each other as a
   Conflict Candidate; the agent — never the server — judges whether they
   actually contradict, one supersedes the other, or there's no conflict,
   via `conflict` (v5).
5. **(v11, opt-in only)** Once a project sets `sharedMemory: true`, the
   `SessionStart` hook idempotently ensures `.raiminiscence/memory/` is a
   `git worktree` of the `raiminiscence-memory` orphan branch, then pulls
   explicitly (fetch + merge) — silent on a clean fast-forward, otherwise
   naming whichever files a recency-keyed merge driver had to auto-resolve
   in the session's primer. Every `consolidate()` pass, including the one
   the `SessionEnd` hook forces (v19), ends by flushing (commit + push) any
   local changes. A genuine same-record
   collision between two writers is resolved by the merge driver alone,
   never surfaced as conflict markers; a same-*content* disagreement
   between two different Memories is still just Conflict Candidate
   detection (step 4), unaffected by any of this.
6. **(v13, Claude Code/Cursor only)** On `Stop`/`stop`, the hooks shim
   checks per-session debounce bookkeeping and, once 15 minutes or 20
   turns have passed since the session's last checkpoint nudge — whichever
   comes first — emits a soft suggestion for the agent to call `remember`
   with `kind: "checkpoint"`. The agent decides whether to act on it; if it
   does, the new Checkpoint Memory becomes the next `currentFocus` lookup
   (step 2) as soon as it's written. A Checkpoint is never a Clustering/
   Promotion candidate (both already operate on Episodic Memories only)
   and never a Conflict Candidate with anything, by an explicit Kind
   exclusion — successive Checkpoints on the same evolving task are
   expected to look alike, which isn't disagreement.
7. **(v15)** At any point, a developer or the agent can call `inspect` —
   as an MCP tool, or directly via the `raiminiscence-inspect` CLI,
   bypassing the agent entirely — to explain one Memory's Strength/
   Half-life/reinforcement, explain how a query would score right now
   (including every near-miss and why it was excluded), or browse/list
   Memories by filter. Computed on a scoring path shared with `recall`
   (so the two can never disagree) but with none of `recall`'s
   mutations: running `inspect` any number of times changes nothing about
   the Memories it looked at.
8. **(v18, Claude Code only, opt-in via `watchedCommands`)** On every Bash
   tool call, the hooks shim matches the command against the project's
   configured Watched Commands and tracks each matched pattern's Open
   Failure state. The moment a pattern that previously failed
   (`PostToolUseFailure`) next succeeds (`PostToolUse`), it emits a soft
   suggestion for the agent to call `remember` with `isError: true`,
   carrying the failed command and its truncated stderr — the agent still
   decides whether and how to act on it, exactly as with step 6's
   Checkpoint nudge. Open Failure state is never a Memory and never
   recallable; it's cleared the moment the nudge fires and forgotten
   entirely at session end.

Full sequence diagrams: [LLD § MCP tool flows](./lld.md#mcp-tool-flows).

## Key architectural decisions

See [`docs/adr/`](../adr/) for full rationale; summarised here:

| ADR | Decision |
| --- | --- |
| [0001](../adr/0001-flat-file-markdown-storage.md) | Flat-file Markdown+YAML storage — no database or vector store. |
| [0002](../adr/0002-v1-retrieval-excludes-spreading-activation.md) | v1 retrieval excludes the graph/spreading-activation/Hebbian layer. |
| [0003](../adr/0003-stdio-only-transport.md) | MCP over stdio only — no hosted/HTTP/SSE transport. |
| [0004](../adr/0004-memory-complements-static-docs.md) | Memory is a strictly additive complement to `docs/adr/`/`CLAUDE.md`/`AGENTS.md`, never reads/writes them. |
| [0005](../adr/0005-one-shared-hooks-package.md) | One shared `raiminiscence-hooks` package for all three clients, not per-client packages. |
| [0006](../adr/0006-spreading-activation-boost-only.md) | v2 Spreading Activation only boosts a candidate that already independently qualified — never surfaces a new one. |
| [0007](../adr/0007-spreading-activation-boost-pool-is-unbounded.md) | Spreading Activation's boost pool is the full qualifying set per call, not a bounded top-N window. |
| [0008](../adr/0008-v3-spreading-activation-can-surface.md) | v3 partially revises 0006: a candidate with no independent match can surface via a strong-enough direct Co-access Edge, still ranked below every genuine match. |
| [0009](../adr/0009-v4-spreading-activation-multi-hop.md) | v4 lifts the one-hop ceiling: boost and surfacing both walk a configurable, hard-capped `maxHops`, with an escalating eligibility floor and strictly distance-monotonic ranking. |
| [0010](../adr/0010-v5-conflict-edges-block-spreading-activation.md) | v5 partially revises 0006–0009: a Co-access Edge confirmed as `"contradicts"` is treated as non-existent by Spreading Activation's walk, at every hop distance, regardless of its weight — Co-access Edge's own strengthening is unaffected. |
| [0011](../adr/0011-v6-conflict-edges-block-clustering.md) | v6, the Clustering-side counterpart to 0010: a candidate confirmed `"contradicts"` the seed it would otherwise join is excluded from that Cluster, unconditionally and seed-to-candidate only — prevention-only, no retroactive scan of already-promoted Semantic Memories. |
| [0012](../adr/0012-v7-feedback-excludes-clustering-candidates.md) | v7: a Memory with net-negative Outcome Feedback (`negativeFeedbackCount` exceeding `positiveFeedbackCount`) is excluded from Clustering's entire candidate pool up front — a property-of-one-Memory filter, architecturally distinct from 0010/0011's relational gates — unconditional and prevention-only. |
| [0013](../adr/0013-v8-promotion-audit-retroactively-stales-semantic-memories.md) | v8, the first ADR in this lineage that looks backward: Promotion Audit re-checks every already-promoted, active Semantic Memory's `promotedFrom` contributors against *current* Conflict Edge (all-pairs) and Outcome Feedback state, staling a caught Semantic Memory — closing the retroactive gap 0011 and 0012 each left open. |
| [0014](../adr/0014-v9-commit-invalidation.md) | v9, the first ADR to document a rationale for git-message-driven invalidation at all: Commit Invalidation stales a Memory with no `relatedFiles` set when a git commit subject matches a migration/breaking-change shape and its extracted outgoing target appears in that Memory's body — the exact complement of existing Invalidation's own Related-Files/git-diff eligibility, so the two never compete. |
| [0015](../adr/0015-v10-per-turn-auto-recall-excludes-cursor.md) | v10, the first ADR where the three clients diverge in actual capability, not just hook-registration syntax: per-turn auto-recall (`recall()` fired on every `UserPromptSubmit`, with `triggerConsolidation: false`) reaches Claude Code and Codex CLI only — Cursor's `beforeSubmitPrompt` can only allow/block a prompt, not inject context, so it keeps `SessionStart`-only priming. |
| [0016](../adr/0016-team-shared-memory-becomes-a-future-direction-adr-0003-flagged.md) | Team/agent-shared memory becomes a legitimate near-term direction (not itself a design), flagging — not superseding — ADR-0003's stdio-only rationale; hosted/SaaS multi-tenancy is explicitly sequenced *after* it, not designed concurrently. |
| [0017](../adr/0017-v11-shared-memory-via-git-worktree.md) | v11: Shared Memory is delivered entirely over git — `.raiminiscence/memory/` becomes a `git worktree` of a dedicated, never-merged orphan branch; the three packed indices split into one file per record; commits are batched (Consolidation completion, session end) and auto-pushed, pulling is always explicit, and a genuine git-level conflict is auto-resolved by a recency-keyed (`updatedAt`) merge driver rather than raw conflict markers. |
| [0018](../adr/0018-v11-shared-memory-writer-identity.md) | v11: a `writer` field (`gitName`/`gitEmail` from local git config, best-effort; a `sessionId` fixed per MCP server process) is added to Memories and Conflict Verdicts only — not Co-access Edges or embeddings, since nothing consumes attribution on a purely derived signal. |
| [0019](../adr/0019-v12-reinforcement-ceiling.md) | v12: Spaced Repetition's and Outcome Feedback's positive terms now feed one shared, proportional Reinforcement Ceiling (`4 × baseHalfLifeDays`, approached via a smooth curve, half-saturated at 30 raw bonus-days) instead of growing without limit; Outcome Feedback's negative term and its existing hard floor are untouched. |
| [0020](../adr/0020-v13-checkpoint-via-stop-hook.md) | v13: a fourth Memory Kind, Checkpoint (3-day base Half-life), refreshed via a debounced (15 min/20 turns) soft nudge on the `Stop`/`stop` hook (Claude Code/Cursor only) rather than a true end-of-session write, which turned out not to be mechanically reachable on any supported client; `overview` gains `currentFocus` (own/project, by recency) as the retrieval side, with no new MCP tool. |
| [0021](../adr/0021-v14-versioned-disk-cache-for-recall-latency.md) | v14: `recall`'s two O(n²) hot spots (Spreading Activation's adjacency build and the qualifying set's direct-boost term) are replaced by one O(edges) pass over the co-access index; a versioned, on-disk cache per storage root (parsed corpus plus embedding/co-access/conflict indices) removes the per-call full-directory read/parse for both the fresh-subprocess hook path and the long-lived MCP server. The cache lives at `.raiminiscence/cache/`, outside Shared Memory's git worktree, and every writer (`remember`, `consolidate`, a Shared Memory pull) bumps its version marker as part of its own write. |
| [0022](../adr/0022-v15-inspect-side-effect-free-scoring-path.md) | v15: Inspect gets its own side-effect-free scoring path — a shared pure scoring core factored out of `recall()`, reused (never re-derived) by both — rather than calling `recall()` directly, since `recall()` itself always mutates `recallCount`/`lastRecalledAt`/Co-access Edges as an intrinsic part of what it is. Ships as a third package, `raiminiscence-cli`, plus an eighth MCP tool, `inspect`; reinforcement detail comes entirely from existing aggregate counters, no `schemaVersion` bump. |
| [0023](../adr/0023-v18-fix-nudge-via-post-tool-use-hook.md) | v18: Fix Nudge detects a configured Watched Command's failure→fix transition and nudges (never writes) a `remember`-with-`isError: true` call, via two Claude-Code-only hooks (`PostToolUse` for success, `PostToolUseFailure` for failure — no single event covers both). New hook-only "Open Failure" bookkeeping, deliberately kept separate from Checkpoint; no Memory Kind, schema, decay, Recall, or Overview change, and no cross-session persistence. |
| [0024](../adr/0024-v17-embedded-provider.md) | v17: a second Embedding Provider, the Embedded Provider (`nomic-embed-text-v1` via `@huggingface/transformers`, dynamically imported), becomes the new default, running in-process with no external service; Ollama remains an opt-in alternate. Each stored embedding records its Provider/model identity — a mismatch against the current default degrades to lexical fallback rather than comparing incompatible vectors — and a new Re-embedding Consolidation step (first in sequence) heals it opportunistically. Clustering's 0.82 threshold was empirically re-validated and kept unchanged. |
| [0025](../adr/0025-v19-opportunistic-consolidation-debounce.md) | v19: Opportunistic Consolidation is debounced (fixed 15-minute/20-call interval, mirroring Checkpoint's precedent) via new persisted per-storage-root state, rather than moved off-thread, so `remember`/`recall` no longer stall behind a full pass on every call; Shared Memory's `flushSharedMemory` push becomes non-blocking by default (`awaitPush`, default `false`) while `add`/`commit` stay synchronous. `SessionEnd` now forces a full, awaited Consolidation pass for every project (not just Shared Memory ones), settling any in-flight opportunistic pass and push first so it can never race one. |
| [0026](../adr/0026-lockstep-versioning-with-semantic-release.md) | All four packages share one version and release in lockstep, driven by semantic-release from Conventional Commits on `main`, staged from CI through npm Trusted Publishing for a maintainer to approve, with no long-lived token. |
| [0027](../adr/0027-zod-confined-to-schema-modules.md) | Zod is imported only by `*-schema.ts` modules, each exposing plain parse functions, so the validate-all-external-input and no-unwrapped-third-party-import rules both hold; an architecture test enforces it. |
| [0028](../adr/0028-embedded-provider-runtime-is-a-regular-dependency.md) | Supersedes ADR-0024's optional-peer sub-decision: `@huggingface/transformers` becomes a regular dependency of `raiminiscence-mcp`, since npm never installs an optional peer and the default provider silently fell back to lexical scoring; it's still loaded lazily. |

## Deferred / out of scope

What's still open or rejected today lives in [`NEXT_STEPS.md`](../../NEXT_STEPS.md); this list is the original v1 scope cut, kept for history (several items have since shipped, see the README's Status table).

Deliberately not in v1 (from the original spec):

- **Graph / spreading-activation / Hebbian co-access retrieval** — the reference design's most novel mechanism; deferred past v1 — see [ADR-0002](../adr/0002-v1-retrieval-excludes-spreading-activation.md). Shipped in v2 to v5, then removed in [ADR-0037](../adr/0037-coaccess-and-spreading-activation-are-removed.md) after it measured as inert or harmful.
- **Git-invalidation of stale Memories** — the `stale` Confidence Tier is reserved in the schema, but no v1 process produces it automatically.
- **User-facing config/tuning surface** — no decay-rate or result-count tuning knobs exposed; the embedding provider endpoint/model aren't even environment-configurable yet (see [`raiminiscence-mcp` README § Configuration](../../packages/raiminiscence-mcp/README.md#configuration)).
- **Update/edit tool for existing Memories** — content is immutable; corrections are `forget` + a fresh `remember`.
- **Migration tooling for `schemaVersion` changes** — the field is reserved from day one, but no migration mechanism exists.
- **Hosted/HTTP or SSE MCP transport** — a fundamentally different trust/deployment model; a separate effort if ever pursued.
- **Hosted/SaaS multi-tenancy** (API-key auth, a running server, many separate tenants) — explicitly deferred past v11's Shared Memory, sequenced strictly after it per [ADR-0016](../adr/0016-team-shared-memory-becomes-a-future-direction-adr-0003-flagged.md), not designed alongside it.
- **A live sync protocol or daemon, and a new `sync`/`share` MCP tool** — v11's Shared Memory considered and rejected both in favour of git-native sharing (worktree + hooks-layer pull/flush) — see [ADR-0017](../adr/0017-v11-shared-memory-via-git-worktree.md).
