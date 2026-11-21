import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { remember, recall } from "../../packages/raiminiscence-mcp/src/core/engine.js";
import { requestLine } from "../../packages/raiminiscence-mcp/src/core/adapters/local-socket.js";
import { warmEmbedSocketPath } from "../../packages/raiminiscence-mcp/src/core/embeddings/warm-embed.js";
import { parseWarmEmbedReply } from "../../packages/raiminiscence-mcp/src/core/embeddings/warm-embed-schema.js";
import { PACKAGE_VERSION } from "../../packages/raiminiscence-mcp/src/core/package-version.js";
import { recallSocketPath, requestServedRecall } from "../../packages/raiminiscence-mcp/src/core/recall-socket.js";
import { embeddedEmbeddingProvider } from "./embedded-embedding-provider.js";
import { promptRecallText } from "../../packages/raiminiscence-hooks/src/prompt-recall.js";
import { resolveEmbeddingProvider } from "./embedding-provider.js";
import { generateSyntheticMemories } from "../corpus/synthetic-memories.js";
import { withTempDir } from "../temp-dir.js";

const embeddingProvider = resolveEmbeddingProvider();

export interface LatencyMeasurement {
  storeSize: number;
  medianLatencyMs: number;
  latenciesMs: number[];
  outputChars: number;
  /** chars/4 — a rough, documented estimate, not a real tokenizer count. */
  outputApproxTokens: number;
}

const REPS = 5;
const SAMPLE_PROMPT = "How does authentication work in this codebase?";

/**
 * Real built entrypoint of the actual `raiminiscence-hooks-shim` binary
 * (`packages/raiminiscence-hooks/src/shim.ts`) — the same binary Claude
 * Code/Codex invoke as a subprocess for every `UserPromptSubmit` hook in
 * real usage. Used by `runRaiminiscenceShimLatencyBenchmark` below for a
 * fair, process-to-process comparison against hippo-memory's own real CLI
 * subprocess invocation (see hippo-memory-runner/latency-runner.ts) — the
 * in-process `runRaiminiscenceLatencyBenchmark` above measures pure
 * recall-computation cost only, excluding this subprocess's own Node
 * startup overhead, which the shim (like hippo's CLI) pays in real usage.
 */
const SHIM_PATH = join(import.meta.dirname, "..", "..", "packages", "raiminiscence-hooks", "dist", "shim.js");

/** Real built entrypoint of the MCP server, started for the server-running shim pass (ADR-0038). */
const SERVER_PATH = join(import.meta.dirname, "..", "..", "packages", "raiminiscence-mcp", "dist", "server.js");

/** How long a started server gets to listen and load its model before the pass fails. */
const SERVER_READY_TIMEOUT_MS = 60_000;

/** Times `call` REPS times after one untimed warm-up call, and reports the median and the last output. */
async function measureLatency(storeSize: number, call: () => string | Promise<string>): Promise<LatencyMeasurement> {
  await call();

  const latenciesMs: number[] = [];
  let lastOutput = "";
  for (let i = 0; i < REPS; i++) {
    const start = performance.now();
    lastOutput = await call();
    latenciesMs.push(performance.now() - start);
  }
  latenciesMs.sort((a, b) => a - b);
  const medianLatencyMs = latenciesMs[Math.floor(latenciesMs.length / 2)]!;

  return {
    storeSize,
    medianLatencyMs,
    latenciesMs,
    outputChars: lastOutput.length,
    outputApproxTokens: Math.round(lastOutput.length / 4),
  };
}

/**
 * Measures the real v10 per-turn auto-recall path (`promptRecallText`, the
 * exact function `UserPromptSubmit` calls — see
 * packages/raiminiscence-hooks/src/prompt-recall.ts) at increasing store
 * sizes, to answer the open question hippo-memory-comparison.md §3.8 flagged:
 * whether an uncapped `recall()` call needs a latency/token budget as a
 * project's memory store grows. One fresh, isolated temp storageRoot per
 * size (never reused, never shared with the hippo-memory runner), mirroring
 * recall-runner.ts's isolation convention.
 *
 * A warm-up call (excluded from measurement) runs first at each size: v10's
 * real per-turn cost in a live session is the steady-state cost after
 * Ollama's embedding model is already loaded, not a one-time cold-start cost.
 */
export async function runRaiminiscenceLatencyBenchmark(storeSizes: number[]): Promise<LatencyMeasurement[]> {
  const results: LatencyMeasurement[] = [];

  const recallFn = (params: { storageRoot: string; query: string; triggerConsolidation: boolean }) => recall({ ...params, embeddingProvider });

  for (const size of storeSizes) {
    const measurement = await withTempDir(`raiminiscence-bench-latency-${size}-`, async (storageRoot) => {
      const memories = generateSyntheticMemories(size);
      for (const memory of memories) {
        await remember({
          content: memory.content,
          kind: memory.kind,
          client: "benchmark",
          storageRoot,
          embeddingProvider,
          triggerConsolidation: false,
        });
      }

      // In-process recall only: no running server answers this measurement (ADR-0039), and no warm process starts (ADR-0040).
      return measureLatency(size, () =>
        promptRecallText({ storageRoot, prompt: SAMPLE_PROMPT, servedRecallFn: async () => null, startWarmFn: () => false, recallFn }),
      );
    });
    results.push(measurement);
  }

  return results;
}

