# raiminiscence-hooks

Session-start priming, (v10, Claude Code/Codex CLI only) per-turn
auto-recall, (v11) Shared Memory's pull step, (v11, Claude Code only) a
session-end consolidation pass that also flushes Shared Memory,
(v13, Claude Code/Cursor only) a debounced checkpoint nudge on `Stop`/`stop`,
and (v18, Claude Code only) a Fix Nudge on a Watched Command's
failure→fix transition, for rAIminiscence: a small shim binary that calls
the `raiminiscence-mcp`
core engine's `overview`/`recall`/Shared Memory functions directly
(bypassing MCP, which isn't initialised yet this early in a session, and
shouldn't be round-tripped through on every prompt either) and formats
the result as a short summary-line primer.

## Installing the hooks

```sh
npx raiminiscence-hooks-install --client=claude-code   # or cursor, codex
```

Writes every hook registration the target client supports (`SessionStart`,
plus whichever of the hooks below that client has) directly into the
client's own config file, merging into it if one already exists, so you
never hand-write the hook configuration yourself. A hook the client
doesn't support is reported and skipped. Safe to run more than once — an
existing registration is left as-is, not duplicated.

Each hook runs the shim by absolute path, `node "<install dir>/dist/shim.js"`,
so it works however the package was installed: npm, pnpm, Yarn 1 or Bun.
Re-run the installer after reinstalling the package somewhere else, for
example under another Node version. It points every earlier registration,
including the `npx raiminiscence-hooks-shim` form older versions wrote, at
the new path instead of adding a second one.

- `--client=` one of `claude-code` (default), `cursor`, `codex`.
- `--scope=` `project` (default, writes into this repo's config) or `user`
  (writes into your home-directory config instead).

If you'd rather not run a script against your own config files, merge the
snippet by hand instead — see the per-client sections below, which document
what the installer writes. The snippets use `npx raiminiscence-hooks-shim`,
which `npx` finds only when npm installed this package globally. With any
other package manager, replace it with `node "<install dir>/dist/shim.js"`.

## Installing the per-turn auto-recall (`UserPromptSubmit`) hook — v10

Claude Code and Codex CLI only (see [Cursor](#cursor) below for why).
`npx raiminiscence-hooks-install` registers it for either client. To install
just this one hook, call
`installPromptRecallHook("claude-code" | "codex", scope?, projectRoot?)`
(exported from this package) programmatically, or merge the
`UserPromptSubmit` entry from the updated Claude Code/Codex snippets below
by hand. Same idempotency and non-disturbance guarantees as
`installHook`/`SessionStart`.

## Installing the `SessionEnd` hook (v11, Claude Code only)

Forces a full, awaited `consolidate()` pass at session end for every
project, Shared Memory or not — flushing (commits + pushes) Shared Memory
where that's enabled (see the
[user guide § Shared Memory](../../docs/user-guide.md#5-shared-memory-multiple-humansagents-on-one-project-optional-v11))
and, since v19, running a final Pruning/Promotion/Invalidation pass even
for local-only projects (see
[ADR-0025](../../docs/adr/0025-v19-opportunistic-consolidation-debounce.md)).
No other client's `SessionEnd` (or equivalent) hook support is confirmed
yet, mirroring `UserPromptSubmit`'s own Claude Code/Codex-only reach in
v10. `npx raiminiscence-hooks-install --client=claude-code` registers it.
To install just this one hook, call
`installSessionEndHook("claude-code", scope?, projectRoot?)`
(exported from this package) programmatically, or merge the `SessionEnd`
entry from the Claude Code snippet below by hand. Same idempotency
guarantees as `installHook`/`SessionStart`. Safe to install unconditionally
— it no longer gates on `sharedMemory: true`.

## Installing the `Stop`/`stop` checkpoint nudge (v13, Claude Code/Cursor only)

A debounced soft nudge (15 minutes or 20 turns since the session's last
checkpoint, whichever comes first — see
[ADR-0020](../../docs/adr/0020-v13-checkpoint-via-stop-hook.md)) suggesting
the agent call `remember` with `kind: "checkpoint"`. Never blocks/forces
compliance beyond that one suggestion. Codex CLI is not wired to this hook
yet — its `Stop`-hook continuation isn't reliable, mirroring
[ADR-0015](../../docs/adr/0015-v10-per-turn-auto-recall-excludes-cursor.md)'s
Cursor gap for a different client/mechanism pair.
`npx raiminiscence-hooks-install` registers it for either client. To install
just this one hook, call
`installStopHook("claude-code" | "cursor", scope?, projectRoot?)`
(exported from this package) programmatically, or merge the `Stop`/`stop`
entry from the updated Claude Code/Cursor snippets below by hand. Same
idempotency and non-disturbance guarantees as `installHook`/`SessionStart`.

## Installing the Fix Nudge `PostToolUse`/`PostToolUseFailure` hooks (v18, Claude Code only)

Watches a configured **Watched Command** (e.g. `tsc`, `pytest` — set via
`watchedCommands` in `.raiminiscence.config.json`, empty/absent by default)
go from failing to succeeding within the same session, and nudges the agent
to call `remember` with `isError: true` describing the failure and its fix
— see [ADR-0023](../../docs/adr/0023-v18-fix-nudge-via-post-tool-use-hook.md).
Off by default with no `watchedCommands` configured. No other client's
equivalent (exit-code visibility plus context injection, together) is
confirmed yet. `npx raiminiscence-hooks-install --client=claude-code`
registers this hook automatically, together with every other hook that
client supports — no separate flag needed, and no manual `settings.json`
editing required. Call `installFixNudgeHook("claude-code", scope?, projectRoot?)`
(exported from this package) directly only if you want to install just
this one hook in isolation, or merge the `PostToolUse`/`PostToolUseFailure`
entries from the updated Claude Code snippet below by hand. Same
idempotency and non-disturbance guarantees as `installHook`/`SessionStart`.

## Claude Code

**Validated** against Claude Code's documented `SessionStart` hook contract.

Merge [`src/templates/claude-code/settings-snippet.json`](./src/templates/claude-code/settings-snippet.json)
into your project's `.claude/settings.json` (or user-level settings):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact|fork",
        "hooks": [
          { "type": "command", "command": "npx raiminiscence-hooks-shim" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "npx raiminiscence-hooks-shim" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "npx raiminiscence-hooks-shim" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "npx raiminiscence-hooks-shim" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "npx raiminiscence-hooks-shim" }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          { "type": "command", "command": "npx raiminiscence-hooks-shim" }
        ]
      }
    ]
  }
}
```

The `SessionStart` entry is required for session-start priming;
`UserPromptSubmit` (v10) is optional and additive — add it for per-turn
auto-recall, or omit it (it has no config toggle; not registering the hook
*is* the off switch). `SessionEnd` (v11) is likewise optional — it forces
a final Consolidation pass, and also flushes Shared Memory when
`sharedMemory: true` is set in `.raiminiscence.config.json`. `Stop` (v13) is likewise optional and
additive — add it for the debounced checkpoint nudge, or omit it entirely.
`PostToolUse`/`PostToolUseFailure` (v18) are likewise optional and
additive, and both are required together for Fix Nudge — they only do
anything once `watchedCommands` is also set in
`.raiminiscence.config.json`.

For `SessionStart`, the shim reads the hook's JSON stdin payload (using its
`cwd` field to resolve the project's storage root), calls `overview` with
its own internal 2-second timeout, and prints
`{"hookSpecificOutput":{"additionalContext":"..."}}` on success or `{}` on
timeout/failure — it never blocks or errors session start, and it never
triggers Consolidation as a side effect. If `sharedMemory: true` is set
(v11), it also runs one-time worktree setup (idempotent) and an explicit
pull, appending a short note to the primer only when a genuine merge
conflict was auto-resolved.

For `UserPromptSubmit`, the shim additionally reads the payload's `prompt`
field and calls `recall` with that prompt's literal text as the query
(`triggerConsolidation: false`, `k = 10` explicitly per
[ADR-0034](../../docs/adr/0034-recall-default-k-is-three.md), otherwise `recall`'s own
defaults — `minScore = 0`) — same internal 2-second timeout, same output
shape, same fail-open-to-`{}` behaviour. This is `recall` itself,
automatically triggered on every prompt: a hit resets that Memory's decay
anchor exactly as an explicit `recall`
call would. `surfacedVia`/`conflictsWith`/`conflictCandidateWith` are never
included in the injected text.

For `SessionEnd` (v11, extended in v19 —
[ADR-0025](../../docs/adr/0025-v19-opportunistic-consolidation-debounce.md)),
the shim always forces a full, awaited `consolidate()` pass, then always
prints `{}` — there's no `additionalContext` to inject at session end.
Shared Memory's flush (commit + push) runs inside that pass when
`sharedMemory: true` is set; a local-only project now also gets a final
Pruning/Promotion/Invalidation pass instead of no-op-ing. Never throws or
blocks.

For `Stop` (v13, [ADR-0020](../../docs/adr/0020-v13-checkpoint-via-stop-hook.md)),
the shim tracks (in a small per-session state file under
`.raiminiscence/hooks-state/`) how long and how many turns it's been since
this session's last checkpoint nudge, and — once 15 minutes or 20 turns
have passed, whichever comes first — prints
`{"decision":"block","reason":"..."}` to suggest the agent call `remember`
with `kind: "checkpoint"`. This is a soft suggestion: if the agent doesn't
act on it, nothing re-blocks until the next debounce threshold crossing.
The hook always checks the payload's `stop_hook_active` field first and
never nudges when it's `true` (that Stop event is itself the continuation
from the previous block), so this can never recurse. Never throws.

For `PostToolUse`/`PostToolUseFailure` (v18,
[ADR-0023](../../docs/adr/0023-v18-fix-nudge-via-post-tool-use-hook.md)),
the shim ignores any `tool_name` other than `Bash` (only Bash's input/result
carries a shell command and exit code), matches the command against the
project's configured `watchedCommands` patterns, and tracks each matched
pattern's most recent failing invocation in a small per-session state file
under `.raiminiscence/hooks-state/`. There is no single Claude Code event
covering both a Bash command's success and failure: `PostToolUse` fires
only once a tool call *succeeds* (its Bash `tool_response` carries
`stdout`/`stderr`, no exit code — success is implied), while a failing Bash
command instead fires `PostToolUseFailure`, whose `error` field is
`"Exit code N"` followed by the command's combined stdout+stderr as one
block. The moment a matched pattern's stored failure is followed by that
same pattern succeeding, the shim prints
`{"hookSpecificOutput":{"additionalContext":"..."}}` naming both commands,
the failure's stderr (truncated to its last 40 lines), and instructing the
agent to call `remember` with `isError: true` — then clears that pattern's
stored record so it never re-fires for the same transition. An aborted
`PostToolUseFailure` (`is_interrupt: true`, e.g. Ctrl-C) is never treated as
a genuine command failure. Never throws.

## Cursor

**Hook contract CI-validated** (`sessionStart`, `stop`) — the real built
shim binary is exercised against both events' documented stdin/stdout
shapes in [`test/shim-contract.test.ts`](./test/shim-contract.test.ts), on
every push/PR. **Not validated against a live Cursor install**:
`sessionStart`'s stdin shape remains structurally reasoned from Cursor's
documented hook, which is shell-command-only and fire-and-forget — the
same shape as Claude Code's, just a different config file (see `stop`
below for its stronger, doc-confirmed footing).

Merge [`src/templates/cursor/hooks-snippet.json`](./src/templates/cursor/hooks-snippet.json)
into `.cursor/hooks.json` (project) or `~/.cursor/hooks.json` (user):

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "npx raiminiscence-hooks-shim" }],
    "stop": [{ "command": "npx raiminiscence-hooks-shim" }]
  }
}
```

**No per-turn auto-recall (v10) on Cursor.** Cursor's only per-turn hook,
`beforeSubmitPrompt`, can allow or block a prompt (`continue: true|false`)
but can't inject context back into it; its only context-injecting hook is
`sessionStart`, already covered above. There's no degraded middle ground to
offer here — Cursor keeps exactly today's `SessionStart`-only priming until
Cursor's hooks API changes. See
[ADR-0015](../../docs/adr/0015-v10-per-turn-auto-recall-excludes-cursor.md).

**`stop` (v13) works the same way as Claude Code's `Stop`** described
above, with one difference in output shape: Cursor's `stop` hook has no
`decision`/`reason` fields, so a due nudge instead prints
`{"followup_message":"..."}` — Cursor automatically submits this as the
next user message rather than injecting a system-level instruction. This
shape (`hook_event_name`, `conversation_id`, `loop_count`,
`followup_message`, `loop_limit` default `5`) is confirmed against
Cursor's current published hooks documentation as of this writing — a
stronger footing than Cursor's `sessionStart`/`beforeSubmitPrompt`
sections above, which remain structurally reasoned only. Still not
checked against a live Cursor install, same caveat as the rest of this
section. Cursor's own `loop_limit` (default 5 auto-follow-ups per script) is a
separate, independent safety net; this hook's own debounce reset (waiting
a full 15-minute/20-turn interval again after any nudge fires) is what
actually keeps it from firing repeatedly in quick succession.

