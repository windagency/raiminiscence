# Semantic versioning

[Back to AGENTS.md](../AGENTS.md) • [Back to CHANGELOG.md](../CHANGELOG.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to deployment.md](deployment.md)

All four packages share one version, following [SemVer 2.0.0](https://semver.org/) ([ADR-0026](adr/0026-lockstep-versioning-with-semantic-release.md)).

The bump is not chosen by hand. It's derived from the Conventional Commits merged since the last release; the highest of PATCH/MINOR/MAJOR they imply wins. Full rules: [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md).

- `fix:` => PATCH (0.1.0 becomes 0.1.1)
- `feat:` => MINOR, resets PATCH (0.1.5 becomes 0.2.0)
- A breaking change (`!` or a `BREAKING CHANGE:` footer, on any type) => MAJOR, resets MINOR and PATCH (0.8.4 becomes 1.0.0)

## CHANGELOG.md

[`CHANGELOG.md`](../CHANGELOG.md) at the repository root covers all four packages. Nothing in it is hand-written except the intro above `## [Unreleased]`. A well-formed commit message is the only way to put a line in it.

The Unreleased section lists every `feat`, `fix` and breaking commit merged into `int` and not yet released, grouped as `BREAKING CHANGES`, `Features` and `Bug Fixes`, each linked to its commit. `changelog.yml` keeps it current after every push to `int` ([`scripts/changelog.ts`](../scripts/changelog.ts)). At a release, semantic-release turns that list into the version's section and empties Unreleased ([`release.config.js`](../release.config.js)). The HTML comment that ends Unreleased must stay: it is what lets `main` merge back into `int` without a conflict. Why it works this way: [ADR-0043](adr/0043-the-unreleased-changelog-is-generated-on-int.md).

A `release/<major>.x` branch publishes patch and minor releases scoped to that major only. See [`gitflow.md`](gitflow.md).
