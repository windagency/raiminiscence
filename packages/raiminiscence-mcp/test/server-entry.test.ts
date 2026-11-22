import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "#src/core/package-version.js";

const SERVER_PATH = fileURLToPath(new URL("../dist/server.js", import.meta.url));

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "entry-test", version: "0" } },
};

/**
 * Sends `initialize` to the server started from `entry` and resolves its reply, or null if it never
 * answered. Resolves only once the server has exited: Windows keeps its working directory locked until then.
 */
function initializeVia(entry: string, cwd: string): Promise<{ serverInfo: { name: string; version: string } } | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], { cwd, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "";
    let reply: { serverInfo: { name: string; version: string } } | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split("\n").find((candidate) => candidate.includes('"id":1'));
      if (line && !reply) {
        reply = (JSON.parse(line) as { result: { serverInfo: { name: string; version: string } } }).result;
        child.kill();
      }
    });
    child.on("exit", () => resolve(reply));
    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  });
}

/**
 * npx and every MCP client config start the server through node_modules/.bin, a symlink to
 * dist/server.js. 1.0.0 compared import.meta.url with that symlink path, so the server exited
 * without answering.
 */
describe("the raiminiscence-mcp entry point", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "raiminiscence-entry-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it.skipIf(process.platform === "win32")(
    "answers initialize when started through a symlink, as node_modules/.bin does",
    async () => {
      const link = join(dir, "raiminiscence-mcp");
      symlinkSync(SERVER_PATH, link);

      expect(await initializeVia(link, dir)).toMatchObject({ serverInfo: { name: "raiminiscence-mcp" } });
    },
    30_000,
  );

  it("reports its own package version", async () => {
    expect(await initializeVia(SERVER_PATH, dir)).toMatchObject({ serverInfo: { version: PACKAGE_VERSION } });
  }, 30_000);
});
