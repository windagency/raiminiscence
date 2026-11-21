import { isSpanContextValid, metrics, SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * The one module allowed to import `@opentelemetry/api` (CONTRIBUTING.md's
 * adapter non-negotiable). Only the API is a dependency: with no SDK
 * registered every call here is a no-op. An operator who wants traces and
 * metrics registers an SDK in the server's own process, e.g. through
 * `NODE_OPTIONS=--import`, and these spans and instruments start exporting.
 */
export type ToolCallOutcome = "success" | "operational-error" | "unexpected-error";

/** One tool call's span, open until `end`. */
export interface ToolCallSpan {
  /** The span's trace id, or `undefined` when no SDK is recording. */
  readonly traceId: string | undefined;
  end(outcome: ToolCallOutcome, durationMs: number, error?: unknown): void;
}

/** The subset `server.ts` needs, so a test can inject a plain stub, mirroring `ServerLogger`. */
export interface ServerTelemetry {
  startToolCall(tool: string, ids: { sessionId: string; callId: string }): ToolCallSpan;
}

const INSTRUMENTATION_SCOPE = "raiminiscence-mcp";

/**
 * Instruments are created once, here, so the SDK must already be registered
 * when the server starts. An `--import` preload always is.
 */
export function createTelemetry(): ServerTelemetry {
  const tracer = trace.getTracer(INSTRUMENTATION_SCOPE);
  const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);
  const calls = meter.createCounter("raiminiscence.tool.calls", { description: "MCP tool calls, by tool and outcome." });
  const duration = meter.createHistogram("raiminiscence.tool.duration", { description: "MCP tool call duration.", unit: "ms" });

  return {
    startToolCall(tool, ids) {
      const span = tracer.startSpan(`tool ${tool}`, {
        attributes: { "raiminiscence.tool": tool, "raiminiscence.session_id": ids.sessionId, "raiminiscence.call_id": ids.callId },
      });
      const spanContext = span.spanContext();
      return {
        traceId: isSpanContextValid(spanContext) ? spanContext.traceId : undefined,
        end(outcome, durationMs, error) {
          span.setAttribute("raiminiscence.outcome", outcome);
          if (error === undefined) {
            span.setStatus({ code: SpanStatusCode.OK });
          } else {
            const exception = error instanceof Error ? error : new Error(String(error));
            span.recordException(exception);
            span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
          }
          span.end();
          const attributes = { "raiminiscence.tool": tool, "raiminiscence.outcome": outcome };
          calls.add(1, attributes);
          duration.record(durationMs, attributes);
        },
      };
    },
  };
}
