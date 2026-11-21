# AGENTS.md

[Back to README.md](README.md) • [Back to 02-language-convention.md](CODING_RULES/02-language-convention.md) • [Back to 15-shell-tooling.md](CODING_RULES/15-shell-tooling.md) • [Back to CONTRIBUTING.md](CONTRIBUTING.md) • [Back to 0004-memory-complements-static-docs.md](docs/adr/0004-memory-complements-static-docs.md) • [Back to hld.md](docs/architecture/hld.md) • [Back to developer-guide.md](docs/developer-guide.md) • [Back to user-guide.md](docs/user-guide.md) • [Back to agents-md-snippet.md](packages/raiminiscence-mcp/docs/agents-md-snippet.md) • [Back to packages/raiminiscence-mcp/README.md](packages/raiminiscence-mcp/README.md)

Read this before touching any code in this repository. It governs how an agent works here. For what the code must look like, start with `CONTRIBUTING.md`.

## Read next

- Issues live on the GitHub issue tracker. Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
- `CONTRIBUTING.md`: the routing table into `CODING_RULES/`, the definition of done, the non-negotiables.
- `CODING_RULES/09-enforcement.md`: severity levels and the PR checklist you're judged against.
- `NEXT_STEPS.md`: the checklist of open, decided-but-not-built work. The source of truth for what's left, not any doc that mentions it in passing.
- Any `AGENTS.md` in a closer subdirectory. It wins over this file for everything under it.

## Operating rules

These apply to every task, every file, every language in this repo.

1. Don't assume. Don't hide confusion. Surface tradeoffs instead of picking silently.
2. Write the minimum code that solves the stated problem. No speculative code. No unrequested abstraction.
3. Touch only what the task requires. Clean up only the mess you made.
4. Define success criteria before you start. Run them. Loop until they pass. "Looks right" is not done.
5. Read a file before you write to it. Skip the re-read only if it hasn't changed.
6. Never guess an API, a version, a flag, a commit SHA, or a package name. Read the code or the docs first. Then assert.
7. Treat your own review findings as unverified. This includes findings from earlier in the same task. A finding is an inference until you confirm it against the actual file.

## Shell tooling

Use the modern tool when it's installed, fall back to the classic one if not, and check with `command -v <tool>` rather than assuming either way. Ripgrep's `rg` over `grep`, `fd` over `find`, `jq`/`yq` over `cat` on JSON/YAML, `eza` over `ls`/`tree`, `zoxide` over a `cd` chain, `fzf` over scrolling a list by hand, `lazygit` over a multi-step Git workflow. Rationale and example commands for each: `CODING_RULES/15-shell-tooling.md`.

## Managing context

Compaction, summarizing a long session and continuing from the summary, is a feature of the tool running this agent, not something this file can trigger. In most current tools only the operator or the platform's own threshold invokes it, not the agent.

What's actually under the agent's own control:

- Read narrowly. Extract the field or line that answers the question rather than reading a whole file, per Shell tooling above.
- Don't re-read a file that hasn't changed, per Operating rule 5.
- At a natural breakpoint, a task finished, a milestone reached, write a short progress note to a file: what's done, what was decided, what's left. If the session resets or compacts after that, the next turn reads the file instead of relying on memory of the conversation.
- If a task is running long and the current tool has a manual compaction or context-reset command, tell the operator at the breakpoint instead of pushing through. Don't name the specific command here; it's different per tool and would be wrong the moment a different one reads this file.

## Test-first

Default to RED → GREEN → REFACTOR for non-trivial business logic (`CODING_RULES/01-principles.md`). Write the failing test first, run it, and confirm it fails for the expected reason before writing the implementation. Keep the test and the implementation in separate commits. Exempt only pure configuration and one-line passthroughs, with a `TDD-Exempt: <reason>` trailer that a reviewer approves.

## Verification loop

A task is not done when the code looks right. Run every item in `CONTRIBUTING.md`'s definition of done and confirm each one; don't assume it. Re-check that any `CODING_RULES/` file touched by this change still holds; don't rely on an earlier read. If a check fails, fix it and re-run it. Don't report success before the check that proves it has actually run.

## Setup, build, and test commands

