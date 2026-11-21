# Co-access Edges learn only from a selection, and Spreading Activation's boost is bounded

[Back to benchmarks/README.md](../../benchmarks/README.md) • [Back to docs/adr/README.md](README.md)

A replay of the per-turn hook on LongMemEval-S found Spreading Activation overriding relevance. Sessions went in by date. Before each one, every user turn in it ran a `recall` with the hook's parameters. On every question checked, the first 10 sessions formed a clique of 45 edges with weights near 400. Each clique Memory then carried a boost near 180, against fused similarities between 0.1 and 0.8. After the 10th session, every recall returned the same 10 Memories, whatever the prompt. On the first 46 questions, R@1 was 17.4 with edges and 91.3 without.

Two rules caused it:

- While the pool held `k` Memories or fewer, every recall returned all of them and strengthened every pair. That co-occurrence carries no information about relevance.
- The boost was `weight × 0.05` per edge, summed over every edge, with no ceiling, and added after Strength and Confidence Tier weighting. Weights grow by 2 per co-recall without limit, so after a few co-recalls the boost outweighs any similarity, and the boosted Memories win again and strengthen again.

## Decision

- **Selection only.** A `recall` that returned every candidate in its pool strengthens no Co-access Edge. Spaced Repetition updates still apply. A recall that left at least one candidate out strengthens its returned set as before.
- **Bounded boost.** The raw boost is computed as before, direct and multi-hop, and then saturated: `weight × 0.1 × (1 − e^(−raw))`, where `weight` is the candidate's Strength × Confidence Tier weight. A boost can never add more than 0.1 of the fused similarity's range, so edges reorder near-ties and never override a clearly better match. It decays with the Memory.

The cap of 0.1 and the saturating form were chosen from the scale of the fused score, before any replay with the fix ran. The replay that motivated this record measures the fix as a third arm.

## Consequences

- ADR-0006 and ADR-0007 still hold: only qualifying candidates are boosted, against the whole qualifying set. Only the boost's size changes.
- Surfacing (ADR-0008, ADR-0009) is unchanged. A surfaced-only Memory is still ranked below every qualifying one.
- A new store forms no edges until it holds more Memories than a recall returns. With the hook's `k` of 10, that is the 11th Memory.
- Edge weights still grow without limit on disk. Only their effect on ranking is bounded.
