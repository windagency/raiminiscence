# `AGENTS.md` / `CLAUDE.md` fallback snippet

Copy the block below into your project's `AGENTS.md` or `CLAUDE.md` to get
proactive memory recall even without the `raiminiscence-hooks` package
installed.

## Usage

```markdown
## Persistent memory (rAIminiscence)

This project has a `raiminiscence` MCP server for cross-session memory.

- At the start of a session (or after `/clear`), call the `overview` tool
  (no arguments) once for a quick primer on standing project knowledge —
  prior decisions and distilled patterns — before starting work.
- Before making a design or architectural choice, or before repeating an
  approach that might have been tried before, call `recall` with a query
  describing what you're about to do. Don't re-litigate a decision or
  repeat a corrected mistake `recall` would have surfaced.
- When you make or observe a decision, discover a reusable pattern, or get
  corrected on a mistake, call `remember` to record it — don't wait until
  the end of the session.
- When recording a Decision Memory that's anchored to specific files,
  pass those paths as `relatedFiles` so the memory can be automatically
  invalidated once the codebase moves past it.
```

---

## Why

It only references the public `raiminiscence-mcp` tools (`overview`,
`recall`, `remember`) — never the hooks package's internal shim — so it works for
**any** MCP-capable client, and it's the **universal fallback**: useful on
its own, and still useful as a backstop even when the hooks package's
session-start priming is also installed.

## Verification

Following the snippet's instructions against a running `raiminiscence-mcp`
server should produce a proactive `overview` call near the start of a
fresh session, and proactive `recall` calls when the agent is about to
make a decision or repeat prior work — without being asked to call either
tool explicitly. This is a qualitative check against a live client/model
session (the wording either elicits the intended proactive behaviour or it
doesn't) rather than something an automated test can assert; re-verify
manually whenever the snippet's wording changes.
