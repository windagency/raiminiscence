# rAIminiscence

[Back to README.md](README.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 02-language-convention.md](CODING_RULES/02-language-convention.md) • [Back to 0019-v12-reinforcement-ceiling.md](docs/adr/0019-v12-reinforcement-ceiling.md) • [Back to 0022-v15-inspect-side-effect-free-scoring-path.md](docs/adr/0022-v15-inspect-side-effect-free-scoring-path.md) • [Back to 0024-v17-embedded-provider.md](docs/adr/0024-v17-embedded-provider.md) • [Back to domain.md](docs/agents/domain.md) • [Back to developer-guide.md](docs/developer-guide.md) • [Back to how-it-works.md](docs/how-it-works.md) • [Back to packages/raiminiscence-mcp/README.md](packages/raiminiscence-mcp/README.md)

Domain glossary for rAIminiscence, a biologically-inspired persistent memory MCP server that lets AI coding agents recall observations, patterns, and decisions across otherwise-isolated conversation sessions.

## Language

**Memory**:
A single persisted unit of recall: one Markdown file with YAML frontmatter, holding one observation, pattern, or decision. The atomic thing that gets written, decayed, scored, and recalled.
_Avoid_: Entry, record, note

**Memory Kind**:
Which of the four categories a Memory belongs to: `episodic`, `semantic`, `decision`, or `checkpoint`. Fixed at write time (directly, or via Consolidation's Promotion step for `semantic` specifically), and filterable via a `kind` parameter on Recall.
_Avoid_: Tier (reserved for Confidence Tier), type, category

**Episodic Memory**:
A raw, timestamped observation from a single session; noisy and context-specific by nature. The default Memory Kind when none is specified. Decays fastest of the three non-Checkpoint Kinds (7-day base Half-life).

**Semantic Memory**:
A distilled, reusable pattern. Normally produced by Consolidation's Promotion step from a Cluster of related Episodic Memories, though an agent confident enough may also write one directly. Decays slowest (30-day base Half-life).

**Decision Memory**:
An architectural or design choice an agent made or observed, captured with its rationale at the moment it happened. A staging/observation layer only — distinct from an ADR, and never reads or writes `docs/adr/`. 21-day base Half-life. See [ADR-0004](docs/adr/0004-memory-complements-static-docs.md).
_Avoid_: ADR, decision record (reserved for the human-curated `docs/adr/` artifact)

**Checkpoint** _(v13)_:
A transient, personal continuity pointer capturing what its writer was in the middle of, refreshed periodically rather than written once. The fourth Memory Kind; decays fastest of the four (3-day base Half-life), and is fetched by recency rather than Strength — never part of Overview's default top-N ranking, and excluded from Clustering/Promotion candidacy (automatic: those steps only ever operate on Episodic Memories to begin with) and from Conflict Candidate detection (an explicit exclusion — successive Checkpoints on the same evolving task are expected to be near-duplicates, not genuine disagreements). Still an ordinary Recall candidate otherwise, and still physically removed by Pruning like any Memory. See [ADR-0020](docs/adr/0020-v13-checkpoint-via-stop-hook.md).
_Avoid_: Session Summary, Snapshot (the mechanism refreshes an existing pointer rather than producing a one-time end-of-session artifact)

**Fix Nudge** _(v18)_:
A `PostToolUse`/`PostToolUseFailure` hook mechanism (Claude Code only) that detects when a Watched Command that previously failed later succeeds, and injects a suggestion for the agent to call `remember` (with `isError: true`) describing the failure and its fix — never writes a Memory itself, since no hook in this project has model access. The same soft-suggestion, never-enforced shape as Checkpoint's `Stop`-hook nudge, but event-triggered on a failure→fix transition rather than debounced by elapsed time/turns. Two events, not one: Claude Code has no single hook covering both a Bash command's success and failure. See [ADR-0023](docs/adr/0023-v18-fix-nudge-via-post-tool-use-hook.md).
_Avoid_: Auto-Capture, Error Detection (both imply the hook writes something itself, which it never does)

**Watched Command** _(v18)_:
A project-opted-in substring/regex pattern, listed in `.raiminiscence.config.json`'s new `watchedCommands` field, naming a shell command (e.g. `tsc`, `pytest`) whose failures Fix Nudge should track. Absent/empty by default — Fix Nudge is opt-in, matching every other config-gated mechanism in this project (`embeddingProvider`, `sharedMemory`).

**Open Failure** _(v18)_:
The per-session, hook-internal record of a Watched Command's most recent failing invocation (its command string and a truncated stderr tail) — cleared the moment that same Watched Command next succeeds, at which point Fix Nudge fires. Never a Memory Kind, never written to `.raiminiscence/memory/`, never a Recall/Overview/Inspect candidate — pure hook bookkeeping, deliberately kept separate from Checkpoint, which is agent-authored recallable content.
_Avoid_: Checkpoint (reserved for the agent-authored continuity pointer specifically — Open Failure is hook-only bookkeeping with a different owner and a different purpose)

**Confidence Tier**:
How much to trust a Memory's content, independent of its Memory Kind: `verified` (multiple sources/agents corroborated it), `observed` (single-source fact), `inferred` (derived, e.g. by Promotion), `stale` (set by Invalidation, excluded from Recall), or `retracted` (soft-deleted via Forget, excluded from Recall). Only reachable via their dedicated transitions — never a starting tier at Remember time. Orthogonal to Memory Kind — a Decision Memory can be `inferred`; an Episodic Memory can be `verified`.
_Avoid_: Tier alone (always qualify as "Confidence Tier"), confidence level, trust score

**Strength**:
A Memory's current decayed relevance, computed as `0.5^(elapsed / halfLife)`. Continuous and automatic, unlike Confidence Tier, which is discrete and only changes on explicit events (Promotion, Forget, Invalidation).

**Half-life**:
The elapsed time for a Memory's Strength to decay by half. Starts at a fixed base value per Memory Kind (7 / 30 / 21 / 3 days for episodic / semantic / decision / checkpoint) and is extended by Spaced Repetition, Error Amplification or positive Outcome Feedback.

**Decay Grace Period**:
A fixed span (14 days) of elapsed time that never counts toward Decay, applied before the Half-life exponent — so a normal absence (holiday, illness) doesn't erode a Memory's Strength at all; only dormancy beyond the grace period does. A global constant, not a per-Memory field.

**Decay**:
The continuous, automatic reduction of a Memory's Strength as time elapses, governed by its Half-life. Always running in the background of every Strength calculation — not a discrete event the way Consolidation is.

**Spaced Repetition** _(extended v12)_:
The mechanism that extends a Memory's Half-life each time Recall returns it — Memories that keep proving useful decay more slowly. Contributes a raw +2 days per qualifying event (Recall hit or Consolidation survival) into the shared Reinforcement Ceiling alongside Outcome Feedback's positive term, rather than adding unboundedly on its own; see Reinforcement Ceiling.

**Error Amplification**:
The mechanism that doubles a Memory's base Half-life when it's written with `isError: true` — a corrected mistake is retained longer than a routine observation.

**Reinforcement Ceiling** _(v12)_:
The shared, proportional ceiling — 4× a Memory's `baseHalfLifeDays` — that Spaced Repetition's and Outcome Feedback's positive contributions to effective Half-life approach asymptotically but never exceed, reached via a smooth diminishing-returns curve (half of the ceiling at 30 raw bonus-days) rather than a hard clamp. Replaces what was previously uncapped, flat per-event growth on both mechanisms — the same shape that let Outcome Feedback's formula compound without limit (see [ADR-0019](docs/adr/0019-v12-reinforcement-ceiling.md)) while hippo-memory's competing formula stayed multiplicatively bounded. Applies to the combined positive term only: Outcome Feedback's negative term is unaffected, since it already has its own hard floor (effective Half-life can't drop below 1 day) with no compounding problem to fix. A fixed constant, not a per-project config surface — nothing here has shown a need for per-project tuning yet.
_Avoid_: Conflating with Half-life itself — Half-life is what decays; Reinforcement Ceiling is one of the bounds on how far reinforcement can extend it.

**Outcome Feedback** _(v2; extended v12)_:
The act (and the MCP tool) of reporting whether a previously recalled Memory actually proved useful. A stronger version of Spaced Repetition's Half-life bonus on positive feedback — its raw +5-days-per-event term now feeds the same shared Reinforcement Ceiling as Spaced Repetition, rather than growing unboundedly on its own. Shrinks effective Half-life (accelerating Decay) on negative feedback, uncapped by Reinforcement Ceiling and bounded only by the existing hard floor instead. Never changes Confidence Tier — Strength is the continuous dial this belongs on, not the discrete one.

**Embedding Provider**:
The pluggable interface (`embed(text, role): Promise<number[] | null>`, `role` `"query"` or `"document"`) that turns Memory/query text into vectors for Recall's cosine-similarity scoring; never throws — returning `null` degrades Recall to its lexical fallback instead of failing. Two implementations exist as of v17: the Embedded Provider — a model runtime bundled into the package needing no separate install, auto-downloading its weights on first use rather than shipping them in the package — is now the default, running the ONNX port of `nomic-embed-text-v1` via `@huggingface/transformers` (chosen for staying closest to the Ollama Provider's own retrieval behaviour, though not a numerical match, since no embedded runtime option produces vectors compatible with Ollama's own `nomic-embed-text` output — different export pipeline and quantisation). The Ollama Provider — calling a local Ollama server's `/api/embed` endpoint (`nomic-embed-text`) and requiring Ollama installed and running separately — remains fully supported as an opt-in alternate for anyone who already runs Ollama, selected by explicit configuration. Switching the default provider required re-validating Clustering's 0.82 similarity threshold against the new provider's typical similarity distribution rather than assuming it transfers unchanged; the empirical check (ADR-0024) found no change needed. Each stored embedding carries which Provider/model produced it; a Memory whose stored embedding no longer matches the project's current default is treated the same as a failed `embed()` call — absent, falling back to lexical scoring — rather than compared across incompatible vector spaces (healed by Re-embedding, below). `.raiminiscence.config.json`'s `embeddingProvider` block has an explicit `provider: "ollama" | "embedded"` discriminant, resolved by `resolveEmbeddingProviderConfig()`: an absent block resolves to `"embedded"`; a legacy bare `{ endpoint, model }` block with no discriminant resolves to `"ollama"`, so an existing config's behaviour never changes silently; an explicit `provider` field always wins. A running MCP server shares its loaded Embedded model over a local socket, so a short-lived caller such as the per-turn hook skips the model load and falls back to loading it itself when no server answers (ADR-0038).
_Avoid_: model, LLM (rAIminiscence has no LLM of its own — embeddings only); "the embedding model" alone (name the Provider — the interface is the stable thing, not any one model)

**Recall**:
The act (and the MCP tool) of retrieving Memories relevant to a query: embed the query, rank candidates by a fused score — cosine similarity and BM25, each normalised over the candidate pool, mixed equally — × Strength × Confidence Tier weight, and return the top results. `minScore` gates on the unfused similarity × the same weights ([ADR-0032](docs/adr/0032-recall-fuses-lexical-and-embedding-scores.md)). Optionally filtered by Memory Kind or Scope. Always mutates state as a side effect of returning results — `recallCount`/`lastRecalledAt` on each returned Memory — distinct from Inspect (v15), which computes the identical scoring with none of those side effects. Every result's `surfacedVia` is `"match"` since Spreading Activation was removed ([ADR-0037](docs/adr/0037-coaccess-and-spreading-activation-are-removed.md)).

**Recall Cache** _(v14)_:
A versioned, on-disk cache per storage root holding the parsed corpus and the reconstituted embedding/conflict indices — the things `recall()` would otherwise rebuild from scratch on every call. Lives at `.raiminiscence/cache/`, a sibling to `.raiminiscence/memory/` rather than inside it, so it's never swept into Shared Memory's git history as a local, per-machine artifact. Every writer (`remember`, `consolidate`, a Shared Memory pull) updates it and bumps its version marker as part of its own write; a reader trusts the cache only when that marker still matches. A derived, rebuildable artifact, not a new source of truth. See [ADR-0021](docs/adr/0021-v14-versioned-disk-cache-for-recall-latency.md). Since [ADR-0036](docs/adr/0036-recall-cache-appends-instead-of-rewriting.md), `remember` and `recall` append their change to a per-slot log instead of rewriting the slot, and the log is compacted into the slot once it outgrows it.

**Co-access Edge** _(v2, removed)_:
A weighted link between two Memory ids, strengthened whenever a Recall returned both. Spreading Activation ranked results through it. Both were removed in [ADR-0037](docs/adr/0037-coaccess-and-spreading-activation-are-removed.md): on every workload measured the edges either did nothing or made retrieval worse. Old edge files under `memory/co-access/` are ignored. The term survives only in ADRs 0002 to 0010 and 0035.
_Avoid_: Using it for anything current — Recall ranks by similarity × Strength × Confidence Tier weight alone.

**Conflict Candidate** _(v5)_:
An unconfirmed pair of Memories a `recall` call flags because they scored cosine-similar to each other above the existing Clustering threshold (0.82, or 0.87 for nomic's task-prefixed vectors) but have no recorded Conflict Edge verdict yet. Reported as `conflictCandidateWith` on `RecallResultItem`; Recall-only — `overview` has no query-time similarity computation to surface new candidates from. Becomes a resolved Conflict Edge (`"contradicts"`, `"supersedes"`, or `"no-conflict"`) only once an agent judges it, via a new MCP tool.
Since v13, a Checkpoint is never a Conflict Candidate with anything, regardless of similarity — successive Checkpoints on the same evolving task are expected to look alike, which isn't disagreement.
_Avoid_: Conflict alone for the unconfirmed case — reserved for the confirmed `"contradicts"` state.

**Conflict** _(v5)_:
The confirmed state of two Memories making contradictory claims, recorded as a `"contradicts"` verdict on their Conflict Edge. Distinct from Supersession, which resolves a disagreement rather than merely flagging one. Changes neither Memory's Confidence Tier nor Strength — both stay recallable and equally weighted, reported via `conflictsWith` on both `recall` and `overview` results. The disagreement itself is the useful signal; asserting either side is less trustworthy would be an unjustified assumption the project has no basis to make.
_Avoid_: Contradiction (use "Conflict"). A `"no-conflict"` verdict is a dismissed Conflict Candidate, not a Conflict.

**Conflict Edge** _(v5)_:
A persisted pairwise verdict between two Memory ids — `"contradicts"`, `"supersedes"`, or `"no-conflict"` — recorded by an agent via the `conflict` MCP tool and stored in its own index (an unordered pairKey, per-Scope storage, no Memory frontmatter or `schemaVersion` change). Upsertable: a later call can overwrite an earlier verdict for the same pair, since a verdict is a judgment call rather than the evidence-driven fact Invalidation's `stale` transition rests on. Dropped when either Memory is physically deleted by Pruning. Split into one file per pair under v11's Shared Memory (see [ADR-0017](docs/adr/0017-v11-shared-memory-via-git-worktree.md)); a Conflict Edge write also gets an optimistic read-check-write-with-retry against same-instant local collisions, and carries the writer-identity fields introduced by [ADR-0018](docs/adr/0018-v11-shared-memory-writer-identity.md) — a Conflict Verdict is an explicit judgment call worth attributing.
_Avoid_: Conflict alone — reserved for the confirmed `"contradicts"` outcome specifically.

**Supersession** _(v5)_:
The confirmed state of a `"supersedes"` Conflict Edge verdict: an agent judged one Memory to have legitimately replaced the other, rather than the two merely disagreeing. Triggers the same `retracted` Confidence Tier transition Forget already performs, on whichever id the agent explicitly names as superseded — recency is never assumed, since the newer Memory isn't automatically the correct one.
_Avoid_: Conflict alone — Supersession resolves a disagreement; Conflict flags one that stays unresolved.

**Remember**:
The act (and the MCP tool) of writing a new Memory. Defaults to Episodic; can target Semantic, Decision or Checkpoint directly when the caller already knows which it is.

**Overview**:
The act (and the MCP tool) of fetching the top Memories by Strength alone, with no query — unlike Recall, which always searches against a query. Restricted to Semantic and Decision Memories (Episodic excluded, being unhelpful without a topic to match against). Exists because Recall needs a query that doesn't exist yet at session start; also usable mid-session by an agent that wants a general primer rather than a targeted search. Since v5, also reports `conflictsWith` for any confirmed Conflict among its returned set — a free lookup against the existing Conflict Edge store — but never `conflictCandidateWith`, since new candidate detection needs a query's similarity computation Overview doesn't have. Since v13, also reports `currentFocus`: the calling writer's own most recent Checkpoint, and — when Shared Memory makes them different — the project's most recent Checkpoint overall. Both are fetched by recency, not Strength, and are additive to the existing top-N results rather than displacing any of them.

**Forget**:
The act (and the MCP tool) of retracting a Memory on request: sets its Confidence Tier to `retracted`, excluding it from Recall immediately. Not immediate deletion — the file is physically removed later by Pruning, once Strength has decayed below threshold like any other Memory. Since v5, Supersession triggers this same transition on a different trigger — a confirmed Conflict Edge verdict naming which of two disagreeing Memories loses — rather than a direct request; see Supersession.
_Avoid_: Delete (reserved for Pruning's physical file removal)

**Consolidation** _(extended v17)_:
The batch process — run via an explicit MCP tool call, or an opportunistic inline check during `remember`/`recall`, or a `SessionEnd`-forced pass — that performs Re-embedding, Clustering, Promotion, Promotion Audit, Commit Invalidation, Pruning, and Invalidation together, in that order. The umbrella term; don't use it to mean just one of its steps, and don't conflate it with Opportunistic Consolidation, which is specifically the auto-triggered case.

**Opportunistic Consolidation** _(v19)_:
The specific auto-trigger that schedules a background Consolidation pass from inside `remember`/`recall`, distinct from an explicit `consolidate` tool call and from a `SessionEnd`-forced pass. Since [ADR-0025](docs/adr/0025-v19-opportunistic-consolidation-debounce.md), gated by a debounce: it fires only once a fixed 15-minute interval or a fixed 20-call count has elapsed since the last real (non-`dryRun`) Consolidation pass, whichever comes first — a storage root with no real pass on record yet is always due. The debounce's bookkeeping (last pass timestamp, call count since) is a derived, rebuildable, local-only state file per storage root, living alongside the recall cache under `.raiminiscence/cache/`; it is never Memory content and never synced via Shared Memory. Any real pass — however it was triggered — resets this clock, so the opportunistic trigger, an explicit `consolidate` call, and the `SessionEnd`-forced pass all share one honest clock. `SessionEnd` (Claude Code only) bypasses this debounce entirely, forcing a full pass and awaiting its Shared Memory push to completion before the hook returns — see Shared Memory below.

**Re-embedding** _(v17)_:
A Consolidation step that recomputes a Memory's stored embedding once its recorded Provider/model identity no longer matches the project's current default Embedding Provider — the healing counterpart to treating a mismatched embedding as absent. Runs first, before Clustering, so nothing later in the same Consolidation pass has to reason about mismatched vectors at all. Unlike Invalidation and Forget, this isn't a one-way transition — a healed Memory simply becomes an ordinary, fully-embedded Memory again. A Memory the current provider can't re-embed (provider unreachable) is left with its old vector/identity untouched and retried on the next Consolidation pass — there is no bulk, one-time migration.

**Clustering** _(extended v6, v7)_:
Consolidation's step of grouping Episodic Memories whose embeddings are cosine-similar (≥ 0.82, or 0.87 for nomic's task-prefixed vectors per ADR-0042) into candidate Clusters; one Memory seeds each Cluster and similarity is checked seed-to-candidate only. Since v6, a confirmed `"contradicts"` Conflict Edge between a candidate and the seed blocks that candidate from the seed's Cluster regardless of similarity — see [ADR-0011](docs/adr/0011-v6-conflict-edges-block-clustering.md). Because the check is seed-to-candidate only, two non-seed members with a contradicts edge between them are not independently re-checked. Since v7, a Memory with net-negative Outcome Feedback (`negativeFeedbackCount` exceeding `positiveFeedbackCount`) is excluded from the candidate pool entirely, before any seed/candidate comparison runs — it can neither seed a Cluster nor join one — see [ADR-0012](docs/adr/0012-v7-feedback-excludes-clustering-candidates.md). Unlike the v6 gate, this is a standalone property of one Memory rather than a relationship between two, so it's checked once per Memory up front rather than per seed/candidate pair. Unconditional, no config surface; doesn't reach back to re-examine a Semantic Memory a prior Consolidation run already promoted before the Memory turned net-negative.

**Promotion**:
Consolidation's step of turning a Cluster into a single new Semantic Memory (Confidence Tier `inferred`), and strengthening the contributing Episodic Memories that survive it. Its output can later be re-examined by Promotion Audit, but Promotion itself never looks backward.

**Promotion Audit** _(v8)_:
Consolidation's step of re-checking every already-promoted Semantic Memory's `promotedFrom` contributors against Conflict Edge and Outcome Feedback state as it stands now, not as it stood at Promotion time — closing the gap ADR-0011 and ADR-0012 each left open, since neither Clustering gate is retroactive. Sets a caught Semantic Memory's Confidence Tier to `stale`, the same transition Invalidation performs, but for different evidence — Promotion Audit is deliberately its own term, never a second trigger folded into Invalidation, which stays anchored to Related Files/git evidence specifically. Runs automatically as part of every `consolidate` call (no separate tool, no config surface), before Pruning so it sees Conflict Edges and feedback counts before anything in the same pass is swept away; a contributor already removed by an earlier Pruning pass is simply invisible to the check — best-effort, not exhaustive. Checks *all pairs* within `promotedFrom` for a confirmed `"contradicts"` Conflict Edge, not seed-to-candidate only like live Clustering, since no seed identity survives in `promotedFrom` once written — this also closes Clustering's own documented non-seed blind spot for already-promoted data as a side effect. Stateless: every Semantic Memory is re-examined on every run, with no new frontmatter field and no `schemaVersion` bump. Reports two separate `consolidate` result counts, one per triggering signal, never combined. See [ADR-0013](docs/adr/0013-v8-promotion-audit-retroactively-stales-semantic-memories.md).
_Avoid_: Invalidation, Retroactive Invalidation (both reserved for the git/Related-Files pathway specifically).

**Pruning**:
Consolidation's step of physically deleting any Memory — regardless of Memory Kind or Confidence Tier — whose Strength has decayed below a fixed threshold (0.05). The only step that removes a file from disk.

**Related Files** _(v2)_:
An optional, agent-populated list of file paths a Memory — typically a Decision Memory — is anchored to, recorded at Remember time. The anchor Invalidation checks against git history; a Memory with none is never a candidate for Invalidation, but is instead exactly the case Commit Invalidation (v9) applies to.

**Invalidation** _(v2)_:
Consolidation's step of setting a Memory's Confidence Tier to `stale` once any one of its Related Files has been touched by a git commit since the Memory was created. The parallel to Forget's retraction pathway — both exclude a Memory from Recall/Overview immediately without physically deleting it — but Invalidation is automatic (evidence-driven) where Forget is a deliberate request. A staled Memory has no reversal path (same immutability principle as everywhere else): it stays excluded until Pruning eventually removes it, or a human/agent explicitly Forgets it too (Invalidation and Forget's records both persist on the same Memory if that happens). Distinct from Promotion Audit (v8), which performs this same `stale` transition for a Semantic Memory, but from Conflict Edge/Outcome Feedback evidence rather than git history, and from Commit Invalidation (v9), which is also git-derived but reads commit-message text rather than changed file paths, and only ever applies to a Memory with no Related Files set — Invalidation itself never expands beyond Related Files/git-diff evidence specifically.
_Avoid_: Commit Invalidation (reserved for the commit-message pathway specifically)

**Commit Invalidation** _(v9)_:
Consolidation's step of setting a Memory's Confidence Tier to `stale` when a git commit's subject line matches a migration/breaking-change shape (`migrate X to Y`, `replace X with Y`, `deprecate X`, `remove/drop X`, and near-synonyms) and the extracted target — the thing being moved away from, not its replacement — appears as a case-insensitive, word-boundary-matched substring anywhere in the Memory's body. Applies only to a Memory with no Related Files set, the exact complement of Invalidation's own eligibility, so the two mechanisms never compete to stale the same Memory. Runs automatically as part of every `consolidate` call (no separate tool, no config surface), in its own module, after Promotion Audit and before Pruning — mirroring Promotion Audit's own precedent, so a Memory eligible for Pruning in the same pass is still evaluated by Commit Invalidation first — reporting its own `consolidate` result count kept separate from `memoriesInvalidated`. Scans the same unbounded git history Invalidation already scans, filtered per-Memory against that Memory's own `createdAt`; reads only a commit's subject line, never its diff or body. Deliberately its own term, not a second trigger folded into Invalidation, which stays anchored to Related Files/git-diff evidence specifically — see [ADR-0014](docs/adr/0014-v9-commit-invalidation.md).
_Avoid_: Invalidation alone (reserved for the Related-Files/git-diff pathway specifically)

**Per-Turn Auto-Recall** _(v10)_:
A hooks-layer feature, Claude Code and Codex CLI only, that calls Recall automatically on every prompt, using the prompt's own literal text as the query, via the same `raiminiscence-hooks-shim` binary that performs SessionStart priming — not a separate mechanism, but Recall itself, auto-triggered: a hit still resets that Memory's decay anchor exactly as an explicit `recall` call would, and the injected summary lines omit `surfacedVia`/`conflictsWith`/`conflictCandidateWith`. Cursor is excluded: its only per-turn hook can allow/block a prompt but not inject context back into it, so Cursor keeps `SessionStart`-only priming — see [ADR-0015](docs/adr/0015-v10-per-turn-auto-recall-excludes-cursor.md).
_Avoid_: Auto-Recall alone (always qualify as "Per-Turn" — SessionStart's own priming path is a separate mechanism built on Overview, not Recall)

**Scope**:
Whether a Memory lives in the project-local store (default) or the optional global, cross-project store. A global Memory still records which project it originated from, so it stays interpretable when recalled elsewhere.
_Avoid_: Location, namespace

**Source**:
Provenance metadata on a Memory recording which client/tool — and optionally which model — wrote it. Since v11, every new Memory also carries who wrote it: the local git identity (`user.name`/`user.email`) and a per-server-process session id, added for traceability now that one store can have multiple writers — see [ADR-0018](docs/adr/0018-v11-shared-memory-writer-identity.md).

**Inspect** _(v15)_:
The act (and the MCP tool, plus a CLI of the same name) of explaining a
Memory or a query's scoring, read-only and diagnostic — never a Recall.
Three modes: explain one Memory by id (its Strength, effective Half-life,
Confidence Tier, and reinforcement counts); explain how a query would score
right now (which candidates would be included or excluded, and why —
mirroring Recall's own similarity × Strength × Confidence Tier weighting,
but computed on a side-effect-free path that never increments
`recallCount` or resets `lastRecalledAt` the way an actual Recall call
does); and
browse/list Memories by Memory Kind, Confidence Tier, a Strength threshold,
Scope, and a createdAt range. Always computed fresh against current state —
there is no persisted record of a past Recall call to explain instead
(Recall's own result set is never stored past the response that returns
it). See [ADR-0022](docs/adr/0022-v15-inspect-side-effect-free-scoring-path.md).
_Avoid_: Explain alone (the tool's actual name is Inspect); treating it as
a variant of Recall — Recall always mutates decay state as a side
effect of returning results, Inspect never does, by design.

**Shared Memory** _(v11)_:
An opt-in mechanism (a `sharedMemory` config flag) letting multiple humans and/or multiple simultaneous agent instances on one project read and write one memory store, propagated over git rather than a live sync protocol: `.raiminiscence/memory/` is itself a `git worktree` checkout of a dedicated orphan branch, never merged into the project's own code branches. Changes are committed (synchronously) at the end of every Consolidation pass, but never pulled or merged silently — a `SessionStart`-hook step pulls explicitly, surfacing something to the agent only when an actual merge occurred. Since [ADR-0025](docs/adr/0025-v19-opportunistic-consolidation-debounce.md), the final `push` is fire-and-forget by default (`awaitPush: false`) so a slow or unreachable remote can never block the caller — `add`/`commit` are unaffected. The one exception is `SessionEnd` (Claude Code only), which forces a full Consolidation pass with `awaitPush: true`, guaranteeing the push actually settles before the session ends; a Cursor or Codex CLI user gets no such guarantee, since neither has a `SessionEnd`-equivalent hook registered in this project. A genuine git-level conflict on one record (two writers touching the same pairwise index entry or the same Memory) is auto-resolved by a custom merge driver favoring whichever side has the more recent `updatedAt` field — never surfaced as raw conflict markers. Distinct from Conflict/Conflict Candidate: those flag two Memories whose *content* disagrees; a Shared Memory merge conflict is a race between two writes to the *same record*, unrelated to whether either write's content is true. See [ADR-0017](docs/adr/0017-v11-shared-memory-via-git-worktree.md).
_Avoid_: Team-Shared Memory, Multi-Tenancy (the latter reserved for a later, explicitly out-of-scope hosted/SaaS evolution — see [ADR-0016](docs/adr/0016-team-shared-memory-becomes-a-future-direction-adr-0003-flagged.md))
