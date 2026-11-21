# v15 introduces Inspect, a read-only diagnostic tool with its own scoring path, never Recall's

[Back to CONTEXT.md](../../CONTEXT.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to lld.md](../architecture/lld.md) • [Back to developer-guide.md](../developer-guide.md) • [Back to user-guide.md](../user-guide.md) • [Back to packages/raiminiscence-cli/README.md](../../packages/raiminiscence-cli/README.md)

rAIminiscence has no way for a human or agent to see why a Memory has the
Strength/Half-life/Confidence Tier it currently has, or why a query would
include, exclude, or boost a given candidate — confirmed as the sharpest
felt pain ("no visibility into the memory store") when v15's direction was
locked via an internal wayfinder map. A prototype
comparing three shapes — a dedicated tool, a `recall --explain` flag, and
richer JSON fields on the existing response — settled on the first: a
dedicated tool and CLI, both named `inspect`.

Nailing down Inspect's terminology surfaced a real contradiction rather
than a naming detail: Recall is not a pure read. `recall()`
(`packages/raiminiscence-mcp/src/core/recall.ts`) increments `recallCount`
and resets `lastRecalledAt` on every returned Memory, and strengthens the
Co-access Edge between every pair of co-returned results, as an intrinsic
part of what a Recall call *is* — these are the mechanisms Spaced
Repetition and Co-access Edge strengthening rest on (see `CONTEXT.md`). If
Inspect's query-explaining mode simply called `recall()` internally to
determine what would score, running Inspect purely out of curiosity would
silently reinforce the Memories it looked at — extending their Half-life
and strengthening their Co-access Edges — which contradicts Inspect's own
purpose as a diagnostic surfaced specifically to make the decay/reinforcement
mechanism legible, not to perturb it.

Two other facts settled the rest of Inspect's shape without further
trade-offs: reinforcement bookkeeping is aggregate-counters-only today
(`recallCount`, `consolidationSurvivalCount`, `positiveFeedbackCount`,
`negativeFeedbackCount`, a single overwritten `lastRecalledAt`) with no
per-event log anywhere in `MemoryFrontmatter`; and a Recall call's result
set (query, near-misses, exclusions) is computed in-memory and returned
once, never persisted — so there is nothing to distinguish "explain a
specific past call" from "explain what this query would do right now,"
since the two are the same thing.

## Decision

1. **Inspect gets its own scoring path, entirely separate from `recall()`,
   that never writes anything.** It duplicates Recall's scoring logic —
   cosine similarity × Strength × Confidence Tier weight, plus Spreading
   Activation's boost/surface computation over the existing Co-access
   Edge index — but never calls `writeMemory`, never touches
   `recallCount`/`lastRecalledAt`, and never calls `strengthenCoAccess`.
   Running Inspect any number of times changes nothing about the Memories
   it looked at.
2. Inspect is one MCP tool and one CLI command, both literally named
   `inspect` (CLI bin: `raiminiscence-inspect`), living in a new package,
   `raiminiscence-cli`, that imports `raiminiscence-mcp` as a library —
   the same pattern `raiminiscence-hooks` already uses via
   `raiminiscence-mcp`'s existing `src/index.ts` public surface (storage,
   decay, recall internals), not a new one invented for this.
3. Three modes on the one tool/command: explain a Memory by id; explain
   how a query would score right now (always fresh — there is no stored
   past call to reference instead, and none is being added); browse/list
   Memories filtered by Memory Kind, Confidence Tier, a Strength
   threshold, Scope, and a `createdAt` range.
4. Output is compact by default (mirroring the prototype's collapsed
   near-miss list), with a flag for full detail.
5. Reinforcement detail in Inspect's output is built entirely from the
   existing aggregate counters — no `schemaVersion` bump, no new
   per-event history field.

Sub-decisions, each a genuine alternative considered and rejected:

