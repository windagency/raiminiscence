# raiminiscence-cli

`raiminiscence-inspect` (v15): a read-only diagnostic CLI for
rAIminiscence — see *why* a Memory has the Strength it has, why a query
would or wouldn't surface a candidate, or browse/list Memories by filter.
Never a Recall: it never resets a decay anchor or increments
`recallCount`, unlike an actual `recall` call. Imports
`raiminiscence-mcp`'s public library functions directly
(`inspectMemory`/`inspectQuery`/`browseMemories`/`resolveStorageRoot`) —
bypasses MCP entirely, the same pattern `raiminiscence-hooks` already uses.
Full design/rationale:
[ADR-0022](../../docs/adr/0022-v15-inspect-side-effect-free-scoring-path.md).

## Install

**Not yet published to npm.** The command below is the intended eventual
usage once it is. Until then, run it from source: `pnpm install && pnpm
-r build` at the repo root, then run
`node packages/raiminiscence-cli/dist/inspect-cli.js` in place of
`raiminiscence-inspect` below (see
[developer guide](../../docs/developer-guide.md)).

```sh
npm install -g raiminiscence-cli
```

## Usage

**Explain one Memory by id:**

```sh
raiminiscence-inspect <memory-id>
```

**Explain how a query would score right now** (Recall's own similarity ×
Strength × Confidence Tier weighting, computed
fresh, on a path that never mutates anything):

```sh
raiminiscence-inspect --query="what did we decide about the write model?"
raiminiscence-inspect --query="..." --detailed   # show every near-miss, not just a count
```

**Browse/list Memories by filter:**

```sh
raiminiscence-inspect --list
raiminiscence-inspect --list --kind=semantic --tier=stale
raiminiscence-inspect --list --min-strength=0 --max-strength=0.1
raiminiscence-inspect --list --scope=global --since=2026-01-01 --until=2026-06-01
raiminiscence-inspect --list --detailed          # full detail per result, not just id/kind/strength/confidence
```

Flags: `--kind=`, `--tier=` (Confidence Tier), `--min-strength=`/
`--max-strength=`, `--scope=`, `--since=`/`--until=` (`createdAt` range,
ISO date strings) — all `--list`-only, combinable. A bare positional
argument (id lookup), `--query=`, and `--list` are mutually exclusive;
exactly one is required per invocation.

Output is compact by default (a near-miss list collapses to a count with
a rerun hint; a browse listing shows one line per result); `--detailed`
shows everything.

## Also available as an MCP tool

The same three modes are registered as the eighth tool, `inspect`, on
`raiminiscence-mcp`'s server — so an agent can call it mid-session too,
not just a developer at a terminal. See
[`raiminiscence-mcp` README § Tools](../raiminiscence-mcp/README.md#tools).
