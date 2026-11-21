import type { ConfidenceTier, MemoryKind } from "raiminiscence-mcp";

/**
 * Every hook step fails open (never blocks/breaks the host tool — see each
 * call site's own doc comment), so a caught failure is always swallowed
 * rather than rethrown. That must not mean silent: this logs it to stderr,
 * fd 2, tagged with the hook's own name, before the caller returns its
 * empty/no-op fallback — so a broken hook installation is debuggable instead
 * of invisible. `raiminiscence-mcp`'s own `adapters/logger.ts` isn't used here: it
 * isn't re-exported from that package's public entrypoint (`index.ts`), so
 * importing it would mean reaching past that package's own module boundary
 * into its `dist/` internals — but the line is still structured fields as a
 * single JSON object, matching that logger's shape, rather than an
 * interpolated string. `console.error` writes to stderr, never stdout —
 * this package's hooks always write their JSON hook output to stdout, so a
 * log line here can never corrupt that protocol channel.
 */
export function logHookError(hookName: string, message: string, error: unknown): void {
  const errorField = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  console.error(JSON.stringify({ hook: hookName, message, error: errorField }));
}

/** Rejects with `timeoutMessage` if `promise` hasn't settled within `timeoutMs`; never leaves a dangling timer either way. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The subset of `OverviewResultItem`/`RecallResultItem` `formatSummaryLine` actually needs, so neither module has to import the other's item type just for this. */
export interface SummarizableItem {
  kind: MemoryKind;
  confidence: ConfidenceTier;
  summary: string;
}

export function formatSummaryLine(item: SummarizableItem): string {
  return `[${item.kind}, ${item.confidence}] ${item.summary}`;
}
