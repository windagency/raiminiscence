# The Unreleased changelog is generated on `int` and becomes the release notes

[Back to docs/adr/README.md](README.md) • [Back to deployment.md](../deployment.md) • [Back to semver.md](../semver.md)

**Status: accepted, 2026-11-21. Not yet exercised by a real release.**

`CHANGELOG.md` had a hand-written Unreleased section above the sections semantic-release generates (ADR-0026). Hand-written entries drift from what actually merged, and nothing cleared them at a release. Generating the section has one obstacle: `main` only takes squash merges (`docs/gitflow.md`). The promotion from `int` lands on `main` as one commit, titled after its PR. So `int`'s commits never become part of `main`'s history, and release notes built from `main`'s commits list one line per promotion.

Measured in a scratch repository with that branch flow, 2026-11-21: an Unreleased section committed on `int` conflicts at the back-merge of `main` into `int` after every release. It still does when the release turns the Unreleased heading into the version heading, and when a bot copies `main`'s released sections onto `int` first. It merges cleanly, over two release cycles and with an entry merged into `int` during a release, only when the copy is combined with a fixed line between Unreleased and the newest release.

## Decision

- **Unreleased is generated on `int` from commits.** `changelog.yml` runs `scripts/changelog.ts sync` on every push to `int` or `main` and commits `CHANGELOG.md` to `int`. Each `feat`, `fix` or breaking commit in `origin/main..int` gets one line, linked to its commit by hash, unless a section already lists that hash.
- **A hash in a released section marks a commit shipped.** Squash merges leave history no way to say so. The sync drops an Unreleased entry once `main`'s released sections list its hash.
- **The sync copies `main`'s released sections onto `int`.** A push to `main` is how a release commit lands, so `int` holds the new version's section before anyone opens the back-merge PR.
- **A fixed HTML comment ends Unreleased.** It is the unchanged line that keeps `int`'s new entries and `main`'s new version apart, so the back-merge has no conflict.
- **The release uses the list as its notes.** `@semantic-release/exec` runs `scripts/changelog.ts notes` and `release` in place of `@semantic-release/release-notes-generator` and `@semantic-release/changelog`. The notes list every change in the promotion, not just its title. An empty list, as after a hotfix, falls back to the release's own commits. The first release also lists `main`'s own commits, which predate `int` and so never reached the list. Its promotion PR needs a title the list leaves out, such as `chore(release): promote int to main`. semantic-release calls `notes` again after `release` has run; it then returns the section `release` wrote.
- **A promotion must carry the full list.** `ci.yml`'s `changelog-current`, required on `main`, fails a PR from `int` into `main` while the list is behind `int`'s commits.
- **A second GitHub App commits to `int`.** It bypasses the `integration` ruleset only. The release App's key stays in `publish.yml` alone, as `.github/rulesets/README.md` requires. The new App's key lives in a `changelog` environment limited to `int` and `main`. Its commits go through the GraphQL `createCommitOnBranch` mutation, which GitHub signs, since every ruleset requires signed commits.

## Alternatives considered

- **A draft GitHub Release kept current by CI.** No commits, no conflicts, no new App. But drafts are visible to maintainers only, and `CHANGELOG.md` would have no Unreleased section.
- **A committed list, conflicts resolved by hand.** Least code, but every back-merge PR needs a manual resolution.
- **Generate it in a local git hook.** A hook sees the work branch's commit messages, not the squash title that lands on `int`. Every branch would also rewrite the same lines, so PRs would conflict with each other.

## Consequences

- One more App, environment and required check to set up: `docs/deployment.md`, "Required one-time setup".
- `int` gets a bot commit, `docs(changelog): update Unreleased`, after each push that adds an entry. `docs` neither triggers a release nor gets listed.
- A hotfix is listed twice: under its own version, then again in the next one, because its branch's commits reach `int` under new hashes.
- A promotion PR opened before the sync finished fails `changelog-current` until the bot's commit lands.
