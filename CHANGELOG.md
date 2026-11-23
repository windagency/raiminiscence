# Changelog

[Back to README.md](README.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 10-commits-and-versioning.md](CODING_RULES/10-commits-and-versioning.md) • [Back to 0026-lockstep-versioning-with-semantic-release.md](docs/adr/0026-lockstep-versioning-with-semantic-release.md) • [Back to 0043-the-unreleased-changelog-is-generated-on-int.md](docs/adr/0043-the-unreleased-changelog-is-generated-on-int.md) • [Back to deployment.md](docs/deployment.md) • [Back to semver.md](docs/semver.md)

All notable changes to this project are documented in this file. Versioning
follows [Semantic Versioning](https://semver.org/). All four packages in the
workspace (`raiminiscence-mcp`, `raiminiscence-hooks`, `raiminiscence-cli`,
`raiminiscence-argv`) share one version, so this file covers them all; a
commit's scope says which package it's about.

Everything below is generated from Conventional Commits; never edit it by
hand. Unreleased lists each `feat`, `fix` and breaking commit merged into
`int` but not yet released. At a release, that list becomes the version's
notes and Unreleased empties. See `docs/semver.md`.

## [Unreleased]

<!-- end of Unreleased: generated from commits, see docs/semver.md -->

## [1.0.2](https://github.com/windagency/raiminiscence/compare/v1.0.1...v1.0.2) (2026-11-23)

### Bug Fixes

- **hooks:** print help on --help instead of installing (#10) ([62c2dbf](https://github.com/windagency/raiminiscence/commit/62c2dbf7bcf092c9bb72f7e294540dacc4a847ce))

## [1.0.1](https://github.com/windagency/raiminiscence/compare/v1.0.0...v1.0.1) (2026-11-22)

### Bug Fixes

- **mcp:** start the server when run through npx or node_modules/.bin (#8) ([06fb57d](https://github.com/windagency/raiminiscence/commit/06fb57dfbb44cba4198d8fb25ece378e07d65651))

## 1.0.0 (2026-11-22)

### Features

- persistent memory for AI coding agents ([90b7fb2](https://github.com/windagency/raiminiscence/commit/90b7fb2f45ac0f55473e2e33690df4b902348116))

### Bug Fixes

- **deps:** upgrade past the production audit advisories (#2) ([41543e1](https://github.com/windagency/raiminiscence/commit/41543e1f38fa441355bd010de6ddd39ed4414a70))
