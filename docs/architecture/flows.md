# Flows

[Back to hld.md](hld.md) • [Back to lld.md](lld.md)

Step-by-step runtime behaviour for the scenarios a user or an agent actually triggers. For the static architecture these flows move through, see the [HLD](./hld.md); for exact interfaces, schemas and per-tool sequence diagrams, see the [LLD](./lld.md).

Every flow below shares two rules. Each hook step fails open: a timeout or error degrades to empty output, never to a failed client session. Every MCP tool runs through `server.ts`'s shared `handle()` wrapper: a thrown error becomes an `isError: true` tool result, never a JSON-RPC failure.

## Setup: registering the server and the hooks

Triggered once per project by the developer.

1. Register the MCP server with the client, for example `claude mcp add raiminiscence -- npx raiminiscence-mcp`. The client spawns it as a local stdio subprocess on each session; there is no network listener.
2. Register the hooks with `npx raiminiscence-hooks-install --client=claude-code` (or `cursor`, `codex`). It merges `raiminiscence-hooks-shim` entries into the client's own hook config: `SessionStart` for all three clients, `UserPromptSubmit` for Claude Code and Codex CLI, `Stop` for Claude Code and Cursor, and `SessionEnd`, `PostToolUse` and `PostToolUseFailure` for Claude Code only. A hook the chosen client doesn't support is reported and skipped, never an error.
3. Optional: add a `.raiminiscence.config.json` at the project root. It can set `storageRoot`, `embeddingProvider`, `sharedMemory` and `watchedCommands`. With no file, every setting takes its default: project-root storage, the Embedded Provider, no Shared Memory, no Watched Commands.

## Server start

Triggered when the client spawns `raiminiscence-mcp`.

1. `createServer()` generates one `sessionId` for the process and creates the logger, which writes to stderr only, since stdout carries the MCP JSON-RPC stream.
2. It resolves the Embedding Provider once from `.raiminiscence.config.json`: no `embeddingProvider` block means the in-process Embedded Provider (`nomic-embed-text-v1` over ONNX); an explicit `"ollama"`, or a legacy `{ endpoint, model }` block, means the Ollama Provider. Neither loads a model or opens a connection yet.
3. It registers the eight tools: `remember`, `recall`, `overview`, `forget`, `feedback`, `conflict`, `consolidate` and `inspect`. The storage root is resolved fresh on every call (`resolveStorageRoot()`: a configured `storageRoot`, else the nearest directory containing `.git`), never cached.

## Session start

Triggered by the client's `SessionStart` hook, in Claude Code, Cursor and Codex CLI alike. Claude Code's registration matches `startup`, `resume`, `clear`, `compact` and `fork`.

1. The client spawns `raiminiscence-hooks-shim` and pipes the hook's JSON on stdin. The shim reads `cwd` and resolves the storage root from it.
2. `primer.ts` calls `overview()` directly, as a plain function, not over MCP, raced against a 2-second timer. `overview()` returns the top 5 active `semantic`/`decision` Memories by Strength alone, plus `currentFocus`: the newest active Checkpoint by this writer (`own`) and the newest overall (`project`). It never triggers Consolidation.
3. The primer becomes one `[kind, confidence] summary` line per Memory, plus up to two `currentFocus` lines. The `project` line appears only when it's a different Checkpoint from `own`. A timeout or error yields an empty primer.
4. When `sharedMemory: true`, `shared-memory-sync.ts` first makes `.raiminiscence/memory/` a git worktree of the `raiminiscence-memory` orphan branch, if it isn't one already, then fetches and merges. A note naming any files the merge driver had to auto-resolve is appended; a clean fast-forward, an offline fetch or a failure adds nothing.
5. The shim prints `{"hookSpecificOutput":{"additionalContext":"..."}}`, or `{}` when there's nothing to inject.

## Each user prompt: automatic recall

Triggered by `UserPromptSubmit`, in Claude Code and Codex CLI only. Cursor's per-turn hook can't inject context ([ADR-0015](../adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)).

1. The shim reads `cwd` and `prompt`, resolves the storage root, and calls `recall({ query: prompt, triggerConsolidation: false })` directly, raced against the same 2-second timer.
2. This is a real Recall: every returned Memory has its decay anchor reset, exactly as an explicit `recall` tool call would. It never schedules Consolidation.
3. Results become `[kind, confidence] summary` lines. The fields `surfacedVia`, `conflictsWith` and `conflictCandidateWith` are dropped. A timeout or error yields `{}`.

