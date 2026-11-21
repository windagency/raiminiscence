import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classesImporting } from "./helpers.js";

const MCP_SRC = "packages/raiminiscence-mcp/src";
const EMBEDDINGS_DIR = `${MCP_SRC}/core/embeddings`;

/** The adapter boundary's only public surface — every other file in the directory must be internal. */
const PUBLIC_FILES = new Set(["provider.ts", "default-provider.ts"]);

/**
 * `packed-index.ts` is deliberately excluded here — despite the spec's
 * Implementation Decisions listing it alongside ollama/embedded, it's a
 * general packed-vector-storage utility imported directly by six core/*
 * modules (recall-cache, clustering, consolidate, remember, query-scoring,
 * reembedding) that have nothing to do with the EmbeddingProvider adapter
 * boundary; asserting containment on it would fail against legitimate,
 * pre-existing call sites rather than a real violation.
 */
const NON_ADAPTER_FILES = new Set(["packed-index.ts"]);

/**
 * ADR-0024's EmbeddingProvider Adapter pattern: every implementation under
 * `core/embeddings/` (today `ollama.ts`/`embedded.ts`) is reachable only
 * through `provider.ts`'s interface or `default-provider.ts`'s factory.
 * Asserted against the directory's actual file listing, not a hardcoded
 * pair of names, so a third implementation added later is covered
 * automatically without this test needing an edit.
 */
describe("raiminiscence-mcp architecture: EmbeddingProvider adapter isolation", () => {
  const implementationFiles = readdirSync(EMBEDDINGS_DIR).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".d.ts") && !PUBLIC_FILES.has(name) && !NON_ADAPTER_FILES.has(name),
  );

  it("the directory actually has at least one implementation file to check (a canary against this test silently checking nothing)", () => {
    expect(implementationFiles.length).toBeGreaterThan(0);
  });

  for (const file of implementationFiles) {
    it(`${file} (an EmbeddingProvider implementation) is importable only from within core/embeddings/`, () => {
      const importers = classesImporting(MCP_SRC, `core/embeddings/${file}`).filter((path) => !path.includes("/core/embeddings/"));
      expect(importers).toEqual([]);
    });
  }
});
