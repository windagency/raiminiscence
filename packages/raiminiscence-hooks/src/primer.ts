import { overview } from "raiminiscence-mcp";
import type { OverviewResult, OverviewResultItem } from "raiminiscence-mcp";
import { formatSummaryLine, logHookError, withTimeout } from "./hook-utils.js";

const DEFAULT_TIMEOUT_MS = 2000;

export interface PrimerOptions {
  storageRoot: string;
  timeoutMs?: number;
  /** Injectable for testing; defaults to the real core-engine overview call. */
  overviewFn?: (params: { storageRoot: string }) => Promise<OverviewResult> | OverviewResult;
}

/** v13 (ADR-0020): labels a `currentFocus` line distinctly from the plain top-N summary lines above it. */
function formatCurrentFocusLine(label: "own" | "project", item: OverviewResultItem): string {
  return `[currentFocus:${label}] ${formatSummaryLine(item)}`;
}

/**
 * The SessionStart primer: calls the core engine's `overview` directly,
 * bypassing MCP entirely (no client can reliably call an MCP tool this
 * early in the session lifecycle). Never blocks past its own internal
 * timeout, never throws, and never triggers Consolidation — on timeout or
 * any failure it silently returns no context ("") rather than erroring or
 * hanging session start.
 *
 * v13 (ADR-0020): also surfaces `currentFocus` — the caller's own most
 * recent Checkpoint, and (when it differs) the project's most recent
 * overall — riding along on this same `overview()` call, no second core
 * call needed.
 */
export async function primerText(options: PrimerOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const overviewFn = options.overviewFn ?? ((params) => overview(params));

  try {
    const result = await withTimeout(
      Promise.resolve(overviewFn({ storageRoot: options.storageRoot })),
      timeoutMs,
      "raiminiscence-hooks: overview timed out",
    );
    const lines = result.results.map(formatSummaryLine);

    const { own, project } = result.currentFocus;
    if (own) lines.push(formatCurrentFocusLine("own", own));
    if (project && project.id !== own?.id) lines.push(formatCurrentFocusLine("project", project));

    return lines.join("\n");
  } catch (error) {
    logHookError("primer", "failed to load SessionStart primer context (overview call or timeout); returning empty context", error);
    return "";
  }
}
