# Zod is imported only by `*-schema.ts` modules

[Back to CONTRIBUTING.md](../../CONTRIBUTING.md) • [Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to developer-guide.md](../developer-guide.md)

`CONTRIBUTING.md` has two non-negotiables that pull against each other for Zod: all external input is validated with Zod before use, and no third-party library is imported outside an owned adapter. Before this decision both held only on paper. `zod` was imported directly by nine files across `raiminiscence-mcp`, `raiminiscence-hooks` and `raiminiscence-cli`, and no architecture test covered it.

A classic adapter, an owned interface wrapping `z.object` and friends one for one, would add nothing: Zod's builder API is the schema language, and wrapping it only renames it.

## Decision

Zod is confined by file name instead of by wrapper, the same rule as codemap-gen-for-agents' ADR-0031. Every schema lives in a module named `*-schema.ts`, and only those modules import `zod`. Each exposes plain parse functions, so callers never hold a Zod value or catch a Zod error type:

- `raiminiscence-mcp/src/core/config-schema.ts`: `.raiminiscence.config.json` (`parseRaiminiscenceConfig`).
- `raiminiscence-mcp/src/core/record-schema.ts`: the per-record envelope shared by every index, and the Shared Memory merge driver's `updatedAt` (`parseRecordEnvelope`, `recordUpdatedAt`).
- `raiminiscence-mcp/src/core/embeddings/embedding-schema.ts`: Ollama's `/api/embeddings` response and on-disk embedding records (`parseOllamaEmbedding`, `parseEmbeddingRecord`).
- `raiminiscence-mcp/src/tool-input-schema.ts`: the eight MCP tools' input shapes. The MCP SDK's `registerTool` takes raw Zod shapes and validates against them itself, so these are exported as shapes; `server.ts` passes them through without importing `zod`.
- `raiminiscence-hooks/src/hook-input-schema.ts`: hook stdin (`validateHookInput`, and the `HookInput` type).
- `raiminiscence-argv/src/flag-value-schema.ts`: both CLIs' flag values (`parseAllowedValue`, `parseNumberValue`, `parseDateValue`). Originally two copies, `raiminiscence-hooks/src/install-args-schema.ts` and `raiminiscence-cli/src/flag-value-schema.ts`, merged into the package both CLIs already share.

Later additions for files read back from disk: [ADR-0031](0031-on-disk-files-are-validated-on-read.md).

The root `__tests__/architecture/third-party-containment.test.ts` enforces it for every package and every import form, dynamic `import()` included.

## Consequences

- A new external input means adding or extending a `*-schema.ts` module. Importing `zod` anywhere else fails the architecture test.
- No behaviour changed: every schema moved verbatim, and each parse function keeps its caller's previous accept/reject outcome.
- The `*-schema.ts` suffix is reserved for Zod schema modules. A file named that way that doesn't validate external input would weaken the rule.
