import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { AggregationTemporality, MeterProvider, MetricReader, type DataPoint, type Histogram } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTelemetry, type ServerTelemetry } from "#src/adapters/telemetry.js";

class CollectingReader extends MetricReader {
  constructor() {
    super({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
  }
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

/**
 * Integration test against the real OpenTelemetry SDK, registered globally the
 * way an operator's `NODE_OPTIONS=--import ...` preload would register it.
 */
describe("createTelemetry (OpenTelemetry adapter)", () => {
  const spanExporter = new InMemorySpanExporter();
  const reader = new CollectingReader();
  let telemetry: ServerTelemetry;

  beforeAll(() => {
    trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }));
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    telemetry = createTelemetry();
  });

  afterAll(() => {
    trace.disable();
    metrics.disable();
  });

  beforeEach(() => spanExporter.reset());

  async function collectedMetric(name: string) {
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics).find((metric) => metric.descriptor.name === name);
  }

  it("records a successful tool call as one span with its ids and an OK status", () => {
    const span = telemetry.startToolCall("recall", { sessionId: "s1", callId: "c1" });
    span.end("success", 12);

    const [finished] = spanExporter.getFinishedSpans();
    expect(finished!.name).toBe("tool recall");
    expect(finished!.attributes).toMatchObject({
      "raiminiscence.tool": "recall",
      "raiminiscence.session_id": "s1",
      "raiminiscence.call_id": "c1",
      "raiminiscence.outcome": "success",
    });
    expect(finished!.status.code).toBe(SpanStatusCode.OK);
    expect(span.traceId).toBe(finished!.spanContext().traceId);
  });

  it("records a failed tool call's exception on its span with an ERROR status", () => {
    telemetry.startToolCall("remember", { sessionId: "s1", callId: "c2" }).end("unexpected-error", 3, new Error("disk full"));

    const [finished] = spanExporter.getFinishedSpans();
    expect(finished!.status).toEqual({ code: SpanStatusCode.ERROR, message: "disk full" });
    expect(finished!.events.map((event) => event.name)).toEqual(["exception"]);
    expect(finished!.attributes["raiminiscence.outcome"]).toBe("unexpected-error");
  });

  it("counts tool calls by tool and outcome", async () => {
    telemetry.startToolCall("forget", { sessionId: "s1", callId: "c3" }).end("operational-error", 1, new Error("no such memory"));

    const calls = await collectedMetric("raiminiscence.tool.calls");
    const point = calls!.dataPoints.find((p) => p.attributes["raiminiscence.tool"] === "forget");
    expect(point).toMatchObject({ attributes: { "raiminiscence.tool": "forget", "raiminiscence.outcome": "operational-error" }, value: 1 });
  });

  it("records each tool call's duration in a histogram", async () => {
    telemetry.startToolCall("overview", { sessionId: "s1", callId: "c4" }).end("success", 40);

    const duration = await collectedMetric("raiminiscence.tool.duration");
    expect(duration!.descriptor.unit).toBe("ms");
    const point = duration!.dataPoints.find((p) => p.attributes["raiminiscence.tool"] === "overview") as DataPoint<Histogram>;
    expect(point.value.sum).toBe(40);
  });
});

describe("createTelemetry with no SDK registered", () => {
  it("is a no-op that reports no trace id", () => {
    const span = createTelemetry().startToolCall("recall", { sessionId: "s1", callId: "c1" });
    expect(span.traceId).toBeUndefined();
    expect(() => span.end("success", 1)).not.toThrow();
  });
});
