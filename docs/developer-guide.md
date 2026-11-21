# Developer guide

[Back to README.md](../README.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to testing-guide.md](testing-guide.md) • [Back to user-guide.md](user-guide.md) • [Back to NEXT_STEPS.md](../NEXT_STEPS.md) • [Back to packages/raiminiscence-cli/README.md](../packages/raiminiscence-cli/README.md) • [Back to packages/raiminiscence-mcp/README.md](../packages/raiminiscence-mcp/README.md)

For a contributor working **on** the rAIminiscence codebase itself. If
you want to use rAIminiscence in your own project, see the
[user guide](./user-guide.md) instead.

## Repo layout

```
/
├── README.md                    Landing page
├── CONTEXT.md                   Domain glossary (canonical vocabulary)
├── AGENTS.md                    Pointers for AI agents working in this repo
├── __tests__/architecture/      Workspace-wide architecture rules (see Testing philosophy)
├── docs/
│   ├── adr/                     Architecturally-significant decisions
│   ├── agents/                  Agent-skill conventions (issue tracker, etc.)
│   ├── architecture/            hld.md, lld.md (this documentation set)
│   ├── user-guide.md
│   ├── developer-guide.md       (this file)
│   ├── codemap.md / codemap.json   Generated AST index — see below
│   └── ...
├── packages/
│   ├── raiminiscence-mcp/       Core engine + MCP server
│   │   ├── src/core/            Pure/importable library
│   │   │   ├── shared-memory/   v11: git worktree setup, sync automation, merge driver
│   │   │   ├── query-scoring.ts  v15: recall()'s scoring core, shared with inspectQuery()
│   │   │   └── inspect.ts       v15: inspectMemory/inspectQuery/browseMemories
│   │   ├── src/server.ts        MCP tool wiring
│   │   └── test/
│   ├── raiminiscence-hooks/     Session-start/-end + per-turn auto-recall + checkpoint nudge (v13) + Fix Nudge (v18) shim + client templates
│   │   ├── src/
│   │   └── test/
│   ├── raiminiscence-cli/       v15: raiminiscence-inspect CLI (args.ts, format.ts, run.ts, inspect-cli.ts)
│   │   ├── src/
│   │   └── test/
│   └── raiminiscence-argv/      Shared flag() parsing helper, used by -hooks and -cli
│       ├── src/
│       └── test/
└── scripts/
    └── build-codemap.ts         `pnpm codemap`
```

pnpm workspaces (`pnpm-workspace.yaml`); `raiminiscence-hooks` and
`raiminiscence-cli` each depend on `raiminiscence-mcp` via `workspace:*`,
and both also depend on the small shared `raiminiscence-argv` package
(just `flag()`) via the same mechanism.

## Build, test, typecheck

```bash
pnpm install
pnpm -r build        # tsc for each package (raiminiscence-mcp must build
                      # before raiminiscence-hooks/raiminiscence-cli can
                      # resolve its types — they import it via its package
                      # name, not a relative path)
pnpm typecheck        # tsc --noEmit: each package's src/, then tests, benchmarks and scripts
pnpm test             # vitest: package tests, architecture tests, benchmark tests
```

Run a single test file directly: `npx vitest run packages/raiminiscence-mcp/test/decay.test.ts`.

Inside a package, reach another folder through the package's `#src/*`
subpath import (`import { memoryStoreDir } from "#src/core/storage.js"`),
never `../`. Tests import their source the same way. Vitest resolves
`#src/*` to `src/`, Node to `dist/`. Rationale:
[ADR-0029](./adr/0029-subpath-imports-replace-parent-relative-imports.md).

For how to verify a specific feature works — as a QA user through a real
client, as a CI runner, or as an agent calling the tools mid-session —
see the [testing guide](./testing-guide.md).

## How the packages relate

