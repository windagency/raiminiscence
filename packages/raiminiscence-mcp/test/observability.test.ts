import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "#src/server.js";
import type { ServerLogger } from "#src/adapters/logger.js";
import type { ServerTelemetry, ToolCallOutcome } from "#src/adapters/telemetry.js";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";

interface StubLogCall {
  level: "debug" | "info" | "warn" | "error";
  fields: Record<string, unknown>;
  msg?: string;
}

function createStubLogger(): { logger: ServerLogger; calls: StubLogCall[] } {
  const calls: StubLogCall[] = [];
  const logger: ServerLogger = {
    debug: (fields, msg) => calls.push({ level: "debug", fields, msg }),
    info: (fields, msg) => calls.push({ level: "info", fields, msg }),
    warn: (fields, msg) => calls.push({ level: "warn", fields, msg }),
    error: (fields, msg) => calls.push({ level: "error", fields, msg }),
  };
  return { logger, calls };
}

interface StubToolCall {
  tool: string;
  attributes: { sessionId: string; callId: string };
  ended?: { outcome: ToolCallOutcome; durationMs: number; error?: unknown };
}

const STUB_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

function createStubTelemetry(): { telemetry: ServerTelemetry; toolCalls: StubToolCall[] } {
  const toolCalls: StubToolCall[] = [];
  const telemetry: ServerTelemetry = {
    startToolCall(tool, attributes) {
      const call: StubToolCall = { tool, attributes };
      toolCalls.push(call);
      return {
        traceId: STUB_TRACE_ID,
        end: (outcome, durationMs, error) => {
          call.ended = { outcome, durationMs, error };
        },
      };
    },
  };
  return { telemetry, toolCalls };
}

async function connectedClient(logger: ServerLogger, embeddingProvider?: EmbeddingProvider, telemetry?: ServerTelemetry) {
  const server = createServer({ logger, embeddingProvider, telemetry });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("MCP server observability: handle()'s logging and operational/unexpected error split", () => {
  let storageRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-observability-"));
    originalCwd = process.cwd();
    process.chdir(storageRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("a successful call logs a start and end line, both at info, sharing the same callId", async () => {
    const { logger, calls } = createStubLogger();
    const client = await connectedClient(logger);

    const result = await client.callTool({ name: "overview", arguments: {} });
    expect(result.isError).toBeFalsy();

    // Both lines log at `info` (not "started" at `debug`) so a hung call — a
    // start with no matching end — is visible at the server's default log
    // level, per the observability spec's hang-visibility user story.
    const started = calls.find((c) => c.level === "info" && c.fields.tool === "overview" && c.msg === "tool call started");
    const finished = calls.find((c) => c.level === "info" && c.fields.tool === "overview" && c.msg === "tool call finished");
    expect(started).toBeDefined();
    expect(finished).toBeDefined();
    expect(started?.fields.callId).toBe(finished?.fields.callId);
    expect(typeof finished?.fields.durationMs).toBe("number");
  });

  it("an OperationalError returns its own message to the client verbatim and logs at warn, not error", async () => {
    const { logger, calls } = createStubLogger();
    const client = await connectedClient(logger);

    // `inspect` with none of id/query/list set is exactly the deliberate,
    // expected validation failure `OperationalError` exists for.
    const result = await client.callTool({ name: "inspect", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/exactly one/);

    const warnCall = calls.find((c) => c.level === "warn" && c.fields.tool === "inspect");
    expect(warnCall).toBeDefined();
    expect(warnCall?.fields.error).toMatch(/exactly one/);
    expect(calls.some((c) => c.level === "error" && c.fields.tool === "inspect")).toBe(false);
  });

  it("any other thrown value logs at error with full detail, and returns only a generic message plus the callId to the client", async () => {
    const { logger, calls } = createStubLogger();
    // Deliberately violates `EmbeddingProvider.embed`'s "never throws"
    // contract, standing in for a genuine bug/infrastructure failure —
    // exactly the class of error `handle()`'s unexpected-error path exists
    // to catch and mask from the client.
    const buggyProvider: EmbeddingProvider = {
      identity: { provider: "stub", model: "stub" },
      async embed(): Promise<number[] | null> {
        throw new Error("boom: unexpected embedding failure");
      },
    };
    const client = await connectedClient(logger, buggyProvider);

    // `recall` embeds its query before it answers; `remember` no longer waits for its embed (ADR-0041).
    const result = await client.callTool({ name: "recall", arguments: { query: "a query that will fail to embed" } });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]!.text;
    expect(text).not.toContain("boom");
    expect(text).toMatch(/Internal error/);

    const errorCall = calls.find((c) => c.level === "error" && c.fields.tool === "recall");
    expect(errorCall).toBeDefined();
    expect(errorCall?.fields.error).toBe("boom: unexpected embedding failure");
    expect(errorCall?.fields.stack).toContain("boom: unexpected embedding failure");

    const callIdInMessage = text.match(/Internal error \(([^)]+)\)/)?.[1];
    expect(callIdInMessage).toBe(errorCall?.fields.callId);
  });

  it("traces a successful call as one span ended with outcome success, and stamps its traceId on both log lines", async () => {
    const { logger, calls } = createStubLogger();
    const { telemetry, toolCalls } = createStubTelemetry();
    const client = await connectedClient(logger, undefined, telemetry);

    await client.callTool({ name: "overview", arguments: {} });

    const call = toolCalls.find((c) => c.tool === "overview");
    expect(call?.ended?.outcome).toBe("success");
    expect(typeof call?.ended?.durationMs).toBe("number");
    const lines = calls.filter((c) => c.fields.tool === "overview");
    expect(lines.map((c) => c.fields.traceId)).toEqual([STUB_TRACE_ID, STUB_TRACE_ID]);
    expect(lines[0]?.fields.callId).toBe(call?.attributes.callId);
  });

  it("ends an OperationalError's span with outcome operational-error and the error itself", async () => {
    const { logger } = createStubLogger();
    const { telemetry, toolCalls } = createStubTelemetry();
    const client = await connectedClient(logger, undefined, telemetry);

    await client.callTool({ name: "inspect", arguments: {} });

    const ended = toolCalls.find((c) => c.tool === "inspect")?.ended;
    expect(ended?.outcome).toBe("operational-error");
    expect((ended?.error as Error).message).toMatch(/exactly one/);
  });

  it("ends an unexpected failure's span with outcome unexpected-error and the error itself", async () => {
    const { logger, calls } = createStubLogger();
    const { telemetry, toolCalls } = createStubTelemetry();
    const buggyProvider: EmbeddingProvider = {
      identity: { provider: "stub", model: "stub" },
      async embed(): Promise<number[] | null> {
        throw new Error("boom");
      },
    };
    const client = await connectedClient(logger, buggyProvider, telemetry);

    await client.callTool({ name: "recall", arguments: { query: "fails to embed" } });

    const ended = toolCalls.find((c) => c.tool === "recall")?.ended;
    expect(ended?.outcome).toBe("unexpected-error");
    expect((ended?.error as Error).message).toBe("boom");
    expect(calls.find((c) => c.level === "error")?.fields.traceId).toBe(STUB_TRACE_ID);
  });
});
