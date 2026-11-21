# The dynamic memory layer complements static docs; Decision Memories never touch docs/adr/

[Back to CONTEXT.md](../../CONTEXT.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to how-it-works.md](../how-it-works.md)

rAIminiscence owns the dynamic, agent-observed layer of project knowledge (episodic observations, consolidated patterns, and Decision Memories with agent-supplied rationale). It never reads, writes, or supersedes `CLAUDE.md`, `AGENTS.md`, or `docs/adr/`, which remain the human-curated source of truth for stable project facts and formal decisions. This boundary exists despite the name overlap between "Decision Memory" and "ADR": a Decision Memory is a staging/observation record, not a substitute for a human writing an ADR, and at most a consolidated, high-confidence one could suggest that a decision looks ADR-worthy.