`raiminiscence-mcp`'s core engine (`src/core/`) is a **plain importable
library** — no MCP dependency in the engine itself. `src/server.ts` is a
thin MCP adapter on top of it (tool registration, zod schemas, error
wrapping). `raiminiscence-hooks` imports the same library functions
directly (`overview`, `recall`, `resolveStorageRoot`, `ensureGitignoreEntry`,
and — v11 — `ensureSharedMemoryWorktree`/`pullSharedMemory`/
`flushSharedMemory`/`resolveSharedMemory`) to bypass MCP entirely for
session-start priming, (v10) per-turn auto-recall, (v11) Shared Memory's
setup/pull/flush steps, and (v13) the `Stop`/`stop` checkpoint nudge,
which is why the core engine is factored as a library rather than
only exposed via the MCP transport — see
[ADR-0005](./adr/0005-one-shared-hooks-package.md),
[ADR-0015](./adr/0015-v10-per-turn-auto-recall-excludes-cursor.md),
[ADR-0017](./adr/0017-v11-shared-memory-via-git-worktree.md),
[ADR-0020](./adr/0020-v13-checkpoint-via-stop-hook.md), and
the [HLD](./architecture/hld.md) for why. Unlike the other three, the
`Stop`/`stop` nudge (`checkpoint-nudge.ts`) doesn't call `overview()`/
`recall()` at all — it only reuses `ensureGitignoreEntry` for its own
per-session debounce-state file, since the actual Checkpoint write is an
ordinary `remember` call the agent makes itself in response to the nudge.

**v15** adds a third package, `raiminiscence-cli`, on the exact same
precedent: its one bin, `raiminiscence-inspect`, imports
`inspectMemory`/`inspectQuery`/`browseMemories`/`resolveStorageRoot`
directly from `raiminiscence-mcp` rather than talking MCP, the same way
`raiminiscence-hooks` already does for `overview`/`recall`. Unlike
`recall()`, these three core functions are pure/read-only — see
[ADR-0022](./adr/0022-v15-inspect-side-effect-free-scoring-path.md) —
so `raiminiscence-cli` needed no new bypass-safety argument beyond the
one `raiminiscence-hooks` already established.

A fourth package, `raiminiscence-argv`, holds just the one `flag()`
helper both `raiminiscence-cli` and `raiminiscence-hooks` hand-rolled
identically for their own `--name=value` argument parsing — extracted
once the duplication was found, rather than housed in `raiminiscence-mcp`
(an unrelated concern for that package) or grown into a speculative
general-purpose "CLI utils" package.

## Adding a new MCP tool

1. Add the pure logic as a function in its own `packages/raiminiscence-mcp/src/core/<tool>.ts`
   module, re-exported from `src/core/engine.ts` (a barrel, one module per
   tool) — no MCP types, no filesystem-path magic beyond what `storage.ts`/`project-root.ts` already provide.
2. Define its input shape in `src/tool-input-schema.ts` (the only place
   `zod` may be imported, along with the other `*-schema.ts` modules —
   [ADR-0027](./adr/0027-zod-confined-to-schema-modules.md)), then register
   it in `src/server.ts` via `server.registerTool(name, { description, inputSchema }, handler)`,
   wrapping the call in the shared `handle()` helper so errors surface as
   `isError: true` instead of a thrown JSON-RPC error.
3. Write tests at the **core engine seam** first (fixture Memories +
   an injected `now`, no MCP/filesystem beyond fixture setup where
   possible) — see "Testing philosophy" below.
4. Update the domain glossary (`CONTEXT.md`) if the tool introduces new
   vocabulary, and the LLD if the tool's behaviour is part of the
   documented contract.

## Testing philosophy

Three seams (most tests belong at the first one):

1. **Core engine** (dominant seam) — pure or cleanly injectable logic:
   decay/Strength formula, Confidence Tier transitions, Clustering/
   Promotion/Pruning thresholds, frontmatter read/write, project-root
   detection, redaction pattern-matching. No direct `Date.now()`/
   `Math.random()` calls — `now` is always an explicit, injectable
   parameter, so tests assert deterministic outcomes with no mocking.
2. **MCP tool layer** (`server.ts`) — thin adapter; test only what the
   core seam can't cover from here: `isError` behaviour on bad input, the
   eight tools' exact I/O shapes including edge cases (zero `recall`
   matches, `forget` on an already-retracted id, `consolidate` with
   nothing eligible, `conflict` verdicts, an older client's ignored `maxHops`, `inspect`'s
   discriminated-mode dispatch and its malformed-input rejection), and
   `source.client` being derived from the session handshake rather than
   accepted as caller input.
