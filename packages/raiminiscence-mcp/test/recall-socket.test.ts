import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createServer as createNetServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProviderIdentity } from "#src/core/embeddings/provider.js";
import type { RecallResultItem } from "#src/core/recall.js";
import { recallSocketPath, requestServedRecall, startRecallServer, type RecallServer } from "#src/core/recall-socket.js";

const IDENTITY = { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" };
const VERSION = "1.2.3";
const isWindows = process.platform === "win32";

const ITEM: RecallResultItem = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  kind: "decision",
  confidence: "verified",
  scope: "project",
  source: { client: "claude-code" },
  summary: "Postgres chosen for write model",
  detail: "Postgres chosen for write model over the alternatives considered.",
  score: 0.9,
  strength: 0.9,
  surfacedVia: "match",
  conflictCandidateWith: ["01ARZ3NDEKTSV4RRFFQ69G5FAX"],
};

/** A bare socket server that answers every connection with `reply`, or never answers when it is null. */
async function rawServer(socketPath: string, reply: string | null): Promise<Server> {
  const server = createNetServer((socket) => {
    socket.on("data", () => {
      if (reply !== null) socket.end(reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return server;
}

describe.skipIf(isWindows)("whole recall over a local socket (ADR-0039)", () => {
  let dir: string;
  let socketPath: string;
  let storageRoot: string;
  let calls: { query: string; k: number }[];
  let clientPackages: (string | null)[];
  const servers: { close(): unknown }[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rai-recall-"));
    socketPath = join(dir, "r.sock");
    storageRoot = join(dir, "project");
    calls = [];
    clientPackages = [];
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function serve(results: RecallResultItem[] = [ITEM], overrides: { identity?: EmbeddingProviderIdentity; packageVersion?: string } = {}) {
    const server: RecallServer | undefined = await startRecallServer(
      {
        storageRoot,
        identity: overrides.identity ?? IDENTITY,
        packageVersion: overrides.packageVersion ?? VERSION,
        recall: async (params) => {
          calls.push(params);
          return results;
        },
        onRequest: (clientPackage) => clientPackages.push(clientPackage),
      },
      socketPath,
    );
    if (server) servers.push(server);
    return server;
  }

  function ask(overrides: Partial<Parameters<typeof requestServedRecall>[0]> = {}) {
    return requestServedRecall({
      socketPath,
      storageRoot,
      identity: IDENTITY,
      packageVersion: VERSION,
      query: "kafka consumer lag",
      k: 10,
      ...overrides,
    });
  }

  it("returns the server's recall results for the same storage root", async () => {
    await serve();

    expect(await ask()).toEqual([ITEM]);
    expect(calls).toEqual([{ query: "kafka consumer lag", k: 10 }]);
  });

  it("refuses a request for another storage root", async () => {
    await serve();

    expect(await ask({ storageRoot: join(dir, "elsewhere") })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns null when no server is listening", async () => {
    expect(await ask()).toBeNull();
  });

  it("returns null when the server runs another package version", async () => {
    await serve([ITEM], { packageVersion: "1.2.4" });

    expect(await ask()).toBeNull();
  });

  it("returns null when the server's model differs from the caller's", async () => {
    await serve([ITEM], { identity: { provider: "embedded", model: "other/model" } });

    expect(await ask()).toBeNull();
  });

  it("returns null when the server's prompt scheme differs from the caller's (ADR-0042)", async () => {
    await serve([ITEM], { identity: { ...IDENTITY, prompt: "nomic-task-prefix" } });

    expect(await ask()).toBeNull();
  });

  it.each([
    ["not JSON", "garbage\n"],
    ["another protocol version", JSON.stringify({ v: 2, package: VERSION, identity: IDENTITY, results: [ITEM] }) + "\n"],
    [
      "a result missing its summary",
      JSON.stringify({ v: 1, package: VERSION, identity: IDENTITY, results: [{ ...ITEM, summary: undefined }] }) + "\n",
    ],
    ["a result of an unknown kind", JSON.stringify({ v: 1, package: VERSION, identity: IDENTITY, results: [{ ...ITEM, kind: "rumour" }] }) + "\n"],
  ])("returns null when the reply is %s", async (_label, reply) => {
    servers.push(await rawServer(socketPath, reply));

    expect(await ask()).toBeNull();
  });

  it("returns null once the server misses its time budget", async () => {
    servers.push(await rawServer(socketPath, null));
    const start = Date.now();

    expect(await ask({ timeoutMs: 50 })).toBeNull();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("returns null when the server's recall throws", async () => {
    servers.push(
      (await startRecallServer(
        {
          storageRoot,
          identity: IDENTITY,
          packageVersion: VERSION,
          recall: async () => {
            throw new Error("boom");
          },
        },
        socketPath,
      ))!,
    );

    expect(await ask()).toBeNull();
  });

  it("treats a symlinked storage root as the real directory it points to", async () => {
    mkdirSync(storageRoot);
    const link = join(dir, "link");
    symlinkSync(storageRoot, link);
    await serve();

    expect(await ask({ storageRoot: link })).toEqual([ITEM]);
  });

  it("tells the server which package version each request came from", async () => {
    await serve();
    await ask({ packageVersion: "9.9.9" });

    expect(clientPackages).toEqual(["9.9.9"]);
  });

  it("leaves a live socket to the server that owns it", async () => {
    await serve();

    expect(await serve([])).toBeUndefined();
    expect(await ask()).toEqual([ITEM]);
  });
});

describe("recallSocketPath (ADR-0039)", () => {
  it("lives under the user's .raiminiscence/run directory", () => {
    const path = recallSocketPath("/work/project", IDENTITY, "/home/u");
    expect(dirname(path)).toBe(join("/home/u", ".raiminiscence", "run"));
    expect(basename(path)).toMatch(/^recall-[0-9a-f]+\.sock$/);
  });

  it("is the same for a symlink and the directory it points to", () => {
    const dir = mkdtempSync(join(tmpdir(), "rai-recall-path-"));
    const link = join(dir, "link");
    symlinkSync(dir, link);

    expect(recallSocketPath(link, IDENTITY, "/home/u")).toBe(recallSocketPath(realpathSync(dir), IDENTITY, "/home/u"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("differs per storage root and per model", () => {
    const path = recallSocketPath("/work/project", IDENTITY, "/home/u");
    expect(recallSocketPath("/work/project", { ...IDENTITY }, "/home/u")).toBe(path);
    expect(recallSocketPath("/work/other", IDENTITY, "/home/u")).not.toBe(path);
    expect(recallSocketPath("/work/project", { ...IDENTITY, model: "other/model" }, "/home/u")).not.toBe(path);
    expect(recallSocketPath("/work/project", { ...IDENTITY, prompt: "nomic-task-prefix" }, "/home/u")).not.toBe(path);
  });
});