/** This process's environment with `home` as the home and the warm-embed path left at its default, on. */
function envWithHome(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.RAIMINISCENCE_WARM_EMBED;
  return env;
}

function shimInput(storageRoot: string, prompt: string): string {
  return JSON.stringify({ cwd: storageRoot, hook_event_name: "UserPromptSubmit", prompt });
}

/**
 * The context the shim injected. Every store here holds a seeded corpus, so an
 * empty context means the hook's recall failed or timed out and it fell back to
 * nothing: timing that call would score a non-answer, so it throws instead.
 */
export function shimContext(stdout: string): string {
  const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  const context = parsed.hookSpecificOutput?.additionalContext ?? "";
  if (context === "") throw new Error("the hook shim returned no context: its recall failed or timed out, see its stderr");
  return context;
}

function invokeShim(storageRoot: string, prompt: string, home: string, env: NodeJS.ProcessEnv = {}): string {
  const stdout = execFileSync("node", [SHIM_PATH], {
    cwd: storageRoot,
    input: shimInput(storageRoot, prompt),
    encoding: "utf8",
    env: { ...envWithHome(home), ...env },
  });
  return shimContext(stdout);
}

/** The same shim call without blocking, so several can run at once. */
async function invokeShimAsync(storageRoot: string, prompt: string, home: string): Promise<string> {
  const child = promisify(execFile)("node", [SHIM_PATH], { cwd: storageRoot, encoding: "utf8", env: envWithHome(home) });
  child.child.stdin?.end(shimInput(storageRoot, prompt));
  return shimContext((await child).stdout);
}

/**
 * Pids of the warm processes the shim started for `storageRoot` (ADR-0040).
 * Matched on the temp directory's unique name, since the shim may pass the
 * real path of a symlinked temp directory.
 */
