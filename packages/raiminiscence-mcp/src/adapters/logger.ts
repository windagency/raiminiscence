import pino from "pino";

/**
 * The one module allowed to import `pino` (CONTRIBUTING.md's adapter
 * non-negotiable); everything else depends on this interface instead.
 * The subset of pino's `Logger` API `server.ts` actually calls, so a test can
 * inject a plain stub object instead of a real pino instance, mirroring the
 * `embeddingProvider` override pattern already used for testability.
 */
export interface ServerLogger {
  debug(fields: Record<string, unknown>, msg?: string): void;
  info(fields: Record<string, unknown>, msg?: string): void;
  warn(fields: Record<string, unknown>, msg?: string): void;
  error(fields: Record<string, unknown>, msg?: string): void;
}

/**
 * fd 2 (stderr), never fd 1 (stdout) — stdout is this server's MCP JSON-RPC
 * transport channel, so any log line written there corrupts the protocol
 * stream for the calling client. Exported on its own so a test can assert on
 * the destination's fd without spinning up a full logger.
 */
export function createLogDestination(): pino.DestinationStream {
  return pino.destination(2);
}

/**
 * `sessionId` isn't passed as pino's `base` (which would attach it
 * automatically but silently double up with `handle()`'s own explicit
 * `sessionId` field on every line) — `handle()` always passes it explicitly
 * instead, so the field is identical whether the real logger or a test's
 * injected stub is in use.
 */
export function createLogger(): ServerLogger {
  return pino({ level: process.env.RAIMINISCENCE_LOG_LEVEL ?? "info" }, createLogDestination());
}

let sharedFallbackLogger: ServerLogger | undefined;

/**
 * A lazily built process-wide logger for code with no logger DI of its own:
 * config resolution and the Memory file layer are called from too many places,
 * across packages, to thread a `ServerLogger` through every one. It keeps their
 * degrade-to-absent paths from being fully silent.
 */
export function fallbackLogger(): ServerLogger {
  sharedFallbackLogger ??= createLogger();
  return sharedFallbackLogger;
}
