# Deployment

[Back to .github/rulesets/README.md](../.github/rulesets/README.md) • [Back to AGENTS.md](../AGENTS.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0026-lockstep-versioning-with-semantic-release.md](adr/0026-lockstep-versioning-with-semantic-release.md) • [Back to 0043-the-unreleased-changelog-is-generated-on-int.md](adr/0043-the-unreleased-changelog-is-generated-on-int.md) • [Back to developer-guide.md](developer-guide.md) • [Back to git.md](git.md) • [Back to gitflow.md](gitflow.md) • [Back to testing-guide.md](testing-guide.md) • [Back to NEXT_STEPS.md](../NEXT_STEPS.md)

Releases are commit-driven, not hand-chosen: nobody edits a `package.json` version, tags a commit, or runs `pnpm publish` directly. Every push to `main` or a `release/**` maintenance branch is evaluated by [semantic-release](https://semantic-release.gitbook.io/), which decides whether a release is warranted and, if so, performs it: version bump across all four packages, changelog, git tag, GitHub Release, and staging each package on npm. The one human step is approving the staged versions with 2FA (see Staged publishing below); nothing is installable from npm before that.

See [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md) for the Conventional Commits / SemVer policy this automates and the branch model, [ADR-0026](adr/0026-lockstep-versioning-with-semantic-release.md) for why the packages share one version, and [`git.md`](git.md) / [`semver.md`](semver.md) for the day-to-day contributor side of the same rules.

## Pipeline overview

![Deployment pipeline: a PR into main, release/** or int runs ci.yml, dependency-review.yml, pr-title.yml and, into main, allowed-merge-source.yml; a merge into main or release/** runs publish.yml, which re-runs the checks, writes an SBOM and runs semantic-release, producing four staged npm packages approved with 2FA, a GitHub Release with the SBOM, and a version-bump commit and tag; a merge into int produces no release](images/deployment-pipeline.svg)

\* `tdd-order` runs on `feat-*`/`fix-*` PRs into `int` only. \*\* `allowed-merge-source` runs on PRs into `main` only.

`publish.yml` always re-runs the full verification before releasing. A green PR isn't trusted as a release gate on its own, since `main` could in principle move between the PR's last CI run and the merge.

## Commit message enforcement

A release's shape depends entirely on well-formed commit messages, so malformed ones are rejected before they can reach `main`:

- **Locally**: a Husky `commit-msg` hook (`.husky/commit-msg`) runs commitlint against every commit message, using `commitlint.config.js` (`@commitlint/config-conventional`).
- **In CI**: `ci.yml`'s `lint-commits` job re-runs commitlint over the full commit range of a pull request, so a commit made with `--no-verify` still gets caught before merge.
- **Test-first order**: on `feat-*`/`fix-*` pull requests into `int`, `ci.yml`'s `tdd-order` job (`scripts/check-tdd-order.mjs`) checks that each implementation commit follows a test-only commit whose new tests fail when run at that commit. Exemptions use a `TDD-Exempt:` trailer that a reviewer approves.
- **The PR title, separately**: `main` and `release/**` only accept squash merges, so the squash commit's message is the PR title, not any of the original commits. `pr-title.yml` lints the title itself as its own required check, `Validate PR title`. This requires the repository's "Allow squash merging" default commit message to be "Pull request title" (Settings → General → Pull Requests).

## Release decision

semantic-release's plugin pipeline, configured in [`release.config.js`](../release.config.js), runs in this fixed order:

1. `@semantic-release/commit-analyzer`: `fix` → PATCH, `feat` → MINOR, a breaking-change marker on any type → MAJOR. Every other type (`build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`) is explicitly marked as not release-triggering, so a docs-only push to `main` runs the pipeline and simply produces no release.
2. `@semantic-release/exec`, generate notes: `scripts/changelog.ts notes` uses `CHANGELOG.md`'s Unreleased list as the release notes. When that list is empty, as after a hotfix squashed straight into `main`, it lists the release's own commits instead. The first release, with no tag before it, also lists the commits `main` started from. A promotion's PR title becomes its one commit on `main`, and semantic-release picks the version from that commit alone: title it with the highest type in the promotion, such as `fix(hooks): …` for a patch or `feat: …` for a minor. A `chore` title releases nothing. semantic-release runs the command a second time after prepare, once `CHANGELOG.md` already holds the version's section; it then returns that section unchanged, so the GitHub Release matches the file. See Changelog below.
3. `@semantic-release/exec`, prepare: `scripts/changelog.ts release` writes those notes into `CHANGELOG.md` as the version's section and empties Unreleased. Then `node scripts/release.mjs prepare <version>` writes the version into the root and all four package manifests and packs each package into `release-tarball/` with `pnpm pack`, which rewrites `workspace:*` dependencies to that exact version. Its publish step, `node scripts/release.mjs publish <dist-tag>`, stages each tarball, dependencies first.
4. `@semantic-release/git`: commits `CHANGELOG.md` and the five `package.json` files, and pushes the `v<version>` tag.
5. `@semantic-release/github`: the GitHub Release, with the SBOM attached.

## Changelog

`CHANGELOG.md`'s Unreleased section is generated, never hand-written ([ADR-0043](adr/0043-the-unreleased-changelog-is-generated-on-int.md)). `changelog.yml` runs `pnpm changelog:sync` on every push to `int` or `main` and commits the result to `int`. That adds each `feat`, `fix` or breaking commit in `origin/main..int` that no section lists yet, and copies `main`'s released sections onto `int`. Because `main` takes the promotion as one squash commit, its notes would otherwise be one PR title; the Unreleased list keeps every change. The copy makes the back-merge of `main` into `int` merge cleanly. A PR from `int` into `main` must pass `changelog-current`, which fails while the list is behind `int`'s commits.

A hotfix is listed once, under its own version. Its branch's commits reach `int` under hashes no released section lists, so the sync recognises them by the merge that brought them in: a `Merge pull request #N from <owner>/hotfix-<name>` commit. Merge a hotfix branch into `int` with "Create a merge commit"; a squash leaves nothing to recognise, and the fix is listed again in the next version.

## Staged publishing

npm only accepts staged publishes for these packages: each package's Trusted Publisher (repository `windagency/raiminiscence`, workflow `publish.yml`, environment `npm`) has neither "publish directly" nor "manage dist-tags" enabled, so `npm stage publish` is the one action CI can take. The npm CLI authenticates through OIDC; there is no npm token anywhere in the pipeline.

A staged version is not installable until a maintainer approves it with 2FA, either `npm stage approve <stage-id>` or the package's Staged Packages tab on npmjs.com. One release stages four versions, one per package; approve all four, `raiminiscence-mcp` and `raiminiscence-argv` first, since the other two depend on them at that exact version. The Publish run's log prints each stage ID, and `npm stage list <package>` lists pending ones. `npm stage view <stage-id>` shows a staged version before approving; `npm stage reject <stage-id>` drops it. The GitHub Release and the tag already exist by then, so approve or reject promptly. Staging is what keeps a compromised dependency or Action in the Publish job from shipping a release on its own: it can stage, never publish.

## npm provenance

Each package's `publishConfig.provenance: true` and `npm stage publish --provenance`, together with `publish.yml`'s `id-token: write` permission, attach a provenance attestation to every published package: a verifiable link from the npm tarball back to this exact GitHub Actions run and commit. This requires the repository to be public, and each package's `repository` field (with its `directory`) to point at this repository.

## Commit signing

A release's version-bump push and tag creation happen outside any pull request, so every ruleset in `.github/rulesets/` that requires signatures would reject them like any other unsigned push, if not for the release automation's bypass actor (see Required one-time setup below). Contributor setup lives in [`git.md`](git.md#signed-commits).

## Release environment and SBOM

`publish.yml`'s job runs in the `npm` GitHub Environment, whose deployment branches are `main` and `release/**` only. Each package's Trusted Publisher names that environment, so a publish credential is only issued to a run that passed the branch policy. Before semantic-release runs, `anchore/sbom-action` (syft, pinned) writes a CycloneDX SBOM of the repository's dependency manifests (`.github/syft.yaml` excludes `node_modules/`, `dist/` and the third-party benchmark harness), and `@semantic-release/github` attaches it to the GitHub Release.

`HUSKY: 0` (workflow-wide in `publish.yml` and `ci.yml`) stops `pnpm install`'s `prepare` script from installing git hooks on the runner, so `@semantic-release/git`'s release commit doesn't run the local hooks.

## When a release fails partway

semantic-release pushes the release commit and the `v<version>` tag in its prepare phase, before it stages the packages and creates the GitHub Release. If staging then fails, the tag already exists and semantic-release treats that version as released: re-running the workflow cuts nothing, and the next `fix:`/`feat:` gets the next version. Mark that GitHub Release "not published to npm" by hand. If staging fails after some packages were staged, reject the staged ones (`npm stage reject`) so the four packages never drift apart on npm. A failure before the prepare phase finishes leaves nothing behind; fix the cause and re-run.

## Required one-time setup

- **npm Trusted Publisher on each of the four packages** (npmjs.com → package Settings → Trusted Publisher): GitHub Actions, repository `windagency/raiminiscence`, workflow `publish.yml`, environment `npm`, with "publish directly" and "manage dist-tags" left unchecked so only staged publishes are allowed. No `NPM_TOKEN` secret: a token able to publish directly would bypass the 2FA approval that staging exists for.
- **A registered signing key** per maintainer, per [`git.md`](git.md#signed-commits).
- **A release GitHub App, on the bypass list of the `main`, `release`, and `tags` rulesets**, mode "Always" (see `.github/rulesets/README.md`). The default `GITHUB_TOKEN` can't fill this role: GitHub's ruleset bypass list accepts roles, teams, GitHub Apps and Dependabot, but not the GitHub Actions identity behind `GITHUB_TOKEN`. The App needs Repository permissions Contents: Read and write and Issues: Read and write (semantic-release opens an issue when a release fails), installed on this repository only. Store its Client ID as the `RELEASE_APP_CLIENT_ID` repository variable and a generated private key as the `RELEASE_APP_PRIVATE_KEY` repository secret. `publish.yml` mints a short-lived token from it right before semantic-release runs, so the install, lint and test steps never see it; checkout uses `persist-credentials: false` so the default token isn't left in the git config to shadow it.
- **A changelog GitHub App, on the bypass list of the `integration` ruleset only**, mode "Always". `changelog.yml` commits the generated Unreleased section to `int` outside any pull request. A separate App, not the release App, so the release App's key stays in `publish.yml` alone. Repository permission Contents: Read and write, installed on this repository only. Create a `changelog` GitHub Environment with deployment branches `int` and `main`, and store the App's Client ID as its `CHANGELOG_APP_CLIENT_ID` variable and a private key as its `CHANGELOG_APP_PRIVATE_KEY` secret.
- `GITHUB_TOKEN` isn't used for the release; `publish.yml` keeps it at `contents: read`. An App token's pushes do trigger workflows; what stops the version-bump commit from re-running `publish.yml` and `ci.yml` is `@semantic-release/git`'s default commit message, which ends in `[skip ci]`. Don't override `message` in `release.config.js` without keeping it.

## Non-goals

- **No manual release path.** `pnpm publish` run locally would conflict with the next automated release's version derivation. A release only ever happens through `publish.yml`.
- **No pre-release channel.** `int` publishes nothing, prerelease or otherwise. Add it to `release.config.js`'s `branches` with `prerelease` if that's ever needed.
- **No per-package versions.** See [ADR-0026](adr/0026-lockstep-versioning-with-semantic-release.md).