## The agent records a Memory: `remember`

Triggered by the agent calling the `remember` tool.

1. `kind` defaults to `episodic` and `confidence` to `observed`. `scope` picks the project store or the global one under the home directory.
2. `redaction.ts` masks secret-shaped content before anything is written, and the result reports `redacted: true` when it did.
3. The Memory is written as a Markdown file with YAML frontmatter, including the writer's git identity and this process's `sessionId`.
4. The body is embedded. A vector is upserted into the per-record embedding index, tagged with the provider's identity. A `null` vector, from an unreachable provider or a model that failed to load, skips the index and reports `embedded: false`; that's a normal outcome, not an error.
5. Opportunistic Consolidation is considered (see [Consolidation](#consolidation)), and the tool returns before any pass runs.

## The agent asks for context: `recall`

Triggered by the agent calling the `recall` tool.

1. The query is embedded once. If that fails, every candidate is scored lexically by token overlap, and the result reports `usedFallback: true`.
2. Candidates come from the cached, active-only records (`.raiminiscence/cache/`), filtered by `kind` and `scope`. `stale` and `retracted` Memories are never candidates.
3. `query-scoring.ts` computes each candidate's base score as similarity × Strength × its Confidence Tier weight. A candidate with no stored vector, or one embedded by an incompatible provider or model, falls back to lexical scoring for that one comparison.
4. Candidates whose base score clears `minScore` are ranked by the fused similarity × the same weights ([ADR-0032](../adr/0032-recall-fuses-lexical-and-embedding-scores.md)). Nothing else adds to a score: Spreading Activation was removed ([ADR-0037](../adr/0037-coaccess-and-spreading-activation-are-removed.md)).
5. The top `k` (default 3, [ADR-0034](../adr/0034-recall-default-k-is-three.md)) are kept. Each result's recall fields are rewritten (`lastRecalledAt`, `recallCount`), and the change is appended to the cache log rather than rebuilt ([ADR-0036](../adr/0036-recall-cache-appends-instead-of-rewriting.md)).
6. Pairs in the final set get `conflictsWith` for a recorded `contradicts` verdict, or `conflictCandidateWith` when cosine similarity is at least 0.82, or 0.87 for nomic's task-prefixed vectors, and no verdict exists. Checkpoints are never flagged.
7. Opportunistic Consolidation is considered, and the results are returned. Zero matches is `{ results: [] }`, not an error.

## The agent corrects the store: `forget`, `feedback`, `conflict`

Triggered by the agent calling one of these tools. An unknown id is an `isError: true` result in every case.

1. `forget` rewrites the Memory with `confidence: "retracted"`, `retractedAt` and `retractReason`. It disappears from `recall`/`overview` immediately, and Pruning deletes the file later. Forgetting it again returns `alreadyRetracted: true`.
2. `feedback` increments `positiveFeedbackCount` or `negativeFeedbackCount`, on any Confidence Tier. Positive feedback extends the effective half-life up to the shared Reinforcement Ceiling; negative feedback shrinks it to a 1-day floor.
3. `conflict` validates both ids, and that a `supersedes` verdict names one of them, before writing anything. It then records the verdict for the pair, overwriting any earlier one. `supersedes` also retracts the named Memory through `forget` itself. `contradicts` and `no-conflict` leave both Memories untouched.

## Consolidation

Triggered three ways. **Opportunistically**, after `remember` or MCP `recall`, but only when the per-store debounce is due: 15 minutes or 20 calls since the last completed pass, or no pass on record yet. Otherwise the call is just counted. **Explicitly**, by the `consolidate` tool, which bypasses the debounce. **At session end**, by the `SessionEnd` hook (below), which also bypasses it.

1. An opportunistic pass is scheduled with `setImmediate`, after the triggering call returns. Its failures are logged and swallowed. A second pass is never scheduled while one is still running in the same process.
2. `scope: "both"` consolidates the project store and the global store independently. These steps run in order on each store:
   1. **Re-embedding**: Memories whose stored vector came from a different provider or model are re-embedded.
   2. **Clustering**: episodic Memories with cosine similarity of at least 0.82, or 0.87 for nomic's task-prefixed vectors, are grouped. Net-negative-feedback Memories and `contradicts` pairs are excluded.
   3. **Promotion**: each cluster becomes a new `semantic` Memory, and survivors' `consolidationSurvivalCount` is bumped.
   4. **Promotion Audit**: a `semantic` Memory whose sources now contradict each other, or carry net-negative feedback, is marked `stale`.
   5. **Commit Invalidation**: a Memory with no `relatedFiles` whose body names the outgoing target of a later qualifying commit subject is marked `stale`.
   6. **Pruning**: any Memory below 0.05 Strength is deleted, with its vector and edges.
   7. **Invalidation**: a Memory whose related git-tracked file changed after it was written is marked `stale`.
   8. **Flush**: on a Shared Memory worktree, the pass commits and pushes; elsewhere this step is a no-op.
3. With `dryRun: true`, every step reports counts and nothing is written, deleted, re-embedded or pushed.
4. Any completed, non-dry-run pass resets the debounce clock, whatever triggered it.

## Every agent stop: checkpoint nudge

Triggered by `Stop` in Claude Code or `stop` in Cursor ([ADR-0020](../adr/0020-v13-checkpoint-via-stop-hook.md)).

1. The shim reads the session's nudge state from `.raiminiscence/hooks-state/checkpoint-nudge/<sessionId>.json` and counts this turn.
2. When Claude Code's `stop_hook_active` is set, the shim returns `{}`, so a nudge-triggered continuation never nudges again.
3. When 15 minutes or 20 turns have passed since the last nudge, the shim resets the state and asks the agent to record a `checkpoint` Memory. Claude Code gets `{"decision":"block","reason":"..."}`; Cursor gets `{"followup_message":"..."}`.
4. Otherwise it saves the turn count and returns `{}`. The nudge is a suggestion only: it fires once per threshold crossing, whether or not the agent follows it.

## A watched command is fixed: Fix Nudge

Triggered by `PostToolUse` or `PostToolUseFailure`, in Claude Code only, and only for configured `watchedCommands` ([ADR-0023](../adr/0023-v18-fix-nudge-via-post-tool-use-hook.md)).

1. The shim ignores any tool other than `Bash`, and any interrupted failure.
2. It matches the command against every watched pattern: each pattern is tried as a regex first, then as a plain substring.
3. On a failure, it records the command and the last 40 lines of its output for each matched pattern, in `.raiminiscence/hooks-state/fix-nudge/<sessionId>.json`. A failure never nudges.
4. On a success with a recorded failure for the same pattern, it clears the record and injects a nudge to `remember` the failure and its fix with `isError: true`. A success with no recorded failure does nothing.

## Session end

Triggered by `SessionEnd`, in Claude Code only.

1. The shim resolves the storage root and calls `runSharedMemorySessionEnd`.
2. It waits for anything this process already started: an in-flight opportunistic pass, then a pending push.
3. It runs a full `consolidate({ awaitPush: true })` for every project, not only Shared Memory ones. The pass bypasses the debounce. On a Shared Memory worktree, its closing flush awaits the push instead of firing and forgetting it ([ADR-0025](../adr/0025-v19-opportunistic-consolidation-debounce.md)).
4. Any failure is logged and swallowed. The shim always prints `{}`.

## A developer inspects the store

Triggered by the agent calling the `inspect` tool, or a developer running `raiminiscence-inspect`. Both call the same three functions in `inspect.ts`, and neither writes anything.

1. `raiminiscence-inspect <id>`, or `inspect({ id })`, reports one Memory's Strength, base and effective half-life, Reinforcement Ceiling usage, Confidence Tier, age and counters.
2. `raiminiscence-inspect --query="..."`, or `inspect({ query })`, scores with the same `scoreCandidatesForQuery` that `recall` uses, and adds near-misses: below `minScore`, `stale` or `retracted`. Unlike `recall`, it resets no decay anchor and strengthens no edge.
3. `raiminiscence-inspect --list`, or `inspect({ list: true })`, browses every Memory, of any Confidence Tier. It can filter by kind, tier, Strength range, scope and creation date, and sorts weakest first.
4. `--detailed`, or `verbosity: "detailed"`, expands the compact output. Exactly one of id, query and list must be given; anything else is rejected.
