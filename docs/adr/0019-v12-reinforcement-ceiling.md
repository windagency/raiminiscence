# v12 bounds Spaced Repetition + Outcome Feedback's positive term with a shared, proportional Reinforcement Ceiling

[Back to CONTEXT.md](../../CONTEXT.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to lld.md](../architecture/lld.md) • [Back to how-it-works.md](../how-it-works.md)

`computeStrength`'s effective-Half-life formula added Spaced Repetition's `+2 days` (per Recall hit or Consolidation survival) and Outcome Feedback's `+5 days` (per positive-feedback event) with no ceiling at all — each further qualifying event kept extending effective Half-life indefinitely. The extended hippo-memory benchmark (`benchmarks/results/2026-09-15-extended-results.md`, §2) made the consequence concrete: at 180 days since anchor with 50 positive-feedback events, rAIminiscence's Strength reached 0.663 versus 0.022 unreinforced — a ~30x effect — while hippo-memory's competing formula, bounded to a (0.5x, 1.5x) multiplicative ratio of base Half-life by construction, only reached 0.061 from 0.016 (~4x). Unbounded compounding growth in a core ranking formula is a correctness concern independent of the comparison to hippo-memory; the benchmark just made it visible and measurable.

Outcome Feedback's *negative* term was not part of this problem: it already saturates against the existing hard floor (`MIN_EFFECTIVE_HALF_LIFE_DAYS = 1`) within a handful of events, so it stays untouched by this change.

## Decision

Both mechanisms' positive contributions now feed one shared, asymptotically-approached ceiling instead of growing without limit:

```
rawBonus   = (recallCount + consolidationSurvivalCount) × 2 + positiveFeedbackCount × 5   (unchanged per-event weights)
capDays    = 4 × baseHalfLifeDays                                                          (proportional per Memory Kind)
boundedBonus = capDays × (1 − 0.5^(rawBonus / 30))                                         (half of the ceiling at 30 raw bonus-days)
```

`boundedBonus` replaces the previously-unbounded sum in `computeStrength`'s effective-Half-life calculation; everything else (grace period, error amplification, the negative term and its hard floor) is unchanged.

Three sub-decisions, each a genuine alternative that was considered and rejected:

1. **A smooth diminishing-returns curve, not a hard clamp on the raw sum.** A hard clamp (`min(rawBonus, cap)`) would have been the smaller change, but it produces a discontinuous, cliff-like jump in the marginal value of each event right at the cap — a smooth asymptotic curve degrades gracefully and reads as an intentional design rather than a patched-on limit.
2. **The cap is proportional to `baseHalfLifeDays`, not a flat number of days.** Episodic/Semantic/Decision Memories already have different base Half-lives (7/30/21 days) by deliberate design (see `CONTEXT.md`'s Half-life entry); a flat cap would let Episodic Memories get disproportionately supercharged relative to Semantic ones for the same event count, undermining that existing per-kind differentiation.
3. **Spaced Repetition and Outcome Feedback share one ceiling, rather than each getting its own.** They are the identical unbounded-additive shape, differing only in trigger (Recall/Consolidation vs. explicit feedback). Capping one and not the other would just relocate the exact compounding problem onto whichever mechanism kept growing unboundedly, and would invite the obvious "why did you bound one but not the other" question from a future reader.

The constants (`4×` cap multiplier, `30`-day half-saturation point) were chosen empirically against the benchmark's own 180-day/50-event scenario: they keep rAIminiscence's reinforcement meaningfully stronger than hippo-memory's bounded formula (0.463 vs. hippo's 0.061 at that scenario — still ~7.6x, preserving the differentiator the earlier benchmark work was measuring) while replacing "no ceiling" with a real, finite one. They are fixed constants with no project-config surface, consistent with every other decay constant in `decay.ts` except Spreading Activation's `maxHops` — which earned its config surface from a documented, real per-project tradeoff (ADR-0009) that this change has no equivalent evidence for yet.

This is a design decision only; implementation (the `decay.ts` change, tests, and a benchmark re-run) is deliberately left to a separate, dedicated pass — mirroring how v11 (ADR-0017/0018) was designed in one session and implemented in a later one.
