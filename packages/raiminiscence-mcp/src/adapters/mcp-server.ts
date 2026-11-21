import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * The one module allowed to import `@modelcontextprotocol/sdk`
 * (CONTRIBUTING.md's adapter non-negotiable). `server.ts` builds its tools on
 * the SDK's own `McpServer` rather than an owned interface: `registerTool`'s
 * input-schema typing is the SDK's contract, and wrapping it one for one
 * would only rename it, the same reasoning ADR-0027 applies to Zod.
 */
export { McpServer };

export function createMcpServer(name: string, version: string): McpServer {
  return new McpServer({ name, version });
}

/** The name the connected client gave in its MCP handshake, if it has completed one. */
export function connectedClientName(server: McpServer): string | undefined {
  return server.server.getClientVersion()?.name;
}

/** Serves `server` over this process's stdin/stdout, the only transport this project ships (ADR-0003). */
export async function serveOverStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
