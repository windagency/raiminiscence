# Tool calls emit OpenTelemetry spans and metrics through the API alone; the operator registers the SDK

[Back to docs/adr/README.md](README.md) • [Back to lld.md](../architecture/lld.md)

`CODING_RULES/14-observability.md` requires logs, metrics and traces. The MCP server had structured pino logs with `sessionId`, `callId` and `durationMs` on every tool call, and neither metrics nor traces. It's a stdio process its client spawns, so it has no collector of its own to send to.

## Decision

`raiminiscence-mcp` depends on `@opentelemetry/api` only, wrapped by `src/adapters/telemetry.ts`, the one module allowed to import it (both third-party-containment architecture tests). For every tool call, `server.ts`'s `handle()`:

- starts a span named `tool <name>`, with `raiminiscence.tool`, `raiminiscence.session_id`, `raiminiscence.call_id` and, at the end, `raiminiscence.outcome` (`success`, `operational-error` or `unexpected-error`);
- on failure, records the exception on the span and sets an `ERROR` status, per `CODING_RULES/08-resilience.md`;
- increments the `raiminiscence.tool.calls` counter and records `raiminiscence.tool.duration` (ms), both keyed by tool and outcome;
- stamps the span's `traceId` on its log lines whenever an SDK is recording.

With no SDK registered, every call is a no-op and no `traceId` is logged. An operator who wants telemetry preloads an SDK into the server's own process, for example through `NODE_OPTIONS=--import <register script>` in the MCP client's server config, with an OTLP exporter. Instruments are created at server start, so the SDK must be registered before then; a preload always is.

The dependency is pinned `~1.9.1`: the current SDK 2.x line peers on `@opentelemetry/api <1.10`.

## Considered options

- **An ADR recording a scope cut, logs only.** Rejected by the operator.
- **Bundle the Node SDK and an OTLP exporter, enabled by `OTEL_*` variables.** Rejected: a heavy dependency tree in every install for a feature most users never turn on.

## Consequences

- Never configure a console exporter: it writes to stdout, which is the MCP JSON-RPC channel.
- Only tool calls are traced. The hooks and the inspect CLI are short-lived processes and keep their structured stderr logs only. Nested spans inside a tool call would need an SDK context manager and are not added.
- `@opentelemetry/sdk-trace-base` and `@opentelemetry/sdk-metrics` are root dev dependencies, used only by `test/telemetry.test.ts`.
