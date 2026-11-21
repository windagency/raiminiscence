# Contributing

[Back to README.md](README.md) • [Back to pull_request_template.md](.github/pull_request_template.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 14-observability.md](CODING_RULES/14-observability.md) • [Back to 0027-zod-confined-to-schema-modules.md](docs/adr/0027-zod-confined-to-schema-modules.md) • [Back to GOVERNANCE.md](GOVERNANCE.md) • [Back to NEXT_STEPS.md](NEXT_STEPS.md)

This repository is built and maintained by AI agents and human engineers working side by side. Every change, whoever writes it, is held to the same bar.

The rules live in `CODING_RULES/`, split by concern so an agent only has to load what the current task touches. This file is the router: read it first, then pull in the specific rule files below.

For how an agent should behave and communicate while doing this work, not what the code should look like, see `AGENTS.md`. It's read automatically at the start of every agent session; this file is not.

## Getting started

TypeScript/Node monorepo, pnpm workspaces. Node 22.14 or later (`package.json`'s `engines`); development and CI's `verify` job use the exact version in `package.json`'s `volta` field (26.9.0), and CI also tests 22, 24 and 26 on Linux, macOS and Windows. pnpm comes from `package.json`'s `packageManager` field. Install [gitleaks](https://github.com/gitleaks/gitleaks) too: the pre-commit hook runs it. A ready-made environment with both: `.devcontainer/`.

```sh
pnpm install        # install deps across all packages
pnpm build          # build all packages
pnpm test           # run the full test suite
pnpm lint           # ESLint
pnpm format:check   # Prettier (pnpm format to auto-fix)
pnpm typecheck      # TypeScript: each package's src/, then tests, benchmarks and scripts
```

`pnpm install` runs a dependency's install script only if `pnpm-workspace.yaml`'s `allowBuilds` lists it as `true`; an unlisted one fails the install. A new dependency that needs one gets added there in its own reviewed change.

A single test file: `npx vitest run packages/<package>/test/<file>.test.ts`. The full, maintained command list (including less common ones) lives in `AGENTS.md`'s "Setup, build, and test commands" section — if this section and that one ever disagree, `AGENTS.md` is the one to trust and this one needs fixing.

## Before you write any code

1. Confirm the task and its success criteria. If they are not defined, define them before writing code.
2. Write the test first for any non-trivial business logic (TDD), and run it to confirm it fails before writing the implementation. Commit the test and the implementation separately, test first. See `CODING_RULES/01-principles.md`.
3. Load only the rule files relevant to the files you are about to touch, using the table below.
4. Touch only what the task requires. Do not refactor unrelated code in the same change.

## Before you push

These are enforced server-side by this repository's GitHub rulesets (`.github/rulesets/`), not just reviewed in a PR. Get them wrong and the push or the merge is rejected:

- **Branch name** must be `feat-<name>`, `fix-<name>`, or `hotfix-<name>` (or `int`/`release/<major>.x` for release-flow work). Open `feat-*` and `fix-*` PRs against `int`; only `int` and `hotfix-*` may open a PR into `main`. See `docs/gitflow.md`.
- **Commits must be signed** (SSH or GPG). Setup: `docs/git.md`, "Signed commits".
- **Into `main`/`release/**`, the PR title must be a valid Conventional Commit.** These branches squash-merge, so the PR title, not your individual commit messages, becomes the commit semantic-release reads.

Releases are automatic: never bump a version or push a tag yourself (`docs/deployment.md`).

## Rule files and when to load them

| You are editing… | Load |
|---|---|
| Anything, always | `CODING_RULES/01-principles.md`, `CODING_RULES/02-language-convention.md` |
| `.ts` / `.tsx` source — naming, types, control flow | `CODING_RULES/03-typescript.md` |
| Module boundaries, DI, repositories, domain workflows | `CODING_RULES/04-architecture.md` |
| API routes, controllers, services, DB access | `CODING_RULES/05-backend-api.md` |
| CSS, design tokens, layout, accessibility | `CODING_RULES/06-frontend.md` |
| React components, hooks, forms, state | `CODING_RULES/07-react.md` |
| Error handling, retries, external calls | `CODING_RULES/08-resilience.md` |
| Opening or reviewing a PR | `CODING_RULES/09-enforcement.md` |
| Writing a commit message, cutting a release | `CODING_RULES/10-commits-and-versioning.md` |
| Writing or updating any documentation, or finishing a task | `CODING_RULES/11-documentation.md` |
| Auditing sibling modules/directories for duplicated domain logic | `CODING_RULES/12-domain-duplication-audit.md` |
| Deciding what tests a change needs, or writing tests | `CODING_RULES/13-testing-strategy.md` |
| Starting a project/service/feature, or touching logs, metrics, tracing | `CODING_RULES/14-observability.md` |
| Choosing a CLI command, or wanting the rationale behind AGENTS.md's tool substitutions | `CODING_RULES/15-shell-tooling.md` |

The two "always" files are kept short by design. Everything else is scoped to one concern so it can be left out of context when it isn't relevant to the task.

## Non-negotiables (CRITICAL — a PR with any of these is blocked)

- No `any` without an inline comment justifying it.
- All external input validated with Zod before use, in a `*-schema.ts` module, the only kind of file allowed to import `zod` ([ADR-0027](docs/adr/0027-zod-confined-to-schema-modules.md)).
- No direct third-party library imports outside an `adapters/` wrapper (Zod's `*-schema.ts` modules are its wrapper).
- No architectural rule shipped without a matching architecture test: `arch-unit-ts` in the package's `__tests__/architecture/`, or the root `__tests__/architecture/` for a rule spanning packages (`docs/developer-guide.md`, "Testing philosophy").
- No secrets, tokens, or credentials committed in code, config, or comments.

Full severity table: `CODING_RULES/09-enforcement.md`.

## Definition of done

- [ ] Lint (ESLint) and format (Prettier) pass with no warnings suppressed inline without justification.
- [ ] Type-check passes with no new `any`.
- [ ] The test types this change actually needs are present, not unit tests by default (`CODING_RULES/13-testing-strategy.md`).
- [ ] Architecture tests (per-package `arch-unit-ts` suites and the root `__tests__/architecture/`) pass for any touched module boundary.
- [ ] New or changed behaviour is observable: logs, metrics, or traces added per `CODING_RULES/14-observability.md`.
- [ ] Documentation affected by this change is updated, following `CODING_RULES/11-documentation.md` — this is checked at the end of every run, not deferred.
- [ ] Commit messages follow Conventional Commits, and any release version bump matches its SemVer impact (`CODING_RULES/10-commits-and-versioning.md`). Into `main`/`release/**`, the PR title is what's checked and what lands; see "Before you push" above.
- [ ] For non-trivial business logic, the test was written and seen to fail before the implementation, and `tdd-order` passes on `feat-*`/`fix-*` PRs into `int` (`CODING_RULES/01-principles.md`).
- [ ] `pnpm run licenses:check` and `pnpm run backlinks:check` pass (regenerate with `licenses:generate` / `backlinks:generate`).
- [ ] The relevant checklist in `CODING_RULES/09-enforcement.md` has been reviewed.

## Required tooling

ESLint, TypeScript, Prettier, `arch-unit-ts`, Husky, Vitest or Playwright, Zod, `jscpd`, commitlint (Husky `commit-msg` hook, and CI on every PR), gitleaks (`.husky/pre-commit`, and a required CI check), semantic-release (derives each release's version from commit history), SSH or GPG commit signing (required by every ruleset). Full required and recommended lists: `CODING_RULES/09-enforcement.md`. Open work worth picking up: `NEXT_STEPS.md`.

## Scope note

These rules assume a TypeScript / Node / React stack, because that is what the source guidelines describe. If this factory also generates code in other languages, the language-neutral files (`01`, `02`, `08`, `09`, `10`, `11`, `12`, `13`, `14`, `15`) still apply in principle, though `13`'s and `14`'s named tools (Vitest, Playwright, `vitest-axe`, OpenTelemetry) are stack-specific; `03`, `06`, `07` do not apply at all. Add an equivalent per-language rule file rather than stretching these to fit.

This project specifically (rAIminiscence) is a TypeScript/Node monorepo with no CSS and no React dependency anywhere — `06-frontend.md` and `07-react.md` don't apply here, distinct from the other-language-factory case above; Stylelint is accordingly not part of this project's required tooling. Re-adopt both (and Stylelint) if this repo ever does add a frontend.
