# Testing guide

[Back to 13-testing-strategy.md](../CODING_RULES/13-testing-strategy.md) • [Back to developer-guide.md](developer-guide.md)

How to verify rAIminiscence actually works, from three different seats:

- **As a QA user** — manual, black-box, through a real client (Claude
  Code/Cursor/Codex CLI) or the `raiminiscence-inspect` CLI, judging
  output the way an end user would.
- **As a CI runner** — automated, deterministic, no client/model in the
  loop. The command or test file to run; a gap is called out explicitly
  rather than papered over.
- **As an agent** — the actual MCP tool calls an agent makes mid-session
  to verify its own memory behaviour (including using `inspect` to see
  *why*), not a human reading a transcript.

Sections below mirror the [user guide](./user-guide.md)'s numbering so
the two stay easy to cross-reference. For repo layout and the "Testing
philosophy" behind which seam gets which kind of test, see the
[developer guide](./developer-guide.md) first — this document is about
*running*/*exercising* those seams, not designing them.

## Prerequisites

```bash
pnpm install
pnpm build   # required before any hooks/CLI-package or client-facing test —
             # raiminiscence-hooks and raiminiscence-cli import raiminiscence-mcp
             # by package name, not a relative path, so it must be built first
pnpm test    # the full CI-runner suite below, every package at once
```

A stale build is the most common false negative in a manual QA pass —
a client resolves each package's built `dist/`, not `src/`, so a source
edit with no rebuild silently keeps testing the old behaviour.

## 1. Install & client registration

**As a QA user:** for each of the three clients, follow [user guide
§1](./user-guide.md#1-install-the-mcp-server) exactly, start a fresh
session, and confirm all eight tools appear in the client's tool
picker/permissions UI before calling any of them.

**As a CI runner:** no client is actually installed in CI — that's
inherently manual. `packages/raiminiscence-mcp/test/server.test.ts`
asserts the server registers all eight tools with correct
name/description/input schema; `packages/raiminiscence-hooks/test/install.test.ts`
asserts the hooks CLI installer writes the correct hook config into each
client's own config format (Claude Code JSON, Cursor JSON, Codex TOML).

**As an agent:** you can't test your own installation — you wouldn't be
running yet. Once connected, confirm the connection is live by calling
any tool (`overview()` is the cheapest) and getting a well-formed
response rather than a connection error.

## 2. The eight tools

**As a QA user:** run the [example
session](./user-guide.md#example-session) verbatim through a real
client — `remember` a fact, then in a *separate* later session `recall`
a paraphrase of it and confirm it comes back with a sane `score`.

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/engine.test.ts \
                packages/raiminiscence-mcp/test/server.test.ts
```

`engine.test.ts` is the core-engine seam (deterministic, injected `now`,
no mocking); `server.test.ts` is the thin MCP-adapter seam — `isError`
on bad input, zero-match `recall`, `forget` on an already-retracted id,
`consolidate` with nothing eligible, `conflict` verdicts, and an older
client's ignored `maxHops` (see [developer guide § Testing
philosophy](./developer-guide.md#testing-philosophy)).

**As an agent:** `remember` a fact, then `recall` a paraphrase of it
mid-session. If it comes back with `surfacedVia: "match"`, the
round-trip works. If it doesn't come back at all, follow up with
`inspect({ query })` — its near-miss list tells you *why* (below
`minScore`? excluded as `stale`/`retracted`?) instead of guessing.

### Ranking

**As a QA user:** `remember` three related facts in one session; in a
later session, `recall` a query that matches only one of them and
confirm every result reports `surfacedVia: "match"`. Spreading Activation
was removed ([ADR-0037](adr/0037-coaccess-and-spreading-activation-are-removed.md)),
so a related fact appears only if it matches the query itself.

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/coaccess-removed.test.ts \
                packages/raiminiscence-mcp/test/recall-strength.test.ts
```

### Conflict detection & Promotion Audit

**As a QA user:** `remember` two Memories that say near-opposite things
about the same topic (cosine-similar enough to clear the Clustering
threshold: 0.82, or 0.87 for nomic's task-prefixed vectors). `recall` either one and confirm `conflictCandidateWith`
appears. Call `conflict` with `"contradicts"`, then `consolidate`, and
confirm neither Memory got merged into a Semantic Memory. Separately,
promote a Semantic Memory first, *then* record a `"contradicts"` verdict
on an ancestor and re-run `consolidate` — confirm the Semantic Memory
flips to `stale` (`counts.promotionAuditConflictCount: 1` in the response).

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/conflict.test.ts \
                packages/raiminiscence-mcp/test/conflict-edge.test.ts \
                packages/raiminiscence-mcp/test/recall-conflicts.test.ts \
                packages/raiminiscence-mcp/test/consolidate.test.ts
```

**As an agent:** identical tool calls to the QA-user column, except you
render the `"contradicts"`/`"supersedes"`/`"no-conflict"` judgment
yourself instead of a human reading both Memories.

### Commit Invalidation

**As a QA user:** `remember` a decision that names something concrete
("We chose webpack for bundling.") with no `relatedFiles`. Make a real
git commit whose subject matches the migration shape (`git commit -m
"migrate build tooling from webpack to vite"`). Call `consolidate` and
confirm `counts.memoriesCommitInvalidated: 1`; confirm the Memory no longer
appears in `recall`/`overview`.

**As a CI runner:** `npx vitest run packages/raiminiscence-mcp/test/invalidation.test.ts`

**As an agent:** the same sequence — this tends to happen naturally,
since the agent that made the commit is usually the one that later
calls `consolidate`.

## 3–4. Hooks: session-start priming & per-turn auto-recall

**As a QA user:** install `raiminiscence-hooks`, register the
`SessionStart` hook for your client, start a brand-new session, and
confirm the primer text appears in context *without* calling any tool.
Then register `UserPromptSubmit` (Claude Code/Codex CLI only — see
[ADR-0015](./adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)),
send an unrelated prompt, then a prompt matching a known Memory, and
confirm injected context changes between the two turns.

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-hooks/test/primer.test.ts \
                packages/raiminiscence-hooks/test/prompt-recall.test.ts \
                packages/raiminiscence-hooks/test/templates.test.ts \
                packages/raiminiscence-hooks/test/shim-contract.test.ts
```

`primer.ts`/`prompt-recall.ts` are tested with an injectable fake in
place of the real core-engine call (no real storage root/embedding
provider); `templates.test.ts` covers per-client snippet correctness;
`primer.test.ts` covers the 2-second timeout and silent degradation
contract. `shim-contract.test.ts` spawns the real, built `dist/shim.js`
binary as a subprocess and asserts on stdout/exit code for every
currently-wired Claude Code hook event (`SessionStart`,
`UserPromptSubmit`, `SessionEnd`, `Stop`'s debounced/due Checkpoint-nudge
paths, and `PostToolUse`/`PostToolUseFailure`'s Fix Nudge), including
malformed/schema-invalid JSON input — a contract-level regression
baseline, not a timeout test.

**As an agent:** you can't directly observe your own hook firing the
way a human reads the raw transcript. Instead: if `overview`-shaped
content is already present in your context at turn one, before you've
called any tool, the `SessionStart` hook is working. To test the
degraded path, have the human temporarily unregister the hook and
confirm you fall back to manual `recall`/`overview` calls with no primer.

## 5. Shared Memory

**As a QA user:** with `sharedMemory: true` on two real checkouts (two
machines, or a teammate), confirm the `raiminiscence-memory` branch and
`.raiminiscence/memory/` worktree get created on the first
`SessionStart` after opting in. `remember` from one checkout, push, then
`recall` from the other after its next `SessionStart` pull and confirm
the fact is visible.

**As a CI runner:**

```bash
pnpm build
npx vitest run packages/raiminiscence-mcp/test/shared-memory.test.ts \
                packages/raiminiscence-hooks/test/shared-memory-sync.test.ts
```

`shared-memory.test.ts` is the genuine git-integration seam — real,
unmocked temporary git repositories exercising worktree setup,
commit/push/pull, and the merge driver end-to-end. It needs `pnpm build`
first, since the merge driver runs as a real subprocess from `dist/`. `shared-memory-sync.test.ts` tests the hook wiring
(`SessionStart` pull, `SessionEnd` forced-consolidation-and-await) with
every git/consolidate dependency injected.

**As an agent:** `remember` something, then either wait for a second
agent instance on the same shared branch to `recall` it, or call
`overview()` yourself after a pull and confirm `currentFocus.project`
differs from `currentFocus.own` when a teammate's Checkpoint is newer.

## 6. Checkpoints

**As a QA user:** work continuously in one session for 15+ minutes or
20+ turns and confirm the `Stop`/`stop` hook nudge text appears
(Claude Code/Cursor only). In the next session, call `overview()` and
confirm `currentFocus.own` reflects the Checkpoint you wrote (or didn't).

**As a CI runner:** `npx vitest run packages/raiminiscence-hooks/test/checkpoint-nudge.test.ts`
— covers both the pure debounce decision (`{ elapsedMs,
turnsSinceNudge }` in, nudge-or-not out, no real timer) and the stateful
wrapper that persists turn/time bookkeeping via an injectable
`stateStore`.

**As an agent:** don't wait for the nudge to test this — call
`remember("...", kind: "checkpoint")` directly, then in a fresh session
call `overview()` and confirm it comes back under `currentFocus.own`.

## 7. Scope: project vs. global

**As a QA user:** `remember(..., scope: "global")` from two different
project directories and confirm `originatingProject` differs between
them on `recall`. Add a `.raiminiscence.config.json` with `storageRoot`
to a monorepo subpackage and confirm its Memories don't appear from the
repo root's own `recall`.

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/scope.test.ts \
                packages/raiminiscence-mcp/test/project-root.test.ts
```

**As an agent:** the same two tool-call sequences as the QA-user column.

## 8. Secrets / redaction

**As a QA user:** `remember` a fact containing a fake credential shape
(a `password=`/`api_key=` assignment, a bearer token, a connection
string) and open the resulting file under
`.raiminiscence/memory/{episodic,semantic,decisions,checkpoints}/<ulid>.md`
to confirm it was redacted
before ever touching disk.

**As a CI runner:** `npx vitest run packages/raiminiscence-mcp/test/redaction.test.ts`

**As an agent:** same check — and remember this is explicitly **not** a
compliance guarantee (see [user guide §8](./user-guide.md#8-secrets)),
so don't pass a real secret to `remember` expecting redaction to catch
every shape.

## 9. Direct memory-file inspection

**As a QA user:** open a Memory's `.md` file directly and confirm its
YAML frontmatter (kind, confidence, `schemaVersion`, decay counters)
matches what the tool call that created/last touched it actually
returned.

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/storage.test.ts \
                packages/raiminiscence-mcp/test/record-index.test.ts \
                packages/raiminiscence-mcp/test/schema-v2.test.ts
```

**As an agent:** not normally needed — `inspect` (§10) supersedes
reading the raw file. Reach for the raw file only if `inspect` itself is
suspected of being wrong.

## 10. Inspect (`raiminiscence-inspect` CLI + MCP tool)

**As a QA user:** run all three modes directly from a terminal —

```bash
raiminiscence-inspect <id>
raiminiscence-inspect --query="..." [--detailed]
raiminiscence-inspect --list --kind=semantic --tier=stale
```

— and cross-check the `--query` mode's result set against what `recall`
itself actually returned for the same query moments earlier (same
qualifying set; `inspect` never mutates, so re-running it doesn't move
the goalposts the way re-running `recall` would).

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/inspect.test.ts \
                packages/raiminiscence-cli/test/args.test.ts \
                packages/raiminiscence-cli/test/run.test.ts
```

`inspect.test.ts` is where the "identical qualifying-result set as an
equivalent `recall()` call" invariant is asserted once, at the core
seam — `raiminiscence-cli`'s own tests only cover flag parsing and
formatted-output orchestration, not the scoring math a second time.

**As an agent:** call the `inspect` MCP tool (`{ id }` | `{ query,
verbosity? }` | `{ list: true, filters, verbosity? }`) whenever asked to
explain your own recall/decay behaviour, or when a `recall` result looks
wrong and you want the near-miss list before assuming a bug.

## 11. Fix Nudge

**As a QA user:** set `watchedCommands` in `.raiminiscence.config.json`,
run a matching command so it fails, then run it again so it succeeds,
and confirm the nudge appears carrying the failed command and its last
~40 lines of stderr (Claude Code only).

**As a CI runner:** `npx vitest run packages/raiminiscence-hooks/test/fix-nudge.test.ts`

**As an agent:** react to the nudge with `remember(..., isError: true)`
— that flag is what lets Error Amplification extend the Memory's
half-life correctly. You can also self-test the whole loop by
deliberately breaking then fixing a watched command yourself.

## Decay, Strength & Reinforcement Ceiling

**As a QA user:** `recall`/give positive `feedback` on the same Memory
repeatedly, then watch `raiminiscence-inspect <id>`'s Half-life/"Ceiling
used" fields climb toward, but never past, the reported max.

**As a CI runner:** `npx vitest run packages/raiminiscence-mcp/test/decay.test.ts`

**As an agent:** the same reinforcement loop, checked via the `inspect`
tool's `{ id }` mode instead of the CLI.

## Embedding providers

**As a QA user:** the MCP `remember` tool answers `embedded: "pending"`
and writes the vector after
([ADR-0041](./adr/0041-the-mcp-server-answers-remember-before-the-embed.md)).
Confirm `recall` then reports `usedFallback: false` with the default
(v17) Embedded Provider reachable; confirm it degrades to
`usedFallback: true` (lexical-only) when offline with an empty model
cache, with a "background embed failed" warning in the server log. If configured onto the opt-in
Ollama Provider instead, stop the Ollama daemon and confirm the same
degradation. After changing providers, run `consolidate` and confirm
previously-embedded Memories get re-embedded rather than silently
staying stale-embedded forever.

**As a CI runner:**

```bash
npx vitest run packages/raiminiscence-mcp/test/embedded.test.ts \
                packages/raiminiscence-mcp/test/default-provider.test.ts \
                packages/raiminiscence-mcp/test/embedding-provider-config.test.ts \
                packages/raiminiscence-mcp/test/embeddings.test.ts \
                packages/raiminiscence-mcp/test/reembedding.test.ts
```

**As an agent:** check `recall`'s `usedFallback` field. Through the MCP
server, `remember` answers before it embeds, so its `embedded` field is
`"pending"` and no longer reports a failed embed. If `usedFallback` is
`true`, that's the signal from the [user guide's troubleshooting
table](./user-guide.md#troubleshooting) — don't paper over it by
assuming semantic recall is working when it's actually lexical-fallback
only.

## Recall latency cache (v14)

Not user-facing beyond "recall stays fast" — there's no QA-user-visible
behaviour to click through here, and it isn't something an agent verifies
mid-session either.

**As a CI runner:** `npx vitest run packages/raiminiscence-mcp/test/recall-cache.test.ts`
covers cache-versioning/invalidation *correctness*. For actual latency
numbers at scale, see [Benchmarks](#benchmarks) below — this is a
maintainer/benchmark concern, not a unit-test one.

## Benchmarks

**As a QA user / CI runner (same actor here — a human or CI job actually
running the comparison, not the memory-holding agent):**

```bash
node_modules/.bin/tsx benchmarks/compare.ts            # Recall@k/Precision@k + invalidation correctness
node_modules/.bin/tsx benchmarks/extended-compare.ts   # outcome-feedback formula + per-turn auto-recall latency
node_modules/.bin/tsx benchmarks/build-dashboard.ts    # regenerate dashboard.html — do this after every re-run
```

Remember: `consolidate()` is async since v17 — an unawaited call in a
benchmark runner silently breaks invalidation checks (see
`benchmarks/raiminiscence-runner/*.ts` for the current correct pattern).
Runners import the packages' *built* output, not `src/` — always
`pnpm build` first, or a re-run silently reports stale numbers.

The interactive results: **[`benchmarks/dashboard.html`](../benchmarks/dashboard.html)**
— a static, self-contained page (no server, no network calls for its
data) built by `build-dashboard.ts` from the real result JSON, checked
into git and openable directly in a browser.

**As an agent:** not applicable. Benchmarks are a maintainer/CI concern
about the system as a whole, not something the memory-holding agent
itself runs or reasons about mid-session.

## Full CI pipeline & npm publish

**As a QA user:** N/A in the usual sense, but after any real npm
publish, manually re-run `npx raiminiscence-mcp` / `npx
raiminiscence-inspect` against the *real* registry (not a local
workspace link) to confirm the README's quick start genuinely works.

**As a CI runner:**

- `.github/workflows/ci.yml`, on every push to and PR into `main`,
  `int` and `release/**`: `verify` (lint, duplication report, format,
  licence and back-link checks, build, typecheck, `pnpm test:coverage`
  against the 60% threshold) on the pinned Node 26.9.0/Linux; `node-compat`
  (build and test on Node 22, 24 and 26 across Linux, macOS and Windows); `audit`;
  and, on PRs, `lint-commits`, `gitleaks`, and `tdd-order` (`feat-*`/
  `fix-*` PRs into `int`).
- `codeql.yml`, `dependency-review.yml`, `pr-title.yml`,
  `allowed-merge-source.yml` and `scorecard.yml`: security and
  process checks; which are required where is in
  `.github/rulesets/README.md`.
- `.github/workflows/publish.yml`, on every push to `main` or
  `release/**`: re-runs the verification, writes an SBOM, then
  semantic-release stages all four packages on npm in lockstep. See
  [`deployment.md`](./deployment.md).

**As an agent:** N/A — a staged npm release only becomes installable
when a maintainer approves it with 2FA, never something an agent
triggers autonomously.
