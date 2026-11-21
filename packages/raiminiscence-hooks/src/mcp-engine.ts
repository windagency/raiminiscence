/**
 * ADR-0039: the engine calls the hook makes only when the event needs them.
 * Callers load this module with `import()`, so a per-turn prompt answered
 * by a running server never loads the engine. Kept as static re-exports so
 * the workspace's library-only rule still sees every binding pulled in.
 */
export { recall, resolveWatchedCommands } from "raiminiscence-mcp";
