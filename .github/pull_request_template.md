## What this changes and why

<!-- One or two sentences. Link the issue this closes, if any: "Closes #123". -->

## Definition of done

Checked against `CONTRIBUTING.md`'s definition of done:

- [ ] Lint (ESLint) and format (Prettier) pass with no warnings suppressed inline without justification.
- [ ] Type-check passes with no new `any`.
- [ ] The test types this change actually needs are present (`CODING_RULES/13-testing-strategy.md`).
- [ ] `arch-unit-ts` tests pass for any touched module boundary.
- [ ] New or changed behaviour is observable (logs/metrics/traces) per `CODING_RULES/14-observability.md`, if applicable.
- [ ] Documentation affected by this change is updated (`CODING_RULES/11-documentation.md`).
- [ ] Commit messages follow Conventional Commits; any version bump matches its SemVer impact. Into `main`/`release/**`, the PR title is what lands.
- [ ] For non-trivial business logic, the test was written and seen to fail first (`tdd-order` on `feat-*`/`fix-*` PRs into `int`).

## Non-negotiables

- [ ] No `any` without an inline comment justifying it.
- [ ] All external input validated with Zod before use, in a `*-schema.ts` module (ADR-0027).
- [ ] No direct third-party library imports outside an `adapters/` wrapper.
- [ ] No architectural rule shipped without a matching `arch-unit-ts` test.
- [ ] No secrets, tokens, or credentials committed in code, config, or comments.
