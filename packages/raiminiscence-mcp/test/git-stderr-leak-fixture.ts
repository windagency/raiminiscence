// Run in a separate process (via tsx) so the test can capture this
// process's own stderr — a child git process's stdio, left unconfigured,
// inherits directly from this fd, bypassing Node's `process.stderr` object
// entirely, so a `vi.spyOn(process.stderr, "write")` in-process could never
// observe the leak this fixture exists to catch.
import { remember } from "#src/core/engine.js";
import { consolidate } from "#src/core/consolidate.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

const unreachableProvider: EmbeddingProvider = {
  identity: { provider: "stub", model: "stub" },
  async embed() {
    return null;
  },
};

async function main(): Promise<void> {
  const storageRoot = process.argv[2]!;
  await remember({ content: "A memory in a non-git storage root.", client: "claude-code", storageRoot, embeddingProvider: unreachableProvider });
  await consolidate({ storageRoot, embeddingProvider: unreachableProvider });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
