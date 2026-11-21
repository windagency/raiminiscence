import { describe, expect, it } from "vitest";
import { classesImporting } from "./helpers.js";

const MCP_SRC = "packages/raiminiscence-mcp/src";

describe("raiminiscence-mcp architecture: domain/transport boundary", () => {
  it("core domain code never imports the MCP server entry point", () => {
    const importers = classesImporting(MCP_SRC, "raiminiscence-mcp/src/server.ts").filter((path) => path.includes("/core/"));
    expect(importers).toEqual([]);
  });

  it("core domain code never imports the package's own public index entry point", () => {
    const importers = classesImporting(MCP_SRC, "raiminiscence-mcp/src/index.ts").filter((path) => path.includes("/core/"));
    expect(importers).toEqual([]);
  });
});
