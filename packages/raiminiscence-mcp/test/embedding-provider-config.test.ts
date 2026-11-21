import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEmbeddingProviderConfig } from "#src/core/project-root.js";
import { createOllamaEmbeddingProvider } from "#src/core/embeddings/ollama.js";

describe("resolveEmbeddingProviderConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "raiminiscence-embedding-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns both sub-fields when both are set, defaulted to the ollama provider", () => {
    writeFileSync(
      join(dir, ".raiminiscence.config.json"),
      JSON.stringify({ embeddingProvider: { endpoint: "http://example.internal:1234", model: "custom-embed" } }),
    );

    expect(resolveEmbeddingProviderConfig(dir)).toEqual({
      provider: "ollama",
      endpoint: "http://example.internal:1234",
      model: "custom-embed",
    });
  });

  it("returns only the sub-field that's set", () => {
    writeFileSync(join(dir, ".raiminiscence.config.json"), JSON.stringify({ embeddingProvider: { model: "custom-embed" } }));

    const config = resolveEmbeddingProviderConfig(dir);
    expect(config.model).toBe("custom-embed");
    expect(config.endpoint).toBeUndefined();
  });

  it("resolves to the embedded provider when the config file/block is absent", () => {
    expect(resolveEmbeddingProviderConfig(dir)).toEqual({ provider: "embedded" });
  });

  it("resolves to the embedded provider when the block is present but empty", () => {
    writeFileSync(join(dir, ".raiminiscence.config.json"), JSON.stringify({ embeddingProvider: {} }));

    expect(resolveEmbeddingProviderConfig(dir)).toEqual({ provider: "embedded" });
  });

  it("resolves to ollama when endpoint/model are set but provider is omitted", () => {
    writeFileSync(join(dir, ".raiminiscence.config.json"), JSON.stringify({ embeddingProvider: { model: "custom-embed" } }));

    expect(resolveEmbeddingProviderConfig(dir).provider).toBe("ollama");
  });

  it("an explicit provider field takes precedence over endpoint/model being set", () => {
    writeFileSync(
      join(dir, ".raiminiscence.config.json"),
      JSON.stringify({ embeddingProvider: { provider: "embedded", endpoint: "http://example.internal:1234", model: "custom-embed" } }),
    );

    expect(resolveEmbeddingProviderConfig(dir)).toEqual({
      provider: "embedded",
      endpoint: "http://example.internal:1234",
      model: "custom-embed",
    });
  });

  it("an explicit provider field takes precedence when endpoint/model are absent", () => {
    writeFileSync(join(dir, ".raiminiscence.config.json"), JSON.stringify({ embeddingProvider: { provider: "ollama" } }));

    expect(resolveEmbeddingProviderConfig(dir)).toEqual({ provider: "ollama" });
  });
});

describe("createOllamaEmbeddingProvider with a resolved config", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the configured endpoint/model instead of the hardcoded Ollama defaults", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ embeddings: [[1, 2, 3]] }) })) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const provider = createOllamaEmbeddingProvider({ endpoint: "http://configured.internal:9999", model: "configured-model" });
    await provider.embed("hello", "query");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://configured.internal:9999/api/embed",
      expect.objectContaining({ body: JSON.stringify({ model: "configured-model", input: "hello" }) }),
    );
  });

  it("falls back to the hardcoded Ollama defaults when no config is given", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ embeddings: [[1, 2, 3]] }) })) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const provider = createOllamaEmbeddingProvider({});
    await provider.embed("hello", "query");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ body: JSON.stringify({ model: "nomic-embed-text", input: "search_query: hello" }) }),
    );
    expect(provider.identity).toEqual({ provider: "ollama", model: "nomic-embed-text", prompt: "nomic-task-prefix" });
  });

  it("returns the vector from /api/embed's embeddings array", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ embeddings: [[0.5, 0.25]] }) })) as unknown as typeof fetch;

    await expect(createOllamaEmbeddingProvider({}).embed("hello", "query")).resolves.toEqual([0.5, 0.25]);
  });
});
