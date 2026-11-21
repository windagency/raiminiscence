# All four packages release in lockstep, driven by semantic-release

[Back to 10-commits-and-versioning.md](../../CODING_RULES/10-commits-and-versioning.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to deployment.md](../deployment.md) • [Back to developer-guide.md](../developer-guide.md) • [Back to semver.md](../semver.md)

The workspace publishes four npm packages: `raiminiscence-mcp`, `raiminiscence-argv`, `raiminiscence-hooks`, and `raiminiscence-cli`. Until now each carried its own `version` and `.github/workflows/release.yml` published all four on a hand-pushed `v*` tag, with a long-lived `NPM_TOKEN`. Nothing had shipped yet, so there was no installed base to stay compatible with.

## Decision

**One version for the whole workspace.** Every release bumps the root `package.json` and all four package manifests to the same version, with one `v<version>` tag, one `CHANGELOG.md` section, and one GitHub Release. A `fix:` scoped to `raiminiscence-cli` still releases `raiminiscence-mcp` at the new PATCH version.

**The version comes from the commits.** semantic-release runs on every push to `main` or `release/**` (`publish.yml`) and derives the bump from Conventional Commits, per `CODING_RULES/10-commits-and-versioning.md`. Nobody edits a version or pushes a tag by hand.

**Packing and staging are a repo script, not `@semantic-release/npm`.** That plugin releases one package, the one at the repository root, and the root here is private. `scripts/release.mjs` writes the version into every manifest, packs each package with `pnpm pack` (which rewrites `workspace:*` dependencies to the exact release version; `npm pack` would ship them unresolved), and stages each tarball with `npm stage publish --provenance`. A maintainer approves each staged version with 2FA. There is no npm token: the npm CLI authenticates through OIDC Trusted Publishing.

## Considered options

- **Independent versions per package (Changesets, or `multi-semantic-release`).** Rejected for now. `-hooks` and `-cli` depend on `-mcp` with `workspace:*`, so most user-visible changes touch more than one package anyway, and a single maintainer gains little from tracking four version lines. It also keeps the rule from `CODING_RULES/10` intact: the bump is derived from commits, not declared in a changeset file. Revisit if one package starts changing on a very different cadence from the rest.
- **Keep the tag-triggered `release.yml`.** Rejected. A hand-chosen tag drifts from what the commits imply, and the long-lived `NPM_TOKEN` can publish directly, bypassing review.

## Consequences

- A package can get a new version with no change of its own. Release notes list every commit in the release, grouped by type; scopes (`fix(cli): ...`) show which package a change is about.
- The first release semantic-release cuts is `1.0.0`, since no prior tag exists. To start the public line at `0.x` instead, push a `v0.1.0` tag on `main` before the first release.
- npm Trusted Publishing is configured per package, so the one-time setup in `docs/deployment.md` happens four times.