- Install deps: `pnpm install`
- Run dev server: N/A — this project ships an MCP stdio server and a CLI, not a service with a dev server.
- Run tests: `pnpm test` (all packages); a single file: `npx vitest run packages/<package>/test/<file>.test.ts`
- Run lint: `pnpm lint` (ESLint) and `pnpm format:check` (Prettier); `pnpm format` to auto-fix
- Run type-check: `pnpm typecheck` (needs `pnpm build` first: packages resolve their siblings through built `dist/` declarations). Covers each package's `src/`, then tests, benchmarks and scripts through the root `tsconfig.json`
- Build: `pnpm build`
- Run tests with the coverage threshold: `pnpm test:coverage` (what CI runs)
- Report duplication: `pnpm lint:duplication` (jscpd, informational)
- Check third-party licence manifest: `pnpm licenses:check`; regenerate after a dependency change with `pnpm licenses:generate`
- Check Markdown back-links: `pnpm backlinks:check`; regenerate after adding or removing a mention of a `.md` file with `pnpm backlinks:generate`
- Check the npm package README: `pnpm readme:check`; regenerate after editing the root `README.md` or `packages/raiminiscence-mcp/docs/readme-package-sections.md` with `pnpm readme:generate`. Never edit `packages/raiminiscence-mcp/README.md` by hand
- Check `CHANGELOG.md`'s Unreleased section against `int`'s commits: `pnpm changelog:check`; `pnpm changelog:sync` writes it. Never edit `CHANGELOG.md` below its intro by hand; CI keeps it, see `docs/semver.md`
- Release: `pnpm release` (semantic-release). CI-only, driven by `publish.yml`; never run it locally, see `docs/deployment.md`

The exact CI order is in `.github/workflows/ci.yml`'s `verify` job. Dev environment with Node, pnpm and gitleaks preinstalled: `.devcontainer/`.

If a command here is missing or stale, read `package.json` or the build config directly. Don't guess the flag. Fix this section once you've confirmed the real command.

## Code style

TypeScript, Node, React. Full rules live in `CODING_RULES/`, routed by concern from `CONTRIBUTING.md`. The one rule from that set severe enough to repeat here: no `any` without a comment justifying it. `CONTRIBUTING.md`'s non-negotiables list has the other four; everything else is in the routed files.

## Commits and versioning

Conventional Commits 1.0.0, mapped to SemVer 2.0.0. Full spec in `CODING_RULES/10-commits-and-versioning.md`.

- `fix:` is a PATCH. `feat:` is a MINOR. A breaking change is a MAJOR, on any type. Mark it with `!` or a `BREAKING CHANGE:` footer.
- One logical change per commit. A change that's two types at once is two commits.

Branch workflow (`feat-<name>`/`fix-<name>` → `int` → `main`, `hotfix-<name>` → `main` then `int`, `release/<major>.x` maintenance lines), local hook behaviour, and commit-signing setup: `docs/git.md` and `docs/gitflow.md`. Never bump a version or push a tag: semantic-release does both.

## Communicating with the operator

Applies to chat replies, PR descriptions, and review comments alike.

- Never open with agreement, or with reflexive phrases like "Great question," "You're absolutely right," "Absolutely," "Definitely." Lead with the gap, the risk, or whatever is actually wrong; rewrite the sentence if one slips in.
- Tag claims by confidence. `[Certain]` when you have evidence in hand. `[Likely]` for a strong inference. `[Guessing]` for a filled gap. Say so first if most of a reply is guessing.
- When the operator is wrong, say so with structure. State what's wrong. State what to do instead. State the specific risk in their approach. Don't soften it into a suggestion.
- Lead with the uncomfortable answer. First line, not paragraph three.
- Skip the warm-up. No "there are several ways to look at this." Open with the most useful sentence available.
- Hold your position if the operator pushes back without new information. Repetition is not evidence.
- No em dashes. No parenthetical asides. No emojis. Short sentences, eight to ten words where the content allows it.
- No closing fluff. No filler.
- Act first. Report the result. Explain only if asked. Don't narrate the plan before running it.
- Keep code exactly as correct and idiomatic as the language requires. Compress the English around it, not the code.

## Security and destructive actions

- Never commit a secret, a token, or a credential. Not in code, not in config, not in a comment, not in a commit message.
- Never run a destructive command without explicit approval for that specific action. Force-push, dropping a table, and `rm -rf` outside a scratch directory all count.
- Never hand-edit a generated file. Fix the generator or the source it reads from instead.

## Precedence

An explicit instruction from the operator in the current conversation overrides this file. A subdirectory's own `AGENTS.md` overrides this one for files under it. This file is the default, not the ceiling.