3. **Hooks shim** (`raiminiscence-hooks`) — its own boundary since it
   deliberately bypasses MCP: the 2-second internal timeout and silent
   degradation, and summary-line-only output formatting, independent of
   the MCP tool layer. `primer.ts` (`SessionStart`/`overview`) and
   `prompt-recall.ts` (`UserPromptSubmit`/`recall`, v10) are tested the
   same way — an injectable fake in place of the real core-engine call, no
   real storage root or embedding provider. `shared-memory-sync.ts` (v11,
   `SessionStart`'s pull step and the `SessionEnd` forced-consolidation
   step) follows the same pattern: every dependency
   (`sharedMemoryEnabled`/`ensureWorktree`/`pull` for `SessionStart`;
   `consolidate`/`settleOpportunisticConsolidation` for `SessionEnd`) is
   injectable, and it never throws. Since v19 (ADR-0025), `SessionEnd` no
   longer gates on `sharedMemoryEnabled` at all — it unconditionally calls
   `consolidate({ ..., awaitPush: true })`, on Claude Code only
   (`SESSION_END_HOOK_CLIENTS`); Cursor/Codex CLI get no equivalent hook
   here yet, so don't assume this end-of-session guarantee applies to
   them. `checkpoint-nudge.ts`
   (v13, `Stop`/`stop`) splits this further: its debounce *decision*
   (`isCheckpointNudgeDue`/`checkpointNudgeOutput`) is a pure function of
   an explicit `{ elapsedMs, turnsSinceNudge }` — no real timer or counter
   read inside it, so it's tested purely in-memory — while the stateful
   wrapper (`checkpointNudge`) that persists per-session turn/time
   bookkeeping to disk takes an injectable `stateStore` the same way
   `promptRecallText` takes an injectable `recallFn`, so even its
   filesystem-touching path stays deterministic under test.

**v15** adds a fifth seam, `raiminiscence-cli`'s own test suite: flag
parsing (`args.test.ts`, no filesystem at all — pure input/output) and
`run.ts`'s orchestration (`run.test.ts`, fixture storage roots, the same
tmp-dir pattern as every core-engine test) — testing the *formatted
output*, not re-testing `recall`'s scoring math a second time (that
invariant — "identical qualifying-result set as an equivalent `recall()`
call" — is asserted once, at the core seam, in `inspect.test.ts`).

**Architecture rules** are tested at two levels. Each package's
`__tests__/architecture/` holds its own `arch-unit-ts` suite: static
import boundaries inside that package. The root `__tests__/architecture/`
holds the rules that span packages or that `arch-unit-ts` can't see,
reading source with the TypeScript compiler API instead:
`workspace-dependencies.test.ts` (the only allowed links between packages,
from every `package.json` dependency field), `mcp-library-only.test.ts`
(hooks and cli never reach `raiminiscence-mcp`'s MCP server, by subpath,
by name, by namespace or dynamic import), and
`third-party-containment.test.ts` (each wrapped library stays in its
adapter file, whether it's imported statically, dynamically, by
`require()`, or as a Node built-in without the `node:` prefix; `zod` is
allowed in any `*-schema.ts` module and nowhere else). A new
package fails `workspace-dependencies.test.ts` until it's added to the
allowed list there.

v11 (ADR-0017) added a genuine **fourth, git-integration seam** inside
`raiminiscence-mcp/test/shared-memory.test.ts`: real, unmocked temporary
git repositories exercising worktree setup, commit/push/pull automation,
and the merge driver end-to-end — a mocked-out git layer would validate
almost nothing about a subsystem whose entire correctness is "does real
git actually do what we think," matching `benchmarks/`'s own precedent of
real execution over narrative claims. That file's `beforeAll` runs the
package's own `tsc` build, since the merge driver runs as a real
subprocess git invokes by path and needs the compiled artifact to exist.

## The codemap tool

`pnpm codemap` (`scripts/build-codemap.ts`, using `ts-morph`) walks every
`packages/*/src/**/*.ts` file and regenerates:

- `docs/codemap.json` — machine-readable: file → every named function,
  class, interface, type alias, and top-level constant, with its
  signature and line number.
- `docs/codemap.md` — a human-readable Markdown table generated from the
  same data.

**Regenerate it after adding, removing, or renaming a top-level symbol.**
Both files are generated — never hand-edit them; edit `build-codemap.ts`
itself if the *format* needs to change.

## Releasing / versioning

All four packages share one version, bumped together by
semantic-release from the Conventional Commits merged into `main`
([ADR-0026](./adr/0026-lockstep-versioning-with-semantic-release.md));
nobody edits a version by hand. The release pipeline:
[`deployment.md`](./deployment.md). No migration tooling exists
yet for the
Memory frontmatter's `schemaVersion` field — it's reserved from day one,
but a real migration mechanism is still an open item (see
[`NEXT_STEPS.md`](../NEXT_STEPS.md)).
`CURRENT_SCHEMA_VERSION` moved from `2` to `3` in v11 for the new optional
`writer` field — additive fields stay migration-free by convention
(existing Memory files simply parse with the field `undefined`), so this
was a plain constant bump, no migration script.
