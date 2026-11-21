# Branch rulesets and commit security

[Back to 10-commits-and-versioning.md](../../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../../CONTRIBUTING.md) • [Back to 0043-the-unreleased-changelog-is-generated-on-int.md](../../docs/adr/0043-the-unreleased-changelog-is-generated-on-int.md) • [Back to deployment.md](../../docs/deployment.md) • [Back to git.md](../../docs/git.md) • [Back to testing-guide.md](../../docs/testing-guide.md)

Six GitHub repository rulesets, plus the local and CI tooling that backs them.

| File | Targets | Purpose |
| --- | --- | --- |
| `main.json` | Default branch | Production code. Strictest rules. Accepts merges only from `int` or `hotfix-*` (via the `allowed-merge-source` check). |
| `release.json` | `release/**/*` | Maintenance releases for an old major line. |
| `integration.json` | `int` | Shared branch where work meets. |
| `feature.json` | `feat-*`, `fix-*`, `hotfix-*` | Short-lived work branches. |
| `branch-naming.json` | Everything else | Blocks creation of unapproved branch names. |
| `tags.json` | `v*` | Release tags - blocks deletion and moving an existing tag. |

## Before you import

1. **Check the required status checks.** `main`, `release` and `integration` require `verify`, `lint-commits` and `gitleaks` (`ci.yml`), `Validate PR title` (`pr-title.yml`) and `dependency-review` (`dependency-review.yml`). `main.json` also requires `allowed-merge-source` (`allowed-merge-source.yml`) and `changelog-current` (`ci.yml`, skipped, which counts as passing, on every PR except `int` into `main`), and `integration.json` also requires `tdd-order` (`ci.yml`). A required name that no workflow reports blocks every merge, so import `main.json` only after `allowed-merge-source` has reported a green run on a `main`-targeting PR, and `integration.json` only after `tdd-order` has reported on an `int`-targeting PR.
   `ci.yml`'s `node-compat` (Node 22/24/26 on Linux, macOS, Windows) and `audit` jobs are deliberately not required: `node-compat` would require one entry per matrix leg, and `audit` fails on advisories in dependencies already merged, which no PR can fix. Add `node-compat` legs to the list if a cross-platform regression slips through.
2. **`.github/CODEOWNERS` exists.** `main` and `release` require code owner review. Without the file, that rule has no effect.
3. **Check your plan.** Private repositories need GitHub Pro, Team or Enterprise Cloud. On Free, rulesets apply to public repositories only.
4. **Check your automation.** All work rulesets require signed commits. Bots that push unsigned commits will be rejected.

## How to import

Settings, Rules, Rulesets, New ruleset, Import a ruleset. Repeat per file.

Then add bypass actors in the UI - GitHub excludes bypass lists from ruleset JSON, so this is a manual step every time a ruleset is (re-)imported. Two different actors, two different modes, and conflating them is the most common way to weaken these rulesets by accident:

