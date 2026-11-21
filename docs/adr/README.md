# Architecture decision records

[Back to README.md](../../README.md) • [Back to AGENTS.md](../../AGENTS.md) • [Back to CONTEXT.md](../../CONTEXT.md) • [Back to 0004-memory-complements-static-docs.md](0004-memory-complements-static-docs.md) • [Back to 0029-subpath-imports-replace-parent-relative-imports.md](0029-subpath-imports-replace-parent-relative-imports.md) • [Back to domain.md](../agents/domain.md) • [Back to hld.md](../architecture/hld.md) • [Back to how-it-works.md](../how-it-works.md) • [Back to GOVERNANCE.md](../../GOVERNANCE.md)

One file per decision, numbered in the order it was made. A record is never edited to reverse its decision: a later record supersedes it and says so. How agents use these: [`docs/agents/domain.md`](../agents/domain.md).

New record: next free number, kebab-case title, `# <decision as a sentence>` heading, then context, `## Decision`, and the alternatives considered or consequences when they matter.

| ADR | Decision |
| --- | --- |
| [0001](0001-flat-file-markdown-storage.md) | Flat-file Markdown storage, not an embedded/vector database |
| [0002](0002-v1-retrieval-excludes-spreading-activation.md) | v1 Recall uses plain scoring, not a spreading-activation graph |
| [0003](0003-stdio-only-transport.md) | MCP transport is stdio-only; hosted/HTTP transport is out of scope |
| [0004](0004-memory-complements-static-docs.md) | The dynamic memory layer complements static docs; Decision Memories never touch docs/adr/ |
| [0005](0005-one-shared-hooks-package.md) | One shared `raiminiscence-hooks` package, not one per client |
| [0006](0006-spreading-activation-boost-only.md) | v2 Spreading Activation boosts existing candidates, never injects new ones |
| [0007](0007-spreading-activation-boost-pool-is-unbounded.md) | Spreading Activation's boost pool is the full qualifying set, not a bounded window |
| [0008](0008-v3-spreading-activation-can-surface.md) | v3 Spreading Activation can surface a candidate, not just boost one |
| [0009](0009-v4-spreading-activation-multi-hop.md) | v4 Spreading Activation's hop depth becomes configurable, not fixed at one |
| [0010](0010-v5-conflict-edges-block-spreading-activation.md) | v5 Conflict Edges make a Spreading Activation edge non-traversable, not just re-weighted |
| [0011](0011-v6-conflict-edges-block-clustering.md) | v6 Conflict Edges keep Clustering from merging memories that disagree |
| [0012](0012-v7-feedback-excludes-clustering-candidates.md) | v7 Negative Feedback keeps a Memory out of Clustering entirely |
| [0013](0013-v8-promotion-audit-retroactively-stales-semantic-memories.md) | v8 Promotion Audit retroactively stales Semantic Memories whose contributors turned bad |
| [0014](0014-v9-commit-invalidation.md) | v9 Commit Invalidation stales Memories via commit-message text, not Related Files |
| [0015](0015-v10-per-turn-auto-recall-excludes-cursor.md) | v10 Per-Turn Auto-Recall reaches Claude Code and Codex CLI only — Cursor is structurally excluded |
| [0016](0016-team-shared-memory-becomes-a-future-direction-adr-0003-flagged.md) | Team/agent-shared memory becomes a legitimate future direction; ADR-0003 is flagged for eventual supersession, not superseded here |
| [0017](0017-v11-shared-memory-via-git-worktree.md) | v11 Shared Memory propagates over git (orphan-branch worktree, per-record index files, recency-based merge driver) — no new transport, no live sync daemon |
| [0018](0018-v11-shared-memory-writer-identity.md) | v11 Shared Memory adds a writer-identity field to Memories and Conflict Verdicts only |
| [0019](0019-v12-reinforcement-ceiling.md) | v12 bounds Spaced Repetition + Outcome Feedback's positive term with a shared, proportional Reinforcement Ceiling |
| [0020](0020-v13-checkpoint-via-stop-hook.md) | v13 adds a `checkpoint` Memory Kind, refreshed periodically via the `Stop` hook rather than written once at session end |
| [0021](0021-v14-versioned-disk-cache-for-recall-latency.md) | v14 replaces recall's O(n) corpus scan and O(n²) adjacency build with a versioned, on-disk cache, kept outside Shared Memory's git worktree |
| [0022](0022-v15-inspect-side-effect-free-scoring-path.md) | v15 introduces Inspect, a read-only diagnostic tool with its own scoring path, never Recall's |
| [0023](0023-v18-fix-nudge-via-post-tool-use-hook.md) | v18 detects a Watched Command's failure→fix transition via `PostToolUse`/`PostToolUseFailure` hooks, and nudges the agent to `remember` it rather than writing the Memory itself |
| [0024](0024-v17-embedded-provider.md) | v17 introduces the Embedded Provider as the new default Embedding Provider; Ollama remains an opt-in alternate |
| [0025](0025-v19-opportunistic-consolidation-debounce.md) | v19 debounces Opportunistic Consolidation and makes Shared Memory's push non-blocking, with `SessionEnd` forcing a full awaited pass |
| [0026](0026-lockstep-versioning-with-semantic-release.md) | All four packages release in lockstep, driven by semantic-release |
| [0027](0027-zod-confined-to-schema-modules.md) | Zod is imported only by `*-schema.ts` modules |
| [0028](0028-embedded-provider-runtime-is-a-regular-dependency.md) | The Embedded Provider's runtime is a regular dependency, not an optional peer |
| [0029](0029-subpath-imports-replace-parent-relative-imports.md) | Cross-folder imports go through each package's `#src/*` subpath import |
| [0030](0030-opentelemetry-api-only-with-operator-registered-sdk.md) | Tool calls emit OpenTelemetry spans and metrics through the API alone; the operator registers the SDK |
| [0031](0031-on-disk-files-are-validated-on-read.md) | Every file read back from disk is validated, and a bad one degrades instead of breaking the caller |
| [0032](0032-recall-fuses-lexical-and-embedding-scores.md) | Recall ranks by a fused lexical and embedding score, and gates on similarity alone |
| [0033](0033-recall-returns-the-whole-memory-body.md) | Recall and Inspect return the whole Memory body as detail |
| [0034](0034-recall-default-k-is-three.md) | Recall returns three results by default; the per-turn hook keeps ten |
| [0035](0035-coaccess-learns-only-from-selection-and-boost-is-bounded.md) | Co-access Edges learn only from a selection, and Spreading Activation's boost is bounded |
| [0036](0036-recall-cache-appends-instead-of-rewriting.md) | The recall cache appends each change to a log instead of rewriting itself |
| [0037](0037-coaccess-and-spreading-activation-are-removed.md) | Co-access Edges and Spreading Activation are removed |
| [0038](0038-a-running-server-keeps-the-embedded-model-warm-for-short-lived-callers.md) | A running MCP server keeps the Embedded model warm for short-lived callers |
| [0039](0039-the-per-turn-hook-asks-a-running-server-for-the-whole-recall.md) | The per-turn hook asks a running MCP server for the whole recall, not just the embedding |
| [0040](0040-the-hook-starts-a-warm-process-when-no-server-runs.md) | The per-turn hook starts a short-lived warm process when no MCP server runs |
| [0041](0041-the-mcp-server-answers-remember-before-the-embed.md) | The MCP server answers `remember` before the embed finishes |
| [0042](0042-nomic-embeddings-carry-their-task-prefixes.md) | Nomic embeddings carry their task prefixes |
| [0043](0043-the-unreleased-changelog-is-generated-on-int.md) | The Unreleased changelog is generated on `int` and becomes the release notes |
