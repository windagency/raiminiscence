import { browseMemories, inspectMemory, inspectQuery, type EmbeddingProvider } from "raiminiscence-mcp";
import { parseArgs } from "./args.js";
import { formatBrowseResults, formatMemoryPanel, formatQueryResult } from "./format.js";

export interface RunInspectCliOptions {
  storageRoot: string;
  /** Injectable for testing; defaults (via `inspectQuery` itself) to the real Ollama provider. */
  embeddingProvider?: EmbeddingProvider;
}

/**
 * `raiminiscence-inspect`'s actual work, factored out of the bin entry point
 * (`inspect-cli.ts`) so it's callable against a fixture storage root in
 * tests without spawning a real process.
 */
export async function runInspectCli(argv: string[], options: RunInspectCliOptions): Promise<string> {
  const args = parseArgs(argv);

  switch (args.mode) {
    case "id": {
      const result = inspectMemory({ id: args.id, storageRoot: options.storageRoot });
      return formatMemoryPanel(result, args.detailed);
    }
    case "query": {
      const result = await inspectQuery({
        query: args.query,
        storageRoot: options.storageRoot,
        embeddingProvider: options.embeddingProvider,
      });
      return formatQueryResult(result, args.detailed);
    }
    case "list": {
      const results = browseMemories({ storageRoot: options.storageRoot, filters: args.filters });
      return formatBrowseResults(results, args.detailed);
    }
  }
}
