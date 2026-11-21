# User guide

[Back to README.md](../README.md) • [Back to 02-language-convention.md](../CODING_RULES/02-language-convention.md) • [Back to developer-guide.md](developer-guide.md) • [Back to testing-guide.md](testing-guide.md) • [Back to packages/raiminiscence-hooks/README.md](../packages/raiminiscence-hooks/README.md) • [Back to readme-package-sections.md](../packages/raiminiscence-mcp/docs/readme-package-sections.md) • [Back to packages/raiminiscence-mcp/README.md](../packages/raiminiscence-mcp/README.md)

For a developer who wants to **install and use** rAIminiscence in their
own project. If you want to work on rAIminiscence itself, see the
[developer guide](./developer-guide.md) instead.

## 1. Install the MCP server

```bash
npm install -g raiminiscence-mcp
```

Register it as a local stdio server with your client.

**Claude Code:**

```bash
claude mcp add raiminiscence -- npx raiminiscence-mcp
```

**Cursor** — add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (user):

```json
{
  "mcpServers": {
    "raiminiscence": { "type": "stdio", "command": "npx", "args": ["raiminiscence-mcp"] }
  }
}
```

**Codex CLI** — add to `~/.codex/config.toml` (user) or `<repo>/.codex/config.toml` (project, requires `.codex/` trust):

```toml
[mcp_servers.raiminiscence]
command = "npx"
args = ["raiminiscence-mcp"]
```

## 2. The eight tools

| Tool | When to use it |
| --- | --- |
| `remember` | Any time you make or observe a decision, discover a reusable pattern, or get corrected on a mistake. |
| `recall` | Before making a design choice or repeating an approach — check whether it was already tried, decided, or corrected before. |
| `overview` | A query-less primer of standing project knowledge (top 5 Semantic/Decision Memories by Strength), plus `currentFocus` — your most recent Checkpoint, v13, see § 6. |
| `forget` | Retract a Memory that turned out to be wrong. |
| `feedback` | Report whether a Memory `recall` returned actually helped — reinforces or fades its effective Half-life. Enough negative feedback also excludes a Memory from Clustering entirely (`feedbackExcludedCount`, see below). |
| `conflict` | Record a verdict (`"contradicts"`/`"supersedes"`/`"no-conflict"`) for a pair of Memories `recall` flagged as possibly disagreeing (`conflictCandidateWith`). |
| `consolidate` | Explicitly cluster related raw observations into a durable pattern, or prune decayed Memories. Runs opportunistically on its own too. |
| `inspect` | See *why* — a Memory's Strength/decay breakdown, why a query would/wouldn't surface a candidate, or a filtered browse/list. Read-only; never mutates anything `recall` would. v15, see § 10. |

