import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmbeddingProviderFromConfig, defaultProvider } from "#src/core/embeddings/default-provider.js";
import { resolveEmbeddingProviderConfig } from "#src/core/project-root.js";

describe("createEmbeddingProviderFromConfig", () => {
  it('constructs the Embedded Provider when resolution yields "embedded"', () => {
    const provider = createEmbeddingProviderFromConfig({ provider: "embedded" });
    expect(provider.identity.provider).toBe("embedded");
  });

  it('constructs the Ollama Provider when resolution yields "ollama"', () => {
    const provider = createEmbeddingProviderFromConfig({ provider: "ollama" });
    expect(provider.identity.provider).toBe("ollama");
  });

  it("passes a configured model through to the Ollama Provider", () => {
    const provider = createEmbeddingProviderFromConfig({ provider: "ollama", model: "custom-embed" });
    expect(provider.identity).toEqual({ provider: "ollama", model: "custom-embed" });
  });

  it("passes a configured model through to the Embedded Provider", () => {
    const provider = createEmbeddingProviderFromConfig({ provider: "embedded", model: "custom/embedded-model" });
    expect(provider.identity).toEqual({ provider: "embedded", model: "custom/embedded-model" });
  });
});

describe("defaultProvider", () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "raiminiscence-default-provider-"));
    originalCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves to the Embedded Provider for a project with no embeddingProvider config at all — the new v17 default", () => {
    expect(resolveEmbeddingProviderConfig(dir)).toEqual({ provider: "embedded" });
    expect(defaultProvider().identity.provider).toBe("embedded");
  });
});
