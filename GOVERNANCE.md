# Governance

[Back to README.md](README.md) • [Back to MAINTAINERS.md](MAINTAINERS.md)

This project is run BDFL-style: one maintainer has final say on every decision — design, what gets merged, when a release ships. See [`MAINTAINERS.md`](MAINTAINERS.md) for who that is and response-time expectations.

There is a documented path to co-maintainer status (below), and anyone can signal demand on an issue — but neither changes who has final say. This file can be revisited once there's more than one active maintainer; until then, treat it as the BDFL model with the surrounding process spelled out.

## Day-to-day decisions

Most changes — bug fixes, small features, refactors that don't change a public interface — go straight through the normal PR flow in [`CONTRIBUTING.md`](CONTRIBUTING.md): open a PR, pass the definition of done, get it reviewed, merge. No proposal step required.

## When a change needs an ADR first

A change needs a written ADR under [`docs/adr/`](docs/adr/) *before* (or as part of) the implementing PR, not after, when it does any of the following:

- Changes a public interface contract: an MCP tool's shape (`raiminiscence-mcp`), a CLI flag (`raiminiscence-cli`, `raiminiscence-argv`), the hook shim's input/output contract (`raiminiscence-hooks`), or the memory file schema (the Markdown-plus-frontmatter format fixed by [ADR-0001](docs/adr/0001-flat-file-markdown-storage.md)).
- Is a breaking change under [`CODING_RULES/10-commits-and-versioning.md`](CODING_RULES/10-commits-and-versioning.md)'s SemVer rules.
- Reverses or materially amends an existing ADR.
- Isn't cheaply reversible once merged — for example, a change to `.raiminiscence/memory/` file layout that existing users' stored memories would need to migrate away from.

To propose one: open an issue describing the problem and the direction, and let it sit for discussion. Once the direction is settled, add the ADR to `docs/adr/` (follow the numbering and structure of an existing one, e.g. [ADR-0025](docs/adr/0025-v19-opportunistic-consolidation-debounce.md)) in the same PR as the implementation, or as a PR of its own first if the change is large enough to want sign-off before any code is written. The maintainer decides whether discussion has converged enough to proceed — there is no vote and no quorum.

Everything else in `docs/adr/` is a record of a decision already made, not a gate other contributors need to clear — only the categories above require one in advance.

## Prioritisation

Anyone can signal what they want built next by reacting 👍 on the relevant issue (GitHub's own reaction count — no separate tool or form). This is read as a signal of demand, not a binding vote: the maintainer still decides what actually gets worked on next, weighing it against complexity, maintenance burden, and fit with the project's direction. A low-reaction issue a maintainer considers important can still jump the queue; a high-reaction one that conflicts with the project's scope can still be declined.

## Becoming a co-maintainer

There's no fixed timeline, but the bar is:

- A track record of multiple merged PRs, across more than one package (not repeated small fixes to the same file).
- Contributions that hold up against [`CODING_RULES/09-enforcement.md`](CODING_RULES/09-enforcement.md)'s severity table without heavy rework in review.
- Demonstrated judgement on when an ADR is needed (the section above) without being told, on at least one PR.
- Being responsive enough in review threads that a second maintainer would reduce the bottleneck `MAINTAINERS.md` already names, not add to it.

If you think you meet this, say so on an issue or PR rather than waiting to be asked — the current maintainer will make the call and, if granted, update `MAINTAINERS.md` and `.github/CODEOWNERS` in the same PR that grants access. This is the project's answer to its own single-maintainer bus factor: there's a standing, documented path to a second maintainer, not just an acknowledgement of the risk.

## Code of Conduct

Governed separately by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md); violations are handled per that file's Enforcement section, independent of the technical decisions this file covers.