Full I/O shapes: [`raiminiscence-mcp` README](../packages/raiminiscence-mcp/README.md#tools),
[LLD § MCP tool flows](./architecture/lld.md#mcp-tool-flows).

### Example session

```
> remember("Postgres chosen for the write model — strongest transactional guarantees for this workload.", kind: "decision", confidence: "verified")
{ id: "01J...", kind: "decision", confidence: "verified", redacted: false, embedded: "pending", consolidationTriggered: true }
```

A week later, a fresh session:

```
> recall("what database did we pick and why?")
{
  results: [{
    id: "01J...", kind: "decision", confidence: "verified",
    summary: "Postgres chosen for the write model — strongest transactional guarantees for this workload.",
    score: 0.91, strength: 0.87, surfacedVia: "match"
  }],
  usedFallback: false
}
```

### `surfacedVia`: always `"match"`

Every result carries `surfacedVia: "match"`: it cleared the query on its
own merits (similarity × Strength × Confidence Tier weight). Earlier
versions could also boost or surface a result through **Co-access Edges**,
links between Memories recalled together, and reported those as
`"connection-1"` to `"connection-3"`. That mechanism, Spreading Activation,
was removed after it measured as inert or harmful
([ADR-0037](adr/0037-coaccess-and-spreading-activation-are-removed.md)).
`maxHops` is gone with it: a call or config file that still sets it works,
and the value is ignored. Edge files an older version left under
`.raiminiscence/memory/co-access/` are never read, and you can delete them.

### Conflict detection: flagging Memories that disagree

When two Memories score cosine-similar to each other above the Clustering
threshold (0.82; 0.87 for nomic's task-prefixed vectors, ADR-0042) but have no recorded verdict yet, `recall` flags the pair
via `conflictCandidateWith` on the result — it's not claiming they
actually disagree, just that they're worth a look:

```
> recall("what database did we pick?")
{ results: [{ id: "01J...", conflictCandidateWith: ["01K..."], ... }] }
```

Judge the pair with `conflict`, recording one of three verdicts:

```
> conflict(memoryId: "01J...", otherMemoryId: "01K...", verdict: "contradicts")
```

- `"contradicts"` — the two genuinely disagree. Both stay recallable and
  equally weighted (`conflictsWith` reports it on both `recall` and
  `overview` going forward); rAIminiscence never assumes either side is
  less trustworthy. A contradicting pair is excluded from Clustering, so
  `consolidate` never merges them into one synthesized Semantic Memory
  (reported back as `blockedJoinAttempts`). Separately, a Memory with
  more negative `feedback` than positive is excluded from Clustering's
  candidate pool entirely — it can't seed or join a Cluster at all
  (reported back as `feedbackExcludedCount`).
- `"supersedes"` — one Memory legitimately replaced the other. Pass
  `retractedId` naming which one loses; that Memory is retracted exactly
  as `forget` would do it (recency is never assumed).
- `"no-conflict"` — dismiss the pair; it was a false positive.

A verdict is upsertable — a later `conflict` call can overwrite an
earlier one for the same pair.

Both of those checks only ever block a *new* Clustering decision. If a
`"contradicts"` verdict is recorded, or a Memory turns net-negative,
*after* its Semantic Memory was already promoted, Promotion Audit catches
it retroactively on the next `consolidate` call: the already-promoted
Semantic Memory is set `stale` (excluded from `recall`/`overview`, same as
any other stale Memory), reported back as `promotionAuditConflictCount`
or `promotionAuditFeedbackCount` respectively. This runs automatically on
every `consolidate` call — no separate tool, no config flag.

### Commit Invalidation: staling unanchored Memories from commit history

Passing `relatedFiles` to `remember` anchors a Memory to specific files:
`consolidate` stales it automatically once any of those files is touched
by a later git commit. A Memory with no `relatedFiles` — most commonly one
you forgot to anchor, or wrote before it was clear which files would
matter — used to have no automatic path to `stale` at all.

Commit Invalidation covers exactly that gap. It reads git commit subject
lines (never diffs or bodies) for a migration/breaking-change shape —
`migrate/switch/move/convert/transition/upgrade X to Y`, `replace X with
Y`, `deprecate X`, `remove/drop X` — and, for a Memory with no
`relatedFiles` set, stales it if the outgoing thing being moved away from
(`X`, never the replacement `Y`) appears anywhere in that Memory's body:

```
> remember("We chose webpack for bundling.", kind: "decision")
...
$ git commit -m "migrate build tooling from webpack to vite"
> consolidate()
{ counts: { ..., memoriesCommitInvalidated: 1 } }
```

The Memory above is now `stale`, excluded from `recall`/`overview` the same
as any other stale Memory. This runs automatically on every `consolidate`
call — no separate tool, no config flag — and never competes with
`relatedFiles`-based Invalidation, since the two only ever apply to
disjoint Memories.

## 3. Automatic session-start priming (optional)

Install `raiminiscence-hooks` for a short primer of standing knowledge to
appear automatically at the start of every session — no manual `recall`
call needed:

```bash
npm install -g raiminiscence-hooks
```

Then merge the client-specific hook snippet from
[`raiminiscence-hooks`](../packages/raiminiscence-hooks) into your
config. **Claude Code is validated**; Cursor and Codex CLI are
best-effort/unvalidated — see that package's README for the exact
per-client instructions and the honesty caveat.

Without the hooks package, or as a universal fallback regardless of
whether it's installed, add the snippet from
[`docs/agents-md-snippet.md`](../packages/raiminiscence-mcp/docs/agents-md-snippet.md)
to your project's `AGENTS.md`/`CLAUDE.md` — it instructs the agent to
call `overview`/`recall` proactively on its own.

## 4. Automatic per-turn auto-recall (optional, Claude Code/Codex CLI only)

On Claude Code and Codex CLI, `raiminiscence-hooks` can also register a
`UserPromptSubmit` hook: on every prompt, not just at session start, it
calls `recall` with that prompt's own text as the query and injects the
result back into that turn — so context stays relevant as the
conversation moves, not a single static snapshot. This is `recall`
itself, automatically triggered: a hit still extends that Memory's
Half-life exactly as an explicit `recall` call would.

**Cursor doesn't get this.** Its only per-turn hook can allow or block a
prompt, not inject context into it, so Cursor keeps the session-start
primer above and nothing more — see
[ADR-0015](./adr/0015-v10-per-turn-auto-recall-excludes-cursor.md).

`npx raiminiscence-hooks-install --client=claude-code` (or `codex`)
registers it alongside every other hook that client supports; to register
it by hand, merge the `UserPromptSubmit` entry from the Claude Code/Codex
snippets in [`raiminiscence-hooks`](../packages/raiminiscence-hooks) into
your config. There's no config toggle — not registering the hook is the
only "off switch."

**A background process you didn't start.** When no MCP server is
running for the project, the hook recalls on its own, then starts one
short-lived `node .../raiminiscence-mcp/dist/warm.js <project>` process
in the background. That process keeps the Embedded model loaded and
answers the next prompts' recall, so only the first prompt pays the
model load. It never writes a Memory and never runs Consolidation or
git. It exits after 30 minutes with no prompt. While it runs it holds
the model in memory: on macOS, close to 900 MB while the model loads,
then about 70 to 120 MB resident. It starts at most once a minute per
project. Set `RAIMINISCENCE_WARM_EMBED=off` in the hook's environment to
stop it, at the cost of every prompt loading the model itself. It is
off on Windows. See
[ADR-0040](./adr/0040-the-hook-starts-a-warm-process-when-no-server-runs.md).

## 5. Shared Memory: multiple humans/agents on one project (optional, v11)

By default, `.raiminiscence/memory/` is a single-writer, per-developer
store — gitignored, invisible to anyone else on the project. Opting into
Shared Memory turns it into a `git worktree` checkout of a dedicated
`raiminiscence-memory` orphan branch instead, so a teammate's (or your own
second machine's) Memories eventually appear in your `recall`/`overview`
results too, propagated entirely over git — no new server, transport, or
auth to set up.

Requires git 2.42 or later: setup creates the branch with
`git worktree add --orphan`, which older versions don't have.

Opt in per project via `.raiminiscence.config.json`:

```json
{ "sharedMemory": true }
```

On the next `SessionStart`, the hooks shim (see §3) does the one-time
setup automatically: creates the `raiminiscence-memory` branch (seeded
from your existing local Memories, if any) and checks it out as a
worktree at `.raiminiscence/memory/`. This requires `raiminiscence-hooks`
to be installed — the setup step lives in the `SessionStart` hook, not the
MCP server itself.

What to expect:

- **Commits are automatic.** Changes are committed at the end of every
  Consolidation pass — you never run `git commit`/`git push` yourself for
  this branch. The final push is fire-and-forget by default, so a slow or
  unreachable remote never blocks a `remember`/`recall` call; at session
  end, the `SessionEnd` hook (Claude Code only for now) forces one last
  Consolidation pass and waits for that push to actually complete, so your
  Memories are guaranteed synced before the session ends. Cursor and Codex
  CLI have no `SessionEnd`-equivalent hook registered yet, so this
  end-of-session guarantee doesn't apply there — pushes still happen, just
  without that final wait.
- **Pulling is explicit, never silent.** Every `SessionStart` fetches and
  merges the shared branch after the usual primer. The common case (fast-
  forward, nothing to reconcile) is silent; if a genuine conflict had to
  be auto-resolved, a short note naming the affected files is appended to
  your session's primer.
- **Conflicts resolve themselves.** A git-level conflict on one record
  (two writers touching the same Conflict/embedding entry, or
  the same Memory file) is resolved by a recency-keyed merge driver —
  whichever side wrote more recently wins outright, never raw conflict
  markers you'd have to resolve by hand. This is unrelated to Conflict
  Candidate detection: that flags two Memories whose *content* disagrees,
  which still runs normally on the next `recall` regardless of sharing.
- **Same-machine concurrency is safe too**, even with no remote
  configured — the underlying per-record file layout (one small file per
  Conflict/embedding entry, instead of one shared blob) means
  two agent instances on the same repo never collide on unrelated
  records.

See [ADR-0017](./adr/0017-v11-shared-memory-via-git-worktree.md) and
[ADR-0018](./adr/0018-v11-shared-memory-writer-identity.md) for the full
design and rationale, including why this deliberately stays out of
hosted/multi-tenant territory.

## 6. Checkpoints: continuity across sessions (optional, v13, Claude Code/Cursor only)

With `raiminiscence-hooks`'s `Stop`/`stop` hook installed (see that
package's README), the agent gets a soft, periodic nudge — at most once
every 15 minutes or 20 turns, whichever comes first — suggesting it call
`remember` with `kind: "checkpoint"` to jot down what it's currently in
the middle of:

```
> remember("Still migrating the write model to Postgres — schema done, backfill script not written yet.", kind: "checkpoint")
```

The nudge never blocks or forces compliance — it's an ordinary suggestion
the agent can act on or ignore, and if ignored, nothing re-fires until the
next 15-minute/20-turn threshold crossing.

Next session (or, on Cursor, in the automatic follow-up prompt), `overview`
gains a `currentFocus` field, and the `SessionStart` primer built from it
surfaces the same thing as extra lines — your own most recent Checkpoint,
and, if you've opted into Shared Memory (§5) and a teammate's (or another
agent instance's) is more recent, the project's most recent Checkpoint
overall too:

```
> overview()
{
  results: [...],
  currentFocus: {
    own: { kind: "checkpoint", summary: "Still migrating the write model to Postgres...", ... },
    project: { kind: "checkpoint", summary: "Still migrating the write model to Postgres...", ... }
  }
}
```

`own` and `project` are the same Checkpoint unless Shared Memory is
enabled and a teammate's is more recent than yours — the common case
carries no extra complexity.

A Checkpoint decays faster than any other Memory Kind (3-day base
half-life, vs. 7 for a raw observation) since each new one instantly makes
the previous one irrelevant for this lookup. It's excluded from
`overview`'s default top-5 (surfaced only via `currentFocus`), from
Clustering/Promotion (it can never seed or join a promoted Semantic
Memory), and from ever being flagged as a Conflict Candidate against
anything (successive Checkpoints on the same evolving task are expected
to look alike, not disagree) — but it's still an ordinary `recall`
candidate if you explicitly search for it (e.g. "what was the state of
the migration last week?"), and still gets physically pruned once it
decays far enough, like any other Memory.

**Codex CLI doesn't get the nudge yet** — its `Stop`-hook continuation
isn't reliable, the same posture as its Cursor-equivalent gap for
per-turn auto-recall (§4). If Codex already consumes `overview`'s output
at `SessionStart`, `currentFocus` is simply present there regardless —
only the nudge itself is unavailable.

See [ADR-0020](./adr/0020-v13-checkpoint-via-stop-hook.md) for the full
design and rationale.

## 7. Scope: project vs. global

By default, every Memory is **project-scoped** — stored under
`.raiminiscence/memory/` at the repo root (nearest `.git`), shared across
a whole monorepo unless a subpackage opts into isolation (see below).

Pass `scope: "global"` to `remember`/`recall`/`overview` for knowledge
that isn't tied to one project (e.g. "always use conventional commits").
A global Memory still records which project it came from
(`originatingProject`) so you can judge its relevance when it surfaces
in a different project's session. Retracting one (`forget`) or reporting
on it (`feedback`) also takes `scope: "global"` — without it, those tools
only ever look at the project-scoped store and won't find a global id.

### Monorepo subpackage isolation

The default is one shared store for the whole repo. If a specific
subpackage genuinely needs its own isolated store, add a
`.raiminiscence.config.json` in that subpackage's directory:

```json
{ "storageRoot": "./relative/path/to/store" }
```

## 8. Secrets

`remember` applies a best-effort, pattern-based redaction pass
(connection-string credentials, `password`/`api_key`/`token` assignments,
bearer tokens, common raw key shapes) before writing anything to disk.
**This is not a compliance guarantee** — don't rely on it as your only
safeguard against leaking real credentials into memory files.

## 9. Memory files on disk

Every Memory is a plain Markdown file with YAML frontmatter under
`.raiminiscence/memory/{episodic,semantic,decisions,checkpoints}/<ulid>.md`.
Read or diff it like any other file, but don't edit it. Only the tools
write Memory files. To correct a Memory, `forget` it and `remember` the
corrected version; to rate one, use `feedback`; to settle a disagreement,
use `conflict`. A file whose frontmatter doesn't match a Memory's schema
is skipped by every tool, with a warning naming the file in the server's
stderr log.

The store is gitignored by default; committing it to share with a team
is a deliberate, manual choice — or use the built-in Shared Memory
mechanism (§5) instead of managing that manually.

## 10. Inspect: seeing why (optional, v15)

Every other tool tells you *what* happened; `inspect` tells you *why*.
It's read-only and diagnostic — running it any number of times changes
nothing about the Memories it looked at, unlike `recall`, which always
resets the decay anchor on every call.

Three modes, available both as the `inspect` MCP tool and as a standalone
CLI (`raiminiscence-inspect`, installed with the `raiminiscence-cli`
package — no agent required):

```bash
npm install -g raiminiscence-cli
```

**Explain one Memory by id** — its Strength, effective Half-life,
Reinforcement Ceiling usage, Confidence Tier, age, and reinforcement
counters:

```bash
raiminiscence-inspect 01J...
```

```
┌─ Decision · "Chose Postgres for the write model"
│
│  Strength         0.71  ##############------
│  Half-life        49.6d  (base 21d -> +28.6d reinforcement)
│  Ceiling used     34%  #######-------------  (max 84.0d)
│  Confidence Tier  observed
│  Age              41 days
│  Reinforced by    4x Recall hit · 2x positive Outcome Feedback
│
│  Recalled 4 times, confirmed useful 2 times — decaying about
│  2.4x slower than an untouched Decision memory would.
└─
```

**Explain how a query would score right now** — the same similarity ×
Strength × Confidence Tier weighting `recall`
itself uses, computed fresh on a path that never mutates anything, plus
every near-miss and exactly why it was excluded
(`below-min-score`/`stale`/`retracted`):

```bash
raiminiscence-inspect --query="what did we decide about the write model?"
raiminiscence-inspect --query="..." --detailed   # show every near-miss instead of just a count
```

**Browse/list Memories by filter** — narrow down to a slice you care
about, e.g. everything about to be pruned, or everything a `consolidate`
pass has already ruled `stale`:

```bash
raiminiscence-inspect --list --kind=semantic --tier=stale
raiminiscence-inspect --list --max-strength=0.1   # nearing Pruning's 0.05 threshold
raiminiscence-inspect --list --scope=global --since=2026-01-01 --until=2026-06-01
```

Output is compact by default (a near-miss list collapses to a count with
a rerun hint; a browse listing shows one line per result); `--detailed`
(or `verbosity: "detailed"` on the MCP tool) shows everything.

An agent can call the same three modes mid-session via the `inspect` MCP
tool — useful when asked to explain its own recall/decay behaviour — with
an input shape of `{ id }` | `{ query, verbosity? }` | `{ list: true,
filters, verbosity? }` (exactly one of `id`/`query`/`list` required).

See [ADR-0022](./adr/0022-v15-inspect-side-effect-free-scoring-path.md)
for the full design and rationale, including why Inspect needed its own
scoring path rather than just calling `recall()`.

## 11. Fix Nudge: capturing a build/test fix automatically (optional, v18, Claude Code only)

Off by default. Opt in per project by listing the shell commands you want
tracked — a substring or regex pattern, matched against the full command
string — in `.raiminiscence.config.json`:

```json
{
  "watchedCommands": ["tsc", "pytest"]
}
```

With `raiminiscence-hooks`'s `PostToolUse`/`PostToolUseFailure` hooks
installed (see that package's README), the moment a Watched Command that
just failed goes on to succeed within the same session, the agent gets a
soft nudge carrying the failed command and its captured stderr (truncated
to its last 40 lines), suggesting it call `remember` with `isError: true`:

```
> remember("tsc failed with TS2322 because the write model's id field was typed as a string; fixed by changing it to number to match the schema.", isError: true)
```

`isError: true` matters here specifically: it's what makes Error
Amplification extend this Memory's Half-life the way it's meant to for a
corrected mistake. The nudge never blocks or forces compliance, and never
re-fires for the same failure→fix transition — only a fresh failure on
that same Watched Command starts the cycle again.

A Watched Command failing more than once before it's fixed only ever
carries the most recent attempt's details forward — you don't get a
Memory (or a nudge) for an earlier, already-superseded failure. If a
Watched Command is left failing when the session ends, that state is
simply forgotten; the next session starts clean, with no partial or stale
failure carried over.

**Cursor and Codex CLI don't get this yet** — neither client's nearest
equivalent (exit-code visibility plus context injection, together) is
confirmed against primary documentation, the same posture as this
project's other per-client hook gaps (§4, §6).

See [ADR-0023](./adr/0023-v18-fix-nudge-via-post-tool-use-hook.md) for the
full design and rationale, including why this needed two separate hook
events rather than one.

## 12. Embedding provider: Embedded vs. Ollama (v17)

`recall`/`remember` need an Embedding Provider to turn text into vectors
for similarity scoring. As of v17 this needs no setup by default: the
Embedded Provider runs in-process (`nomic-embed-text-v1` via
`@huggingface/transformers`), with its model weights auto-downloading to
a local cache the first time it's used.

If you already run Ollama and want to keep using it instead, opt in
explicitly in `.raiminiscence.config.json`:

```json
{
  "embeddingProvider": { "provider": "ollama" }
}
```

Precedence, read from that same config file (no second configuration
mechanism):

- An explicit `provider` field always wins.
- No `embeddingProvider` block at all, or an empty one, means
  `"embedded"` — the default.
- A pre-v17 config that sets `endpoint`/`model` but omits `provider`
  still means `"ollama"`, unchanged — an existing config's behaviour
  never switches silently under it.

Each stored embedding records which Provider/model produced it. A
Memory whose stored embedding no longer matches the project's current
default degrades to the lexical fallback (same as a failed `embed()`
call) rather than being compared across incompatible vector spaces,
until the next `consolidate` pass heals it via Re-embedding.

See [ADR-0024](./adr/0024-v17-embedded-provider.md) for the full design
and rationale.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `recall` always returns `usedFallback: true` | No embedding provider reachable. The default (v17) is the in-process Embedded Provider — no separate install, but its model weights auto-download on first use, so the very first call can be slow or, offline with an empty cache, fail. If you've configured the opt-in Ollama Provider instead, this means Ollama isn't running/reachable (`http://localhost:11434`, `nomic-embed-text` model). Either way, Recall still works via lexical fallback, just less semantically. |
| `remember` returns `embedded: false`, or the server logs "background embed failed" | Same as above — the Memory is still written; only its embedding is missing. Through the MCP server, `remember` answers `embedded: "pending"` and embeds after ([ADR-0041](./adr/0041-the-mcp-server-answers-remember-before-the-embed.md)), so a failure shows in the server log and in `recall`'s `usedFallback`. The next `consolidate` pass that can reach a provider gives the Memory its vector, through the same Re-embedding step that heals a vector from a *different* provider. |
| No automatic session-start primer appears | You haven't installed `raiminiscence-hooks`/registered its hook, or the shim's 2-second internal timeout was hit (it silently returns no context rather than erroring — check your storage root actually has Semantic/Decision Memories yet). |
| No automatic per-turn context appears (Claude Code/Codex CLI) | You haven't registered the `UserPromptSubmit` hook (it's separate from `SessionStart` — see § 4), or the 2-second internal timeout was hit, or nothing scored above `minScore` for that prompt. On Cursor, this is expected — there's no per-turn hook capable of injecting context; see ADR-0015. |
| A tool call errors instead of returning a result | Check the error message — it's a real, descriptive tool error (e.g. `forget` on an unknown id), not a crash of the whole MCP connection. |
| `SessionStart` fails/errors after enabling `sharedMemory: true` | Shared Memory setup requires a real, reachable `git` binary — unlike most of this project's git usage, this one surfaces a clear error rather than silently falling back, since sharing genuinely cannot work without git. Confirm `git --version` works from the project directory. |
| A teammate's Memories never show up | Confirm both of you have `sharedMemory: true` set, `raiminiscence-hooks`'s `SessionStart` hook installed, and a reachable git remote — Shared Memory pushes/pulls over the `raiminiscence-memory` branch's normal remote tracking, same as any other branch. On Claude Code, the `SessionEnd` hook also forces and awaits one last sync before the session ends; on Cursor/Codex CLI (no `SessionEnd`-equivalent hook registered yet), a pending Consolidation-time push may not have completed if the client exited very soon after. |
| No checkpoint nudge ever appears | You haven't registered the `Stop`/`stop` hook (it's separate from `SessionStart`/`UserPromptSubmit` — see § 6), or fewer than 15 minutes and 20 turns have passed since the session started/the last nudge fired. On Codex CLI, this is expected — its `Stop`-hook continuation isn't reliable yet. |
| `currentFocus` is always `null` | No active (non-stale/non-retracted) Checkpoint Memory exists yet for this project — either the nudge hasn't fired, or the agent hasn't acted on it. Call `remember(..., kind: "checkpoint")` once manually to confirm the lookup itself works. |
| `raiminiscence-inspect` isn't found on `PATH` | It ships in a separate package, `raiminiscence-cli` — `npm install -g raiminiscence-cli` (§ 10), not `raiminiscence-mcp`/`raiminiscence-hooks`. |
| `inspect`'s results disagree with what `recall` actually returned a moment ago | `inspect` is always computed fresh against current state — it never references a specific past `recall` call (there's nothing persisted to reference). If state changed between the two calls (a Memory decayed further, got staled, or an unrelated `recall` bumped its recall count), rerun `inspect` again rather than treating the two as describing the same instant. |
| A Memory stopped appearing in `recall`/`inspect` | Its file was altered outside the tools and no longer matches the schema, so it's skipped. The server logs a `memory file frontmatter failed validation` warning with the file's path. Restore the file from git, or delete it and `remember` the content again (§ 9). |
| `raiminiscence-hooks-install` fails with "has an unexpected shape" | Your client's own config file (`settings.json`, `hooks.json` or `config.toml`) has a malformed `hooks` section. The installer stops without writing anything. Fix the path the error names, then re-run it. |
| No Fix Nudge ever appears after fixing a failing command | Confirm `watchedCommands` in `.raiminiscence.config.json` actually matches the command you ran (§ 11), and that both `PostToolUse` and `PostToolUseFailure` are registered — either alone leaves the failure→fix transition undetectable. On Cursor/Codex CLI, this is expected — neither client is wired to this hook yet. |