## Codex CLI

**Hook contract CI-validated** (`SessionStart`, `UserPromptSubmit`) — the
real built shim binary is exercised against both events' stdin/stdout
shapes in [`test/shim-contract.test.ts`](./test/shim-contract.test.ts), on
every push/PR. **Not validated against a live Codex CLI install**: most
of this contract remains structurally reasoned, not doc-confirmed, since
Codex's own published docs don't pin down its exact stdin field names.
Codex's `SessionStart` hook nominally supports an `mcp_tool` handler type,
but Codex's own docs warn the target MCP server "may not be ready" at
that point — so this ships the same direct-shim `command` handler as the
other two clients, not the `mcp_tool` handler.

Merge [`src/templates/codex/hooks-snippet.toml`](./src/templates/codex/hooks-snippet.toml)
into `~/.codex/config.toml` (user) or `<repo>/.codex/config.toml`
(project — requires the `.codex/` directory to be trusted). The template
now includes both a `[[hooks.SessionStart]]` entry and a
`[[hooks.UserPromptSubmit]]` entry (v10, no `matcher` — it fires
unconditionally on every prompt), each invoking the same shim command.

## Client behavioural differences

For `SessionStart`, all three clients invoke the exact same
`raiminiscence-hooks-shim` binary, with the same internal 2-second timeout
and the same summary-line-only `additionalContext` output — only the
config file's location and format (JSON vs. TOML) differs. The Claude Code
path above is the one confirmed against primary-source research; treat
Cursor and Codex as reasoned but unvalidated until checked against a live
install of each.

