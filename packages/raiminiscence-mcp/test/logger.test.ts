import { describe, expect, it } from "vitest";
import { createLogDestination } from "#src/adapters/logger.js";

describe("raiminiscence-mcp logger", () => {
  it("writes to stderr (fd 2), never stdout (fd 1) — stdout is the MCP JSON-RPC transport", () => {
    // pino.destination() returns a SonicBoom; DestinationStream, its declared return type, has no fd.
    const destination = createLogDestination() as { fd?: number };
    expect(destination.fd).toBe(2);
  });
});
