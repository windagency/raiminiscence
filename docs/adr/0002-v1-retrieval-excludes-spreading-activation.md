# v1 Recall uses plain scoring, not a spreading-activation graph

[Back to 0006-spreading-activation-boost-only.md](0006-spreading-activation-boost-only.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md)

Recall in v1 scores candidates by cosine similarity × Strength × Confidence Tier weight, and returns the top-k. It deliberately does not implement the bidirectional BFS spreading-activation and Hebbian co-access strengthening that the project's own reference design (Valora Memory) uses. That graph-walk layer is the most novel and expensive part to get right, and isn't required to prove the core value of persistent, decaying, tiered memory — it's deferred as a fast-follow rather than built into v1.