- **A human maintainer** (repository admin role), mode **pull request only**. Lets an admin merge their own already-reviewed PR without needing a second approver. Never use **always** for a human actor - that allows direct, unreviewed pushes.
- **The release automation** (this repo's dedicated release GitHub App, picked by name under "GitHub Apps"), mode **always**, on `main.json`, `release.json` and `tags.json` only. This one *has* to be "always": the version-bump commit and the release tag are pushed outside any pull request, so "pull request only" would reject them. It has to be an App: the bypass list doesn't offer the GitHub Actions identity behind `GITHUB_TOKEN` at all. Know what this costs: "always" bypasses every rule in that ruleset for anything holding a token for that App - which is why its private key lives only in `publish.yml`'s secrets, and why the App must not be reused for anything else. Setup: `docs/deployment.md`, "Required one-time setup".
- **The changelog automation** (a second, dedicated GitHub App), mode **always**, on `integration.json` only. `changelog.yml` commits the generated Unreleased section to `int` outside any pull request (ADR-0043). Its key lives in the `changelog` environment, limited to `int` and `main`.

Consider switching enforcement to **Evaluate** for the first week. Violations are logged but not blocked.

## Rule reference

| Rule | main | release | int | feat, fix, hotfix | tags |
| --- | --- | --- | --- | --- | --- |
| Block deletion | Yes | Yes | Yes | No | Yes |
| Block force push / move | Yes | Yes | Yes | No | Yes |
| Linear history | Yes | Yes | No | No | n/a |
| Signed commits/tags | Yes | Yes | Yes | Yes | Yes |
| Pull request required | Yes | Yes | Yes | No | n/a |
| Approvals | 1 | 1 | 1 | None | n/a |
| Code owner review | Yes | Yes | No | No | n/a |
| Dismiss stale approvals | Yes | Yes | Yes | No | n/a |
| Last push must be approved | Yes | Yes | Yes | No | n/a |
| Resolve review threads | Yes | Yes | Yes | No | n/a |
| Merge methods | Squash | Squash, rebase | Squash, merge | Any | n/a |
| Status checks | Strict | Strict | Not strict | None | n/a |
| Checks on branch creation | Yes | Skipped | Yes | None | n/a |
| Allowed source branch | `int`, `hotfix-*` (via `allowed-merge-source` check) | Any | Any | n/a | n/a |

Approvals are 1, not a larger number, on every branch that requires them here - matched to a single maintainer with a documented path to a co-maintainer, not a team of several reviewers. Raise it once there's more than one person actually reviewing.

## Ruleset design decisions

### main

Squash only keeps one commit per change. History stays readable and easy to revert. Strict checks mean the branch must be up to date before merging. What was tested is exactly what lands.

Only `int` and `hotfix-*` may merge into `main`. GitHub rulesets have no native rule that restricts a pull request's source branch, so `allowed-merge-source` does it: a required check that fails unless the head branch is `int` or `hotfix-<name>` from this repository. This keeps batched work going through `int`, while still letting an urgent fix ship without waiting for `int`'s unrelated commits. The check is a routing guard, not a security boundary. Review and signed commits remain the actual gate.

### release

Mirrors `main`, as release code is about to ship. Rebase is allowed so cherry-picked fixes keep their original commits. Checks are skipped on creation, so a branch can be cut from a known good commit. Used only for maintenance of an old major line, never as a route into `main`.

### int

Several branches merge here each day. Strict up-to-date checks would force a rebase after every merge. That churn is costly, so it is off. Merge commits are allowed to preserve history before it reaches `main`.

### feat-\*, fix-\* and hotfix-\*

Signed commits only. Work branches are rebased, force-pushed and deleted as normal practice. Blocking that adds friction without protecting anything. Protection belongs on the branch being merged into.

`feat-*` and `fix-*` merge into `int`. `hotfix-*` is cut from `main`, merges into `main` directly, and then merges into `int` as well, so `int` gets the fix without pulling in its unrelated pending commits.

### tags

Blocks deleting or moving a `v*` tag once it exists - creation is left open, since the release automation needs to create new ones. Without this, a release tag can be quietly repointed after the fact, which breaks the exact guarantee npm provenance exists to give: that the published package traces back to one specific, unaltered commit. Requires signed tags for the same reason `main` requires signed commits; the release automation's bypass actor (see "How to import") covers the one tag it creates without a human pushing it.

### branch-naming

Uses the `creation` rule on every branch not explicitly allowed. Only bypass actors can create those. This is the only server-side way to enforce naming on every plan.

Two exclusions exist for GitHub's own tooling:

- `dependabot/**/*` for Dependabot update branches.
- `revert-*` for the Revert button on merged pull requests.

Add more if you use Renovate, Copilot agents or similar bots.

## Local hooks are not security

Git hooks run on the developer's machine and anyone can skip them with `git commit --no-verify` or `HUSKY=0`. Every rule that matters also runs on GitHub; the local-versus-server table is in [`docs/git.md`](../../docs/git.md#local-hooks).

## Tooling

The local hooks, commitlint, gitleaks and signing setup that back these rulesets: [`docs/git.md`](../../docs/git.md). The release pipeline, including why the release App needs an "always" bypass and why `@semantic-release/git` is kept despite it: [`docs/deployment.md`](../../docs/deployment.md).

## Known limitations

- `feat-*`, `fix-*` and `hotfix-*` do not match nested names such as `feat-auth/login`. In GitHub patterns, `*` stops at `/`.
- `allowed-merge-source` checks the head branch name, not who authored it. Anyone with write access can create a branch named `hotfix-x` and open a PR into `main`. Review and the required-signatures rule are what stop an unreviewed change from landing.
- `int` does not publish prereleases. Add it to the semantic-release `branches` with `prerelease` if you need them.
- The release App's bypass on `main`/`release`/`tags` is scoped to whoever holds its private key, not to one workflow file. Keeping that key in `publish.yml`'s secrets only is what scopes it in practice - see `docs/deployment.md`, "Required one-time setup".
- Action versions in this project's workflows are pinned to a commit SHA (with a version-tag comment), not a mutable tag, specifically because the release workflow mints a release App token with push access and can stage npm releases. - a moved tag on `actions/checkout`, `pnpm/action-setup` or similar would run attacker code with both. Dependabot (`.github/dependabot.yml`) keeps the pins current; don't revert to a bare `@v4`-style tag for convenience.