function warmProcessPids(storageRoot: string): number[] {
  try {
    return execFileSync("pgrep", ["-f", `dist/warm\\.js [^ ]*${basename(storageRoot)} `], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map(Number);
  } catch {
    // pgrep exits 1 when nothing matches.
    return [];
  }
}

/** Kills every warm process for `storageRoot`, waits for them to go, and clears their marker and sockets under `home`. */
async function resetWarmProcesses(storageRoot: string, home: string): Promise<void> {
  for (const pid of warmProcessPids(storageRoot)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
  while (warmProcessPids(storageRoot).length > 0) await new Promise((resolve) => setTimeout(resolve, 20));
  rmSync(join(home, ".raiminiscence", "run"), { recursive: true, force: true });
}

/** Resolves once a warm process or server answers the shim's recall for `storageRoot`, with its model loaded. */
async function awaitServedRecall(storageRoot: string, home: string): Promise<void> {
  const socketPath = recallSocketPath(storageRoot, embeddedEmbeddingProvider.identity, home);
  const deadline = performance.now() + SERVER_READY_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const served = await requestServedRecall({
      socketPath,
      storageRoot,
      identity: embeddedEmbeddingProvider.identity,
      packageVersion: PACKAGE_VERSION,
      query: SAMPLE_PROMPT,
      k: 10,
      timeoutMs: deadline - performance.now(),
    });
    if (served) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`nothing served a recall on ${socketPath} within ${SERVER_READY_TIMEOUT_MS}ms`);
}

/**
 * Starts the real MCP server in `storageRoot` with `home` as its home, and
 * resolves once it answers on its warm-embed socket with a vector, so its
 * model is loaded before any timed shim call. A server for a project with
 * no `embeddingProvider` config serves the Embedded Provider's model.
 */
async function startWarmServer(storageRoot: string, home: string): Promise<ChildProcess> {
  const server = spawn("node", [SERVER_PATH], { cwd: storageRoot, env: envWithHome(home), stdio: ["pipe", "ignore", "ignore"] });
  const socketPath = warmEmbedSocketPath(embeddedEmbeddingProvider.identity, home);
  const deadline = performance.now() + SERVER_READY_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (existsSync(socketPath)) {
      const reply = parseWarmEmbedReply(
        await requestLine(socketPath, JSON.stringify({ text: SAMPLE_PROMPT, role: "query" }), deadline - performance.now()),
      );
      if (reply?.vector) return server;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopServer(server);
  throw new Error(`MCP server never served a vector on ${socketPath} within ${SERVER_READY_TIMEOUT_MS}ms`);
}

/** Closes the server's stdin, which ends its stdio transport, and kills it if it hasn't exited 5 s later. */
async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.stdin?.end();
  const timer = setTimeout(() => server.kill(), 5_000);
  await exited;
  clearTimeout(timer);
}

export interface ShimLatencyResults {
  /** No MCP server running and no warm process (ADR-0040): every hook call loads the Embedded model itself. */
  noServer: LatencyMeasurement[];
  /** An MCP server running in the same project, serving warm embeddings (ADR-0038). */
  serverRunning: LatencyMeasurement[];
}

/**
 * Measures the real `raiminiscence-hooks-shim` binary as an actual
 * subprocess (same invocation shape Claude Code/Codex use), for a
 * process-to-process comparison against hippo-memory's own real CLI
 * subprocess measurement — unlike `runRaiminiscenceLatencyBenchmark` above,
 * this includes Node process-startup cost on both sides, the same way
 * hippo-memory's number already does. Reuses the project's real default
 * embedding-provider config (no injected 15s-timeout Ollama override) since
 * this is meant to reflect actual production behaviour end-to-end, same as
 * hippo-memory's own CLI is measured with no benchmark-only overrides.
 *
 * The store is seeded with the Embedded Provider whatever
 * `BENCHMARK_EMBEDDING_PROVIDER` says, because that is the provider the
 * shim resolves for a project with no `embeddingProvider` config. Seeded
 * with any other provider, every stored vector's identity would mismatch
 * the shim's query vector, and `recall` would rank by its lexical fallback
 * alone, as this pass did before 2026-11-02.
 *
 * ADR-0038: each store size is measured twice on the same store, first with
 * no MCP server, then with the real built server running in the same
 * project and serving its warm Embedded model. Both passes run under a
 * fresh temp home, so neither reaches a developer's own running server. The
 * home lives under `/tmp` because a Unix socket path is capped near 104
 * bytes, and macOS's per-user `tmpdir()` is too deep for one.
 */
export async function runRaiminiscenceShimLatencyBenchmark(storeSizes: number[]): Promise<ShimLatencyResults> {
  const results: ShimLatencyResults = { noServer: [], serverRunning: [] };

  for (const size of storeSizes) {
    await withShimStore(size, async ({ callShim, startServer }) => {
      // Every call cold, as a session's first prompt is: the switch also stops the hook starting a warm process (ADR-0040).
      results.noServer.push(await measureLatency(size, () => callShim({ RAIMINISCENCE_WARM_EMBED: "off" })));
      await startServer();
      results.serverRunning.push(await measureLatency(size, callShim));
    });
  }

  return results;
}

export interface ShimStore {
  /** One real shim call with the sample prompt, with `env` over its environment; returns its injected context. */
  callShim: (env?: NodeJS.ProcessEnv) => string;
  /** The same call without blocking, so several can run at once. */
  callShimAsync: () => Promise<string>;
  /** Starts the real MCP server in the store and waits for its model; stopped when `use` settles. */
  startServer: () => Promise<void>;
  /** Resolves once a server or warm process answers the shim's recall, with its model loaded. */
  awaitServedRecall: () => Promise<void>;
  /** How many warm processes the shim has started for this store and are still running (ADR-0040). */
  warmProcessCount: () => number;
  /** Kills the store's warm processes and clears their spawn marker and sockets, so the next call is a first prompt again. */
  resetWarmProcesses: () => Promise<void>;
}

/**
 * Seeds a fresh store of `size` synthetic Memories with the Embedded
 * Provider, under a fresh temp home, and hands `use` a shim call on it.
 * Everything, a started server and any warm process included, is torn down
 * when `use` settles.
 * Shared by the shim pass above and the interleaved hook comparison.
 */
export async function withShimStore<T>(size: number, use: (store: ShimStore) => Promise<T>): Promise<T> {
  return withTempDir(`raiminiscence-bench-shim-latency-${size}-`, async (storageRoot) => {
    for (const memory of generateSyntheticMemories(size)) {
      await remember({
        content: memory.content,
        kind: memory.kind,
        client: "benchmark",
        storageRoot,
        embeddingProvider: embeddedEmbeddingProvider,
        triggerConsolidation: false,
      });
    }

    const home = mkdtempSync("/tmp/rai-bench-home-");
    let server: ChildProcess | undefined;
    try {
      return await use({
        callShim: (env) => invokeShim(storageRoot, SAMPLE_PROMPT, home, env),
        callShimAsync: () => invokeShimAsync(storageRoot, SAMPLE_PROMPT, home),
        startServer: async () => {
          server = await startWarmServer(storageRoot, home);
        },
        awaitServedRecall: () => awaitServedRecall(storageRoot, home),
        warmProcessCount: () => warmProcessPids(storageRoot).length,
        resetWarmProcesses: () => resetWarmProcesses(storageRoot, home),
      });
    } finally {
      if (server) await stopServer(server);
      await resetWarmProcesses(storageRoot, home);
      rmSync(home, { recursive: true, force: true });
    }
  });
}