For `UserPromptSubmit` (v10), Claude Code and Codex CLI get the identical
mechanism described above; Cursor gets nothing — see
[Cursor](#cursor) above. This is the first hook where the three clients
diverge in actual capability, not just registration syntax.

For `SessionEnd` (v11), only Claude Code is supported today — no other
client's equivalent hook is confirmed, so `SessionEndHookClient` is typed
as `"claude-code"` only and neither `installSessionEndHook` nor the type
system lets you pass Cursor or Codex to it.

For `Stop`/`stop` (v13, ADR-0020), Claude Code and Cursor are both
supported (with different output shapes — `decision`/`reason` vs.
`followup_message` — but the identical debounce logic underneath); Codex
CLI is excluded, so `StopHookClient` is typed as
`"claude-code" | "cursor"` only and neither `installStopHook` nor the type
system lets you pass Codex to it. This is a client-support gap, not a bug
— revisit once Codex's own `Stop`-hook continuation hardens.

For `PostToolUse`/`PostToolUseFailure` (v18, ADR-0023), only Claude Code is
supported today — Cursor's and Codex CLI's nearest equivalents (exit-code
visibility plus context injection, together) aren't confirmed against
primary documentation yet, so `FixNudgeHookClient` is typed as
`"claude-code"` only and neither `installFixNudgeHook` nor the type system
lets you pass Cursor or Codex to it. This is the first hook mechanism in
this project driven by a `PostToolUse`/`PostToolUseFailure` event rather
than `SessionStart`/`UserPromptSubmit`/`SessionEnd`/`Stop`.
