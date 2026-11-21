import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider, EmbeddingProviderIdentity, EmbedRole } from "#src/core/embeddings/provider.js";
import {
  createWarmEmbeddingProvider,
  startWarmEmbedServer,
  warmEmbedEnabled,
  warmEmbedSocketPath,
  type WarmEmbedServer,
} from "#src/core/embeddings/warm-embed.js";

const IDENTITY = { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" };
const isWindows = process.platform === "win32";

/** A provider that records each call and answers with a fixed vector. */
function recordingProvider(
  vector: number[] | null,
  identity: EmbeddingProviderIdentity = IDENTITY,
): EmbeddingProvider & { calls: string[]; roles: string[] } {
  const calls: string[] = [];
  const roles: string[] = [];
  return {
    identity,
    calls,
    roles,
    async embed(text: string, role: EmbedRole) {
      calls.push(text);
      roles.push(role);
      return vector;
    },
  };
}

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

describe.skipIf(isWindows)("warm Embedded model (ADR-0038)", () => {
  let dir: string;
  let socketPath: string;
  const servers: { close(): unknown }[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rai-warm-"));
    socketPath = join(dir, "e.sock");
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function serve(provider: EmbeddingProvider, path = socketPath): Promise<WarmEmbedServer | undefined> {
    const server = await startWarmEmbedServer(provider, path);
    if (server) servers.push(server);
    return server;
  }

  it("uses the running server's vector and never embeds locally", async () => {
    await serve(recordingProvider([0.6, 0.8]));
    const local = recordingProvider([1, 0]);

    const vector = await createWarmEmbeddingProvider(local, socketPath).embed("kafka consumer lag", "query");

    expect(vector).toEqual([0.6, 0.8]);
    expect(local.calls).toEqual([]);
  });

  it("passes the caller's role to the server (ADR-0042)", async () => {
    const server = recordingProvider([0.6, 0.8]);
    await serve(server);

    await createWarmEmbeddingProvider(recordingProvider([1, 0]), socketPath).embed("a decision", "document");

    expect(server.roles.at(-1)).toBe("document");
  });

  it("embeds locally when the server's prompt scheme differs from the caller's (ADR-0042)", async () => {
    await serve(recordingProvider([0.6, 0.8], { ...IDENTITY, prompt: "nomic-task-prefix" }));
    const local = recordingProvider([1, 0]);

    expect(await createWarmEmbeddingProvider(local, socketPath).embed("q", "query")).toEqual([1, 0]);
  });

  it("uses a server whose prompt scheme matches the caller's (ADR-0042)", async () => {
    const prefixed = { ...IDENTITY, prompt: "nomic-task-prefix" };
    await serve(recordingProvider([0.6, 0.8], prefixed));

    expect(await createWarmEmbeddingProvider(recordingProvider([1, 0], prefixed), socketPath).embed("q", "query")).toEqual([0.6, 0.8]);
  });

  it("keeps the local provider's identity", () => {
    expect(createWarmEmbeddingProvider(recordingProvider([1, 0]), socketPath).identity).toEqual(IDENTITY);
  });

  it("embeds locally when no server is listening", async () => {
    const local = recordingProvider([1, 0]);

    expect(await createWarmEmbeddingProvider(local, socketPath).embed("q", "query")).toEqual([1, 0]);
    expect(local.calls).toEqual(["q"]);
  });

  it("embeds locally when the server's model differs from the caller's", async () => {
    await serve(recordingProvider([0.6, 0.8], { provider: "embedded", model: "other/model" }));
    const local = recordingProvider([1, 0]);

    expect(await createWarmEmbeddingProvider(local, socketPath).embed("q", "query")).toEqual([1, 0]);
  });

  it("embeds locally when the server has no vector to give", async () => {
    await serve(recordingProvider(null));
    const local = recordingProvider([1, 0]);

    expect(await createWarmEmbeddingProvider(local, socketPath).embed("q", "query")).toEqual([1, 0]);
  });

  it.each([
    ["not JSON", "garbage\n"],
    ["an empty vector", JSON.stringify({ identity: IDENTITY, vector: [] }) + "\n"],
    ["a non-numeric vector", JSON.stringify({ identity: IDENTITY, vector: ["a"] }) + "\n"],
  ])("embeds locally when the reply is %s", async (_label, reply) => {
    servers.push(await rawServer(socketPath, reply));
    const local = recordingProvider([1, 0]);

    expect(await createWarmEmbeddingProvider(local, socketPath).embed("q", "query")).toEqual([1, 0]);
  });

  it("embeds locally once the server misses its time budget", async () => {
    servers.push(await rawServer(socketPath, null));
    const local = recordingProvider([1, 0]);
    const start = Date.now();

    expect(await createWarmEmbeddingProvider(local, socketPath, 50).embed("q", "query")).toEqual([1, 0]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("loads the server's model as soon as it starts", async () => {
    const provider = recordingProvider([0.6, 0.8]);
    await serve(provider);

    expect(provider.calls).toHaveLength(1);
  });

  it("leaves a live socket to the server that owns it", async () => {
    await serve(recordingProvider([0.6, 0.8]));

    expect(await serve(recordingProvider([0, 1]))).toBeUndefined();
    expect(await createWarmEmbeddingProvider(recordingProvider([1, 0]), socketPath).embed("q", "query")).toEqual([0.6, 0.8]);
  });

  it("replaces a socket file that no server is behind", async () => {
    writeFileSync(socketPath, "");

    expect(await serve(recordingProvider([0.6, 0.8]))).toBeDefined();
    expect(await createWarmEmbeddingProvider(recordingProvider([1, 0]), socketPath).embed("q", "query")).toEqual([0.6, 0.8]);
  });

  it("removes its socket when it closes", async () => {
    const server = await serve(recordingProvider([0.6, 0.8]));
    await server!.close();

    expect(existsSync(socketPath)).toBe(false);
  });

  it("knows it no longer owns its socket once another server replaces the file", async () => {
    const first = await serve(recordingProvider([0.6, 0.8]));
    rmSync(socketPath);
    await serve(recordingProvider([0, 1]));

    expect(first!.owned()).toBe(false);
  });

  it("leaves another server's socket in place when it closes after being replaced", async () => {
    const first = await serve(recordingProvider([0.6, 0.8]));
    rmSync(socketPath);
    await serve(recordingProvider([0, 1]));
    await first!.close();

    expect(await createWarmEmbeddingProvider(recordingProvider([1, 0]), socketPath).embed("q", "query")).toEqual([0, 1]);
  });

  it("creates the socket's directory readable by its owner only", async () => {
    const nested = join(dir, "run", "e.sock");
    await serve(recordingProvider([0.6, 0.8]), nested);

    expect(statSync(join(dir, "run")).mode & 0o777).toBe(0o700);
  });
});

describe("warmEmbedSocketPath (ADR-0038)", () => {
  it("lives under the user's .raiminiscence/run directory", () => {
    const path = warmEmbedSocketPath(IDENTITY, "/home/u");
    expect(dirname(path)).toBe(join("/home/u", ".raiminiscence", "run"));
    expect(basename(path)).toMatch(/^embed-[0-9a-f]+\.sock$/);
  });

  it("is the same for the same model and differs for another", () => {
    const path = warmEmbedSocketPath(IDENTITY, "/home/u");
    expect(warmEmbedSocketPath({ ...IDENTITY }, "/home/u")).toBe(path);
    expect(warmEmbedSocketPath({ ...IDENTITY, model: "other/model" }, "/home/u")).not.toBe(path);
    expect(warmEmbedSocketPath({ ...IDENTITY, prompt: "nomic-task-prefix" }, "/home/u")).not.toBe(path);
  });
});

describe("warmEmbedEnabled (ADR-0038)", () => {
  it("is on by default", () => {
    expect(warmEmbedEnabled({}, "darwin")).toBe(true);
  });

  it("is off when RAIMINISCENCE_WARM_EMBED is off", () => {
    expect(warmEmbedEnabled({ RAIMINISCENCE_WARM_EMBED: "off" }, "linux")).toBe(false);
  });

  it("is off on Windows", () => {
    expect(warmEmbedEnabled({}, "win32")).toBe(false);
  });
});

describe.skipIf(isWindows)("defaultProvider and a running server (ADR-0038)", () => {
  let home: string;
  let projectDir: string;
  let originalCwd: string;
  let server: WarmEmbedServer | undefined;

  beforeEach(() => {
    // A Unix socket path is capped near 104 bytes; macOS's per-user tmpdir is too deep for a home.
    home = mkdtempSync("/tmp/rai-home-");
    projectDir = mkdtempSync(join(tmpdir(), "rai-proj-"));
    originalCwd = process.cwd();
    process.chdir(projectDir);
    vi.stubEnv("HOME", home);
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "");
    vi.resetModules();
  });

  afterEach(async () => {
    await server?.close();
    vi.unstubAllEnvs();
    process.chdir(originalCwd);
    rmSync(home, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("gets the default Embedded model's vectors from the server, while the local model is stubbed out", async () => {
    const { defaultProvider } = await import("#src/core/embeddings/default-provider.js");
    const warm = await import("#src/core/embeddings/warm-embed.js");
    const identity = defaultProvider().identity;
    server = await warm.startWarmEmbedServer(recordingProvider([0.6, 0.8], identity), warm.warmEmbedSocketPath(identity));

    expect(await defaultProvider().embed("q", "query")).toEqual([0.6, 0.8]);
  });

  it("serves an Embedded Provider's model at its socket path, and never an Ollama one", async () => {
    const { serveWarmModel } = await import("#src/core/embeddings/default-provider.js");
    const warm = await import("#src/core/embeddings/warm-embed.js");
    const ollama = recordingProvider([0, 1], { provider: "ollama", model: "nomic-embed-text" });

    expect(await serveWarmModel(ollama)).toBeUndefined();
    const served = await serveWarmModel(recordingProvider([0.6, 0.8]));
    server = served;
    expect(served?.socketPath).toBe(warm.warmEmbedSocketPath(IDENTITY));
    expect(await warm.createWarmEmbeddingProvider(recordingProvider([1, 0]), warm.warmEmbedSocketPath(IDENTITY)).embed("q", "query")).toEqual([
      0.6, 0.8,
    ]);
  });

  it("never asks a server when RAIMINISCENCE_WARM_EMBED is off", async () => {
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "off");
    const { defaultProvider } = await import("#src/core/embeddings/default-provider.js");
    const warm = await import("#src/core/embeddings/warm-embed.js");
    const identity = defaultProvider().identity;
    server = await warm.startWarmEmbedServer(recordingProvider([0.6, 0.8], identity), warm.warmEmbedSocketPath(identity));

    expect(await defaultProvider().embed("q", "query")).toBeNull();
  });
});
