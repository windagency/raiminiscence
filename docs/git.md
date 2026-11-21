# Git rules

[Back to .github/rulesets/README.md](../.github/rulesets/README.md) • [Back to AGENTS.md](../AGENTS.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to deployment.md](deployment.md) • [Back to gitflow.md](gitflow.md)

## Commit messages

Commit messages follow **Conventional Commits 1.0.0** (`<type>[optional scope]: <description>`), mapped to SemVer: `fix` → PATCH, `feat` → MINOR, a breaking change (`!` or a `BREAKING CHANGE:` footer, on any type) → MAJOR. Use the package as the scope when a change is about one package: `fix(hooks): ...`, `feat(mcp): ...`. Full format, examples, and the version-bump mapping: [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md).

## Local hooks

Husky installs these on `pnpm install`:

- `.husky/commit-msg`: `pnpm exec commitlint --edit "$1"`, against `commitlint.config.js` (`@commitlint/config-conventional`).
- `.husky/pre-commit`: `gitleaks git --pre-commit --staged` (a secret in staged code is caught before it's committed), then `lint-staged` (ESLint and Prettier on staged files, `.lintstagedrc.json`), then `pnpm run backlinks:check` (stale Markdown back-link lines; fix with `pnpm run backlinks:generate`), then `pnpm run build` and `pnpm run typecheck` (tests are type-checked against the built sibling packages).
- `.husky/pre-push`: rejects a push to a branch name outside the allowed patterns (see Workflow below).

gitleaks is a Go binary, not an npm package: install it per machine (`brew install gitleaks`, or a release binary). Without it the pre-commit hook fails. A deliberate secret-shaped test fixture gets a trailing `// gitleaks:allow` on its line; content that can't carry a comment, such as generated benchmark output, is allowlisted by path in `.gitleaks.toml`, which the hook and CI both read.

Local hooks are fast feedback, not enforcement: anyone can skip them with `--no-verify` or `HUSKY=0`. What actually blocks a bad change is server-side: `ci.yml`'s `lint-commits` and `gitleaks` jobs re-run over every commit in a pull request, `pr-title.yml` lints the PR title that becomes the squash commit, and GitHub's secret-scanning push protection is the last backstop. Full detail: [`deployment.md`](deployment.md#commit-message-enforcement).

| Concern | Local feedback | Server enforcement |
| --- | --- | --- |
| Commit message format | commitlint in `commit-msg` | `lint-commits` and `Validate PR title` required checks |
| Branch names | `pre-push` | `branch-naming` ruleset |
| Source branch into `main` | None | `allowed-merge-source` required check |
| Secrets | gitleaks in `pre-commit` | `gitleaks` required check, secret-scanning push protection |
| Code quality | lint-staged, build and typecheck in `pre-commit` | `verify` required check |
| Test-first order | None | `tdd-order` required check on `feat-*`/`fix-*` PRs into `int` |
| Signed commits | `commit.gpgsign` | `required_signatures` ruleset rule |
| Versioning | None | semantic-release in `publish.yml` |

## Signed commits

Every ruleset in `.github/rulesets/` requires signed commits (and signed tags, in `tags.json`). GitHub checks the signature against whatever key the committer registered as a **Signing key**.

1. Configure git, per clone (not globally, so it doesn't affect your other projects):

   ```sh
   git config user.signingkey ~/.ssh/<your-signing-key>.pub
   git config gpg.format ssh
   git config commit.gpgsign true
   git config tag.gpgsign true
   ```

2. Add the same public key to GitHub under Settings → SSH and GPG keys → "New SSH key", key type **Signing key**, not "Authentication key". The two are registered separately even for the same key pair. Until this is done, commits sign locally but still show "Unverified" on GitHub.

Commits GitHub creates itself, such as squash merges, are signed by GitHub automatically.

## Workflow

The flow as a diagram: [`gitflow.md`](gitflow.md). Each rule's rationale: [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md)'s Branches section and [`.github/rulesets/README.md`](../.github/rulesets/README.md).

- **`main`**: the trunk. Always releasable; every push here is evaluated for a release. Accepts merges only from `int` or `hotfix-*`. Squash merge only, 1 approval plus code owner review.
- **`release/<major>.x`** (e.g. `release/1.x`): maintenance branch for a release line no longer on `main`. Never a route into `main`.
- **`int`**: shared integration branch. `feat-*`/`fix-*` branches land here before the set of them goes to `main` as one reviewed change. Publishes nothing on its own. After each squash promotion into `main`, merge `main` back into `int` with a merge commit (see [`gitflow.md`](gitflow.md)).
- **`feat-<name>` / `fix-<name>`** (hyphen, not slash, lowercase): short-lived work branches, cut from `int` or `main`, merged into `int`. Force-push, rebase, and delete freely.
- **`hotfix-<name>`**: urgent production fix, cut from `main`, merged into `main` directly, then merged into `int`.

### Keeping a long-lived branch current

Rebase it onto its parent regularly, so conflicts arrive a few at a time:

```sh
git switch int && git pull
git switch feat-<name>
git rebase int                       # fix conflicts, then: git rebase --continue
git push --force-with-lease origin feat-<name>
```

`--force-with-lease` overwrites the remote branch only if nobody else pushed to it since your last fetch. `git rebase --abort` cancels at any point.
