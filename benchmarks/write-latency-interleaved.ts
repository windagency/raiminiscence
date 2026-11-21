import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { remember } from "../packages/raiminiscence-mcp/src/core/engine.js";
import { readPackedIndex } from "../packages/raiminiscence-mcp/src/core/embeddings/packed-index.js";
import { identitiesCompatible } from "../packages/raiminiscence-mcp/src/core/embeddings/provider.js";
import { generateSyntheticMemories, type SyntheticMemory } from "./corpus/synthetic-memories.js";
import { HIPPO_CLI_PATH, runHippo, writeHippoMemory } from "./hippo-memory-runner/hippo-cli.js";
import { startMcpStdioClient, type McpStdioClient } from "./mcp-stdio-client.js";
import { pairedLatencySummary, type PairedLatencySummary } from "./paired-latency.js";
import { embeddedEmbeddingProvider } from "./raiminiscence-runner/embedded-embedding-provider.js";
import { withTempDir } from "./temp-dir.js";

/**
 * Write cost as an agent sees it: one `remember` call through each
 * system's real MCP server, already running, timed call by call in
 * alternation. rAIminiscence's `remember` tool against hippo-memory's
 * `hippo_remember`, on stores holding the same synthetic corpus.
 *
 * Both answer once the Memory is on disk and embed it after:
 * hippo-memory always, rAIminiscence since ADR-0041. The pause after every
 * call lets each background embed finish, so it doesn't land on the next
 * timed call of either system. Writes are sparse in real use, so the
 * pause also matches how an agent writes. `--label` names a run, so a before-and-after
 * pair on the same day doesn't overwrite itself.
 *
 * usage: tsx benchmarks/write-latency-interleaved.ts [sizes, e.g. 10,1500: print only] [--label=<name>]
 */

const STORE_SIZES = [10, 50, 150, 300, 750, 1500];
const PAIRS = 21;
const WARM_UP_CALLS = 2;
const PAUSE_BETWEEN_CALLS_MS = 500;
const SERVER_PATH = join(import.meta.dirname, "..", "packages", "raiminiscence-mcp", "dist", "server.js");

interface SizeResult {
  storeSize: number;
  summary: PairedLatencySummary;
  raiminiscenceMs: number[];
  hippoMs: number[];
  /** One-minute load average before and after the timed pairs. */
  loadAverage: [number, number];
  /** rAIminiscence writes, warm-up included, and how many have a vector of the server's identity once the server has exited. */
  raiminiscenceVectors: { written: number; withVector: number };
}

function envWithHome(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HIPPO_SKIP_POSTINSTALL: "1" };
  delete env.RAIMINISCENCE_WARM_EMBED;
  return env;
}

