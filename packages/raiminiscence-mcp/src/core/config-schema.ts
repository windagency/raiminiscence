import { z } from "zod";

/**
 * Validates the untrusted on-disk `.raiminiscence.config.json` before use —
 * mirrors `project-root.ts`'s `RaiminiscenceConfig` field-for-field. Each
 * field is validated independently via `.catch(undefined)` rather than the
 * whole object being rejected together: one hand-edited, malformed field
 * degrades to "absent" for that field alone, not a hard failure for the
 * whole config. `watchedCommands`'s elements are intentionally left
 * unvalidated here — the non-string-entry filtering happens downstream in
 * `resolveWatchedCommands`.
 */
const raiminiscenceConfigSchema = z.object({
  storageRoot: z.string().optional().catch(undefined),
  embeddingProvider: z
    .object({
      provider: z.enum(["ollama", "embedded"]).optional(),
      endpoint: z.string().optional(),
      model: z.string().optional(),
    })
    .optional()
    .catch(undefined),
  sharedMemory: z.boolean().optional().catch(undefined),
  watchedCommands: z.array(z.unknown()).optional().catch(undefined),
});

export interface ParsedRaiminiscenceConfig {
  storageRoot?: string;
  embeddingProvider?: { provider?: "ollama" | "embedded"; endpoint?: string; model?: string };
  sharedMemory?: boolean;
  watchedCommands?: unknown[];
}

/** The config file's parsed JSON, field by field. Throws only when the top level isn't an object at all. */
export function parseRaiminiscenceConfig(json: unknown): ParsedRaiminiscenceConfig {
  return raiminiscenceConfigSchema.parse(json);
}
