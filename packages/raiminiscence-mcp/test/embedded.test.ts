import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedEmbeddingProvider } from "#src/core/embeddings/embedded.js";

const embedMock = vi.fn();
const pipelineMock = vi.fn(async () => embedMock);

/**
 * `@huggingface/transformers` (loaded by `core/adapters/feature-extraction.ts`)
 * is already stubbed by `stub-embedding-model.setup.ts` for
 * every test file — overridden here at the module boundary the same way
 * `embedding-provider-config.test.ts` mocks Ollama's `global.fetch`, so no
 * test here downloads a real model or needs network.
 */
vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

describe("createEmbeddedEmbeddingProvider", () => {
  afterEach(() => {
    vi.resetAllMocks();
    pipelineMock.mockImplementation(async () => embedMock);
  });

  it("embeds text via the mocked feature-extraction pipeline", async () => {
    embedMock.mockResolvedValue({ tolist: () => [[0.1, 0.2, 0.3]] });
    const provider = createEmbeddedEmbeddingProvider();

    const vector = await provider.embed("hello", "query");

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", "nomic-ai/nomic-embed-text-v1");
  });

  it("loads the pipeline once and reuses it across multiple embed calls", async () => {
    embedMock.mockResolvedValue({ tolist: () => [[1, 2]] });
    const provider = createEmbeddedEmbeddingProvider();

    await provider.embed("a", "query");
    await provider.embed("b", "query");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it("returns null, never throwing, when the pipeline factory itself rejects (e.g. runtime not installed)", async () => {
    pipelineMock.mockRejectedValue(new Error("module not found"));
    const provider = createEmbeddedEmbeddingProvider();

    await expect(provider.embed("hello", "query")).resolves.toBeNull();
  });

  it("returns null, never throwing, when inference itself rejects", async () => {
    embedMock.mockRejectedValue(new Error("inference failed"));
    const provider = createEmbeddedEmbeddingProvider();

    await expect(provider.embed("hello", "query")).resolves.toBeNull();
  });

  it("uses a configured model override instead of the default", async () => {
    embedMock.mockResolvedValue({ tolist: () => [[1]] });
    const provider = createEmbeddedEmbeddingProvider({ model: "custom/model" });

    await provider.embed("hello", "query");

    expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", "custom/model");
  });

  it("puts nomic's task prefixes before a query and a document (ADR-0042)", async () => {
    embedMock.mockResolvedValue({ tolist: () => [[1]] });
    const provider = createEmbeddedEmbeddingProvider();

    await provider.embed("what broke the build", "query");
    await provider.embed("The build broke on a missing lockfile.", "document");

    expect(embedMock.mock.calls.map(([text]) => text)).toEqual([
      "search_query: what broke the build",
      "search_document: The build broke on a missing lockfile.",
    ]);
    expect(provider.identity).toEqual({ provider: "embedded", model: "nomic-ai/nomic-embed-text-v1", prompt: "nomic-task-prefix" });
  });

  it("sends another model's text bare, with no prompt in its identity (ADR-0042)", async () => {
    embedMock.mockResolvedValue({ tolist: () => [[1]] });
    const provider = createEmbeddedEmbeddingProvider({ model: "custom/model" });

    await provider.embed("hello", "query");

    expect(embedMock.mock.calls[0]![0]).toBe("hello");
    expect(provider.identity).toEqual({ provider: "embedded", model: "custom/model" });
  });

  it("reads a plain array output shape (no .tolist/.data) directly", async () => {
    embedMock.mockResolvedValue([0.4, 0.5]);
    const provider = createEmbeddedEmbeddingProvider();

    await expect(provider.embed("hello", "query")).resolves.toEqual([0.4, 0.5]);
  });
});