async function withServer<T>(command: string[], cwd: string, use: (client: McpStdioClient) => Promise<T>): Promise<T> {
  const home = mkdtempSync("/tmp/write-bench-home-");
  const client = await startMcpStdioClient("node", command, { cwd, env: envWithHome(home) });
  try {
    return await use(client);
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
}

async function seedRaiminiscence(storageRoot: string, memories: SyntheticMemory[]) {
  for (const memory of memories) {
    await remember({
      content: memory.content,
      kind: memory.kind,
      client: "benchmark",
      storageRoot,
      embeddingProvider: embeddedEmbeddingProvider,
      triggerConsolidation: false,
    });
  }
}

function seedHippo(storageRoot: string, memories: SyntheticMemory[]) {
  const init = runHippo(["init", "--no-hooks", "--no-schedule", "--no-learn"], storageRoot);
  if (init.status !== 0) throw new Error(`hippo init failed: ${init.stderr}`);
  for (const memory of memories) writeHippoMemory(memory, storageRoot);
  const embed = runHippo(["embed"], storageRoot);
  if (embed.status !== 0) throw new Error(`hippo embed failed: ${embed.stderr}`);
}

async function time(call: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await call();
  return performance.now() - start;
}

async function measureSize(storeSize: number): Promise<SizeResult> {
  const corpus = generateSyntheticMemories(storeSize + WARM_UP_CALLS + PAIRS);
  const seed = corpus.slice(0, storeSize);
  const writes = corpus.slice(storeSize);
  return withTempDir(`raiminiscence-bench-write-${storeSize}-`, async (raiRoot) =>
    withTempDir(`hippo-bench-write-${storeSize}-`, async (hippoRoot) => {
      await seedRaiminiscence(raiRoot, seed);
      seedHippo(hippoRoot, seed);
      const writtenIds: string[] = [];
      const measured = await withServer([SERVER_PATH], raiRoot, (rai) =>
        withServer([HIPPO_CLI_PATH, "mcp"], hippoRoot, async (hippo) => {
          const writeRai = async (memory: SyntheticMemory) => {
            const reply = JSON.parse(await rai.callTool("remember", { content: memory.content, kind: memory.kind })) as { id: string };
            writtenIds.push(reply.id);
          };
          const writeHippo = (memory: SyntheticMemory) => hippo.callTool("hippo_remember", { text: memory.content });
          for (const memory of writes.slice(0, WARM_UP_CALLS)) {
            await writeRai(memory);
            await sleep(PAUSE_BETWEEN_CALLS_MS);
            await writeHippo(memory);
            await sleep(PAUSE_BETWEEN_CALLS_MS);
          }
          const before = loadavg()[0]!;
          const raiminiscenceMs: number[] = [];
          const hippoMs: number[] = [];
          for (const [i, memory] of writes.slice(WARM_UP_CALLS).entries()) {
            if (i % 2 === 0) {
              raiminiscenceMs.push(await time(() => writeRai(memory)));
              await sleep(PAUSE_BETWEEN_CALLS_MS);
              hippoMs.push(await time(() => writeHippo(memory)));
            } else {
              hippoMs.push(await time(() => writeHippo(memory)));
              await sleep(PAUSE_BETWEEN_CALLS_MS);
              raiminiscenceMs.push(await time(() => writeRai(memory)));
            }
            await sleep(PAUSE_BETWEEN_CALLS_MS);
          }
          const after = loadavg()[0]!;
          return {
            storeSize,
            summary: pairedLatencySummary(raiminiscenceMs, hippoMs),
            raiminiscenceMs,
            hippoMs,
            loadAverage: [before, after] as [number, number],
          };
        }),
      );
      // ADR-0041: the server answers before the vector is written, and waits for its pending vectors when stdin closes.
      const index = readPackedIndex(raiRoot);
      const withVector = writtenIds.filter((id) => index[id] && identitiesCompatible(index[id].identity, embeddedEmbeddingProvider.identity)).length;
      return { ...measured, raiminiscenceVectors: { written: writtenIds.length, withVector } };
    }),
  );
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

function report(date: string, results: SizeResult[]): string {
  const rows = results.map(({ storeSize, summary: s, loadAverage, raiminiscenceVectors }) =>
    [
      storeSize,
      ms(s.medianMs.raiminiscence),
      ms(s.medianMs.hippo),
      `${ms(s.medianDifferenceMs)} [${s.ci95Ms[0].toFixed(1)}, ${s.ci95Ms[1].toFixed(1)}]`,
      `${s.raiminiscenceFasterPairs} of ${s.pairs}`,
      `${loadAverage[0].toFixed(1)} → ${loadAverage[1].toFixed(1)}`,
      `${raiminiscenceVectors.withVector} of ${raiminiscenceVectors.written}`,
    ].join(" | "),
  );
  return [
    `# Write latency through each MCP server, interleaved (${date})`,
    "",
    "Write cost as an agent sees it. One `remember` call to rAIminiscence's real built MCP server against one `hippo_remember` call to hippo-memory's real MCP server (`hippo mcp`), both already running, each on a store seeded with the same synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`). rAIminiscence's store is seeded with the Embedded Provider, its server's default. Each call writes a new Memory from the same corpus, the same text to both.",
    "",
    "Both answer once the Memory is on disk and embed it after, rAIminiscence since ADR-0041. Each runs that embed in its server process, so every call is followed by a pause long enough for it to finish before the next call of either system.",
    "",
    `Method: ${WARM_UP_CALLS} untimed warm-up writes to each, then ${PAIRS} pairs, the order flipped every pair, with a ${PAUSE_BETWEEN_CALLS_MS} ms pause after every call, so neither system's background embed lands on the other's timed call. The difference is rAIminiscence minus hippo-memory, pair by pair: negative means rAIminiscence is faster. The interval is a 95% percentile bootstrap over whole pairs, 10,000 resamples, seed 1. "Vectors after exit" counts rAIminiscence's writes, warm-up included, that have a vector of the server's identity once the server has exited; a shortfall means a background embed failed or was cut off.`,
    "",
    "| Memories | rAIminiscence median | hippo-memory median | Median difference [95% CI] | rAIminiscence faster | Load average | Vectors after exit |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "",
    "Single machine, single run. Raw per-call timings are in the JSON file alongside.",
    "",
  ].join("\n");
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const label = process.argv.find((arg) => arg.startsWith("--label="))?.slice("--label=".length);
  const sizesArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const sizes = sizesArg ? sizesArg.split(",").map(Number) : STORE_SIZES;
  const results: SizeResult[] = [];
  for (const size of sizes) {
    const result = await measureSize(size);
    console.log(JSON.stringify({ storeSize: size, ...result.summary, raiminiscenceVectors: result.raiminiscenceVectors }));
    results.push(result);
  }
  if (sizesArg) return;
  const base = join(import.meta.dirname, "results", `${date}-write-latency-interleaved${label ? `-${label}` : ""}`);
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ date, pairs: PAIRS, warmUpCalls: WARM_UP_CALLS, pauseBetweenCallsMs: PAUSE_BETWEEN_CALLS_MS, results }, null, 2) + "\n",
  );
  writeFileSync(`${base}.md`, report(date, results));
  console.log(`Wrote ${base}.md`);
}

await main();
