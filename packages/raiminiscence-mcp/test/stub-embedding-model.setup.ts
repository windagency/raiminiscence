import { vi } from "vitest";

// ADR-0038: no test may reach a developer's running MCP server for its vectors. Tests that exercise
// the warm path stub this back on themselves.
process.env.RAIMINISCENCE_WARM_EMBED = "off";

// Registered for every test file in the workspace by vitest.config.ts's setupFiles. It lives in this
// package because vi.mock resolves the specifier from here, and only raiminiscence-mcp depends on it.
// Any code path that falls back to the default Embedded Provider would otherwise download
// nomic-embed-text-v1 from Hugging Face and run it, making the suite network-dependent and slow on a
// cold runner. A failing pipeline makes the provider return null: the lexical fallback, the same
// outcome as engine.test.ts's unreachableProvider. A test file's own vi.mock of this module wins.
vi.mock("@huggingface/transformers", () => ({
  pipeline: async () => {
    throw new Error("stub-embedding-model.setup.ts: the embedding model is stubbed out in tests");
  },
}));