1. **A side-effect-free scoring path, not `recall()` reused as-is.**
   Reusing `recall()` directly was the cheaper build — no logic
   duplication — but a diagnostic tool that mutates the exact state it
   exists to explain is surprising and would quietly corrupt the thing
   users run Inspect to trust. Rejected in favor of duplicating the
   scoring logic (or, at implementation time, factoring `recall()` into a
   shared pure-scoring core plus a thin mutating wrapper, if that turns
   out cleaner than two independent copies — left to the implementation
   effort to decide, not this ADR).
2. **A new dedicated package (`raiminiscence-cli`), not a second bin
   inside `raiminiscence-mcp`.** A second bin would ship faster (nothing
   new to publish/version), but `raiminiscence-mcp`'s own description is
   "the core engine ... plus the MCP server built on top of it" —
   bolting a human-facing CLI onto that package would make the
   description inaccurate. A new package importing the existing library
   surface matches the precedent `raiminiscence-hooks` already set and
   keeps the split honest.
3. **Always fresh, never a specific past call.** Persisting Recall's
   result set (query, near-misses, exclusions) so Inspect could reference
   an exact past call was considered, since state can change between a
   Recall and a later Inspect (a Memory invalidated or pruned in
   between). Rejected: nothing today persists a Recall call at all, and
   adding that persistence purely to serve Inspect would be new
   surface-area for a secondary tool, not the differentiator itself —
   "run Inspect again, now" is an acceptable, much cheaper substitute.
4. **A narrow, single-purpose bin (`raiminiscence-inspect`), not an
   umbrella `raiminiscence <subcommand>` command.** The prototype's own
   mockup wrote `raiminiscence inspect <id>`, implying an umbrella entry
   point, but every existing bin in the repo
   (`raiminiscence-mcp`, `raiminiscence-hooks-shim`,
   `raiminiscence-hooks-install`) is one narrow command per capability
   with no subcommand parser anywhere in the codebase. Rejected breaking
   that convention for Inspect alone; `raiminiscence-inspect --list ...`
   reads just as well and stays consistent with everything else that
   ships today.
5. **Existing aggregate counters only, no new reinforcement-event
   schema.** A capped per-event history (exact dates of each Recall hit
   or Outcome Feedback event) would let Inspect show a real timeline
   instead of totals, but the prototype's own gloss line ("reinforced 4×
   Recall hit, 2× positive Outcome Feedback") is already fully derivable
   from what's tracked today. Rejected adding a `schemaVersion` bump and
   migration for detail nothing yet needs — consistent with the
   project's zero-infra/minimal bias, revisit only if the counters prove
   insufficient in practice.

No change to Recall itself: its side effects (`recallCount`,
`lastRecalledAt`, Co-access Edge strengthening) remain exactly as they are
— Inspect adds a second, non-mutating way to see the same mechanism, it
doesn't change what Recall does. Implementation (the `raiminiscence-cli`
package, Inspect's scoring path, and its three modes) is a separate
follow-on effort, tracked outside this ADR.

**Addendum (2026-09-22):** the spec's Implementation Decisions section said
`browseMemories` should read via the existing v14/ADR-0021 versioned corpus
cache, "no new corpus-scan path." The shipped code
(`packages/raiminiscence-mcp/src/core/inspect.ts`'s `browseMemories`, and
`inspectQuery`'s near-miss reporting) instead calls `readAllMemories`
directly, deliberately bypassing that cache. This is intentional, not a
missed spec item: the v14 cache is active-only (it exists to serve
`recall()`/`consolidate()`, which never need a stale or retracted Memory),
but browsing and explaining `stale`/`retracted` Memories by Confidence Tier
is one of Inspect's own user stories — the entire reason Inspect exists is
to make visible the state Recall's own active-only path hides. Reusing the
active-only cache for these two call sites would have silently excluded the
Memories they're specifically asked to surface. The extra full-directory
read this costs is accepted because Inspect, unlike `recall()`, is never a
hot path.
