# Git flow

[Back to AGENTS.md](../AGENTS.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0043-the-unreleased-changelog-is-generated-on-int.md](adr/0043-the-unreleased-changelog-is-generated-on-int.md) • [Back to git.md](git.md) • [Back to semver.md](semver.md)

Trunk-based with one shared integration branch. `main` is always releasable. `feat-<name>`/`fix-<name>` work branches land on `int` before the set of them goes to `main` as one reviewed change. `hotfix-<name>` branches carry an urgent fix straight into `main`, then into `int`. `release/<major>.x` branches carry maintenance fixes for a major line no longer on `main`. Commands, hooks, and signing setup: [`git.md`](git.md).

![Git flow branches: feat-recall-cache merges into int, int merges into main as one squashed change, main is then merged back into int with a merge commit, and hotfix-yaml-dump merges into main and then into int](images/gitflow-branches.svg)

A `feat-<name>`/`fix-<name>` branch is cut from `int` (or `main`), reviewed in isolation, then merged into `int`. `int` merges into `main` as one reviewed change once its set of work is ready. Title that PR with the highest Conventional Commits type among its changes, such as `fix(hooks): …`: its squash commit is all semantic-release sees on `main`, so a `chore` title releases nothing. Because `main` only takes squash merges, that promotion lands on `main` as a new commit `int` doesn't have: merge `main` back into `int` right after, through a PR merged with "Create a merge commit" (never squash). Skipping it leaves `int` and `main` without shared history, and the next promotion conflicts wherever `int` has since edited the same lines. Work-branch PRs into `int` also pass the `tdd-order` check, which enforces test-first commit order (`CODING_RULES/01-principles.md`).

A `hotfix-<name>` branch is cut from `main` and merged into `main` directly, so the fix ships without waiting for whatever else is sitting in `int`. Then the same branch is merged into `int`, so the fix isn't lost the next time `int` goes to `main`. That merge uses "Create a merge commit", never squash: the changelog sync recognises a hotfix's commits by it, and otherwise lists the fix a second time (ADR-0043).

Neither merge into `main` is tagged by hand: `publish.yml` runs semantic-release, which decides whether a release is warranted and creates the tag itself. `int` never releases. Full pipeline: [`deployment.md`](deployment.md).
