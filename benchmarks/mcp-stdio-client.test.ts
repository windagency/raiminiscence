import { describe, expect, it } from "vitest";
import { startMcpStdioClient } from "./mcp-stdio-client.js";

/** A fake MCP server: answers `initialize`, then echoes each `tools/call`'s name and arguments back as its text. */
const FAKE_SERVER = `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  const result = msg.method === "initialize"
    ? { protocolVersion: msg.params.protocolVersion, capabilities: {}, serverInfo: { name: "fake", version: "0" } }
    : msg.params.name === "fail"
      ? { isError: true, content: [{ type: "text", text: "nope" }] }
      : { content: [{ type: "text", text: JSON.stringify(msg.params) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
});
`;

describe("startMcpStdioClient", () => {
  it("initializes, then returns each tool call's text", async () => {
    const client = await startMcpStdioClient("node", ["-e", FAKE_SERVER], { cwd: process.cwd() });
    try {
      expect(await client.callTool("remember", { content: "a" })).toBe(JSON.stringify({ name: "remember", arguments: { content: "a" } }));
      expect(await client.callTool("recall", { query: "b" })).toBe(JSON.stringify({ name: "recall", arguments: { query: "b" } }));
    } finally {
      await client.close();
    }
  });

  it("rejects a tool call the server reports as an error", async () => {
    const client = await startMcpStdioClient("node", ["-e", FAKE_SERVER], { cwd: process.cwd() });
    try {
      await expect(client.callTool("fail", {})).rejects.toThrow("fail: nope");
    } finally {
      await client.close();
    }
  });

  it("rejects when the server exits before it answers", async () => {
    await expect(startMcpStdioClient("node", ["-e", "process.exit(3)"], { cwd: process.cwd() })).rejects.toThrow("exited");
  });
});
