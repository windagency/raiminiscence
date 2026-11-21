# One shared `raiminiscence-hooks` package, not one per client

[Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to developer-guide.md](../developer-guide.md)

Client integration (the `SessionStart`-equivalent auto-priming shim) ships as a single package, `raiminiscence-hooks`, covering Claude Code, Cursor, and Codex CLI with per-client config templates — not as three separate packages (`raiminiscence-claude-code`, `raiminiscence-cursor`, `raiminiscence-codex`). All three clients turned out to need the identical mechanism (a shim calling the core engine's internal `overview` function directly, bypassing MCP, since none of them can reliably call an MCP tool from their earliest session-lifecycle hook); the only real difference is config file format (JSON vs TOML) and location. Splitting into three packages would mean maintaining and versioning three near-identical wrappers for no behavioural benefit.
