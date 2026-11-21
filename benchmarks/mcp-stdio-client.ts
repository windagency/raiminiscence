import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

export interface McpStdioClient {
  /** Calls one tool and resolves its first text block. Rejects on a tool error. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Closes the server's stdin, which ends its stdio transport, and kills it if it hasn't exited 5 s later. */
  close: () => Promise<void>;
}

interface JsonRpcReply {
  id?: number;
  result?: { isError?: boolean; content?: { type: string; text?: string }[] };
  error?: { message: string };
}

/**
 * A minimal MCP client over stdio, newline-delimited JSON-RPC, for driving
 * both systems' real MCP servers the way an agent does. Only `initialize`
 * and `tools/call`: the benchmarks need nothing else, and neither the root
 * nor `benchmarks/` depends on the MCP SDK.
 */
export async function startMcpStdioClient(command: string, args: string[], options: Pick<SpawnOptions, "cwd" | "env">): Promise<McpStdioClient> {
  const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map<number, { resolve: (reply: JsonRpcReply) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let exited = false;

  createInterface({ input: child.stdout! }).on("line", (line) => {
    let reply: JsonRpcReply;
    try {
      reply = JSON.parse(line) as JsonRpcReply;
    } catch {
      return;
    }
    if (reply.id === undefined) return;
    pending.get(reply.id)?.resolve(reply);
    pending.delete(reply.id);
  });
  child.once("exit", (code) => {
    exited = true;
    for (const { reject } of pending.values()) reject(new Error(`MCP server exited with code ${code} before it answered`));
    pending.clear();
  });

  const send = (message: object) => child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (method: string, params: object) =>
    new Promise<JsonRpcReply>((resolve, reject) => {
      if (exited) return reject(new Error("MCP server exited before the request"));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  const init = await request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "benchmark", version: "0" } });
  if (init.error) throw new Error(`initialize: ${init.error.message}`);
  send({ method: "notifications/initialized" });

  return {
    async callTool(name, toolArgs) {
      const reply = await request("tools/call", { name, arguments: toolArgs });
      const text = reply.result?.content?.find((block) => block.type === "text")?.text ?? "";
      if (reply.error || reply.result?.isError) throw new Error(`${name}: ${reply.error?.message ?? text}`);
      return text;
    },
    async close() {
      if (exited) return;
      const done = new Promise((resolve) => child.once("exit", resolve));
      child.stdin!.end();
      const timer = setTimeout(() => child.kill(), 5_000);
      await done;
      clearTimeout(timer);
    },
  };
}
