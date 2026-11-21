# The Embedded Provider's runtime is a regular dependency, not an optional peer

[Back to docs/adr/README.md](README.md) • [Back to hld.md](../architecture/hld.md) • [Back to lld.md](../architecture/lld.md)

[ADR-0024](0024-v17-embedded-provider.md) made the Embedded Provider the default Embedding Provider and declared its runtime, `@huggingface/transformers`, an optional peer dependency of `raiminiscence-mcp`, so a project on the Ollama Provider wouldn't pay its install footprint. npm doesn't install optional peer dependencies. A user following the documented `npm install -g raiminiscence-mcp` therefore had no runtime: the default provider's `import()` failed, every `embed()` returned `null`, and `recall` silently ran on the lexical fallback. The README, user guide and `embedded.ts` all promised "no separate install".

## Decision

`@huggingface/transformers` moves to `raiminiscence-mcp`'s `dependencies`. This supersedes ADR-0024's optional-peer sub-decision only; the rest of ADR-0024 stands.

The runtime is still loaded with a dynamic `import()`, now in `core/adapters/feature-extraction.ts`, so a project configured onto the Ollama Provider never loads the ONNX runtime at startup. It still installs it.

## Considered options

- **Keep the optional peer and document the extra install step.** Rejected. The default provider would stay broken for anyone who misses one line of the docs, and the failure is silent by design: an unreachable provider degrades to lexical fallback rather than erroring.

## Consequences

- Every install of `raiminiscence-mcp` pulls the ONNX runtime and its native binding (`onnxruntime-node`, already allowed to run its install script in `pnpm-workspace.yaml`), including installs that only ever use Ollama.
- Model weights are still never bundled; they download on first use, as ADR-0024 describes.
- The package's own type declarations now apply, so the ambient `declare module` shim is gone.
