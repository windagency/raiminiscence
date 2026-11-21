# ADR-0037 weight-relative boost: registration

[Back to benchmarks/README.md](../../../../README.md)

Written 2026-11-01, before any tuning run and before any Hono number under a new formula.

## Candidate formula

For a qualifying candidate c, with Strength x Confidence weight w_c:

    boost(c) = CAP * w_c * AGG over qualifying neighbours n of rel(c, n) * act(n)

- act(n) = rankScore(n) / max rankScore over the qualifying set. The best match has 1.
  Activation spreads from what the query matched, not from every neighbour equally.
- rel(c, n) = weight(c, n) / NORM, one of:
  - "own": c's strongest edge weight in the pool.
  - "neighbour": n's strongest edge weight in the pool.
  - "pair": the larger of the two.
- AGG is "max" or "sum, capped at 1".
- Multi-hop endpoints (maxHops > 1) contribute rel = path min weight / NORM, times
  HOP_DECAY^(d-1), the same way.

## Grid, tuned on Flask only

NORM in {own, neighbour, pair} x AGG in {max, sum} x CAP in {0.05, 0.1, 0.2, 0.3}: 24 configs.
Selection: highest Flask file recall@10, on minus off. Ties go to the smaller CAP, then max over
sum, then own, neighbour, pair. Simulated offline from the off arm's scores and the trained
edges; maxHops is 1 by default, so the simulation is exact. Check: the ADR-0035 formula must
reproduce the registered on arm.

## One-shot tests with the chosen config, through the real code

1. Hono, the registered replay unchanged. Primary: file recall@10, on minus off.
2. LongMemEval-S Co-access replay, the 324 questions, registered as before.

## Ship rule

Ship ADR-0037 only if both hold:
- Hono file recall@10 on minus off has a bootstrap lower bound above 0.
- LongMemEval replay R@1 and all-evidence@5, on minus off, have point estimates of -1.0 or better.
Otherwise report and do not ship.
