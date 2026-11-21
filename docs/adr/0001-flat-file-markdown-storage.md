# Flat-file Markdown storage, not an embedded/vector database

[Back to 0025-v19-opportunistic-consolidation-debounce.md](0025-v19-opportunistic-consolidation-debounce.md) • [Back to 0031-on-disk-files-are-validated-on-read.md](0031-on-disk-files-are-validated-on-read.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to how-it-works.md](../how-it-works.md) • [Back to GOVERNANCE.md](../../GOVERNANCE.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

Memories are stored as one Markdown file with YAML frontmatter each, under `.raiminiscence/memory/`, rather than in SQLite, a vector database, or a monolithic graph/JSON file. We chose this so memories stay human-readable and editable without tooling, diff cleanly in git, and the server has zero native/infrastructure dependencies to install across Claude Code, Cursor, and Codex — at the cost of needing to scan files for cosine search rather than using a native vector index.
