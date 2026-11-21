import { servedRecall, startWarmProcess } from "raiminiscence-mcp/recall-client";
import type { RecallResultItem } from "raiminiscence-mcp/recall-client";
import type { RecallResult } from "raiminiscence-mcp";
import { formatSummaryLine, logHookError, withTimeout } from "./hook-utils.js";

const DEFAULT_TIMEOUT_MS = 2000;
/** ADR-0034: summary lines are cheap, so the hook keeps ten results while `recall`'s own default drops to three. */
const PROMPT_RECALL_K = 10;

export interface PromptRecallOptions {
  storageRoot: string;
  prompt: string;
  timeoutMs?: number;
  /** Injectable for testing; defaults to asking a running MCP server (ADR-0039). `null` means no server answered. */
  servedRecallFn?: (params: { storageRoot: string; query: string; k: number }) => Promise<RecallResultItem[] | null>;
  /** Injectable for testing; defaults to starting a warm process in the background (ADR-0040). */
  startWarmFn?: (params: { storageRoot: string }) => unknown;
  /** Injectable for testing; defaults to the real core-engine recall call. */
  recallFn?: (params: { storageRoot: string; query: string; k: number; triggerConsolidation: boolean }) => Promise<RecallResult> | RecallResult;
}

/** The engine is imported only when no server answered, so the served path skips its load (ADR-0039). */
async function localRecall(params: { storageRoot: string; query: string; k: number; triggerConsolidation: boolean }): Promise<RecallResult> {
  const { recall } = await import("./mcp-engine.js");
  return recall(params);
}

async function recallResults(options: PromptRecallOptions): Promise<RecallResultItem[]> {
  const params = { storageRoot: options.storageRoot, query: options.prompt, k: PROMPT_RECALL_K };
  const served = await (options.servedRecallFn ?? servedRecall)(params);
  if (served) return served;
  const recallFn = options.recallFn ?? localRecall;
  try {
    return (await recallFn({ ...params, triggerConsolidation: false })).results;
  } finally {
    // After the local recall, so the warm process's model load doesn't compete with this one.
    (options.startWarmFn ?? startWarmProcess)({ storageRoot: options.storageRoot });
  }
}

/**
 * Per-turn auto-recall: asks a running MCP server for the recall first
 * (ADR-0039), and otherwise calls the core engine's `recall` directly and
 * then starts a warm process for the next prompt (ADR-0040), with
 * the current prompt's literal text as the query either way, opting out of
 * Consolidation's opportunistic inline trigger (a full Clustering/Promotion/
 * Pruning/etc. pass has no business running on every single prompt). Never
 * blocks past its own internal timeout, never throws, and drops
 * `surfacedVia`/`conflictsWith`/`conflictCandidateWith` from the formatted
 * output — on timeout or any failure it silently returns no context ("")
 * rather than erroring or hanging the turn.
 */
export async function promptRecallText(options: PromptRecallOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const results = await withTimeout(recallResults(options), timeoutMs, "raiminiscence-hooks: recall timed out");
    return results.map(formatSummaryLine).join("\n");
  } catch (error) {
    logHookError("prompt-recall", "failed to load per-turn recall context (recall call or timeout); returning empty context", error);
    return "";
  }
}
