/**
 * Speaks the slice of hippo-memory's CLI that hippo's own harnesses call, so
 * they can score rAIminiscence unchanged, gates and all: LongMemEval-S
 * (`benchmarks/longmemeval/recall_cli_haystack.py` in kitfunso/hippo-memory)
 * and LoCoMo (`benchmarks/locomo/run.py`, through `HIPPO_BIN`):
 *
 *   --version                                  prints "raiminiscence"
 *   init --no-hooks --no-schedule --no-learn   prints "Initialized Hippo at <cwd>/.hippo"
 *   remember (- | <text>) [--tag <t>]...       stdin or argv is the Memory; prints "Remembered [<id>]"
 *   embed / embed --status                     a no-op / "Embedding status: <n>/<n> memories embedded"
 *   recall <query> --json [--budget N] [--why] the harnesses' JSON result shape
 *
 * Run with plain `node` (type stripping), from the built `dist/`. The arm is
 * `RAIMINISCENCE_ARM` (`embedded` | `ollama`) when set, since LoCoMo runs each
 * conversation in a fresh temp directory. Otherwise it comes from
 * `raiminiscence-arm.json` (`{ "provider": "embedded" | "ollama" }`), found by
 * walking up from the cwd to the LongMemEval harness's work directory.
 *
 * Product behaviour, not harness glue: `remember` embeds at write time, and
 * `recall` returns its default k. Three departures, all from hippo's protocol
 * rather than rAIminiscence's defaults: no consolidation runs
 * (`triggerConsolidation: false`); `--budget N` lifts recall's k to every
 * Memory and then keeps results while their token total stays within N, the
 * counterpart of hippo's token budget; and `--tag` values, which rAIminiscence
 * has no concept of, are kept in a sidecar file and echoed back in `tags` for
 * the harness's scorer, never used in ranking. A failed embed exits non-zero
 * instead of falling back to lexical scoring, so the harness's "no call exits
 * non-zero" gate catches it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recall, remember } from "../../packages/raiminiscence-mcp/dist/core/engine.js";
import { readAllMemories } from "../../packages/raiminiscence-mcp/dist/core/storage.js";
import { readPackedIndex } from "../../packages/raiminiscence-mcp/dist/core/embeddings/packed-index.js";
import { identitiesCompatible, type EmbeddingProvider } from "../../packages/raiminiscence-mcp/dist/core/embeddings/provider.js";
import { createEmbeddedEmbeddingProvider } from "../../packages/raiminiscence-mcp/dist/core/embeddings/embedded.js";
import { createOllamaEmbeddingProvider } from "../../packages/raiminiscence-mcp/dist/core/embeddings/ollama.js";

const ARM_FILE = "raiminiscence-arm.json";
const ARM_ENV = "RAIMINISCENCE_ARM";
const TAGS_FILE = "raiminiscence-tags.json";
const LIFTED_K = 1_000_000;
// Same as raiminiscence-runner/ollama-embedding-provider.ts: a CPU-only Ollama
// can take over the production 2s on one long session.
const OLLAMA_TIMEOUT_MS = 15_000;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function armFromFile(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, ARM_FILE))) {
    const parent = dirname(dir);
    if (parent === dir) fail(`no ${ARM_ENV} and no ${ARM_FILE} above ${process.cwd()}`);
    dir = parent;
  }
  return (JSON.parse(readFileSync(join(dir, ARM_FILE), "utf8")) as { provider: string }).provider;
}

function armProvider(): EmbeddingProvider {
  const provider = process.env[ARM_ENV] || armFromFile();
  if (provider === "embedded") return createEmbeddedEmbeddingProvider();
  if (provider === "ollama") return createOllamaEmbeddingProvider({ timeoutMs: OLLAMA_TIMEOUT_MS });
  return fail(`unknown arm "${provider}"`);
}

/** Each Memory's harness tags, by id. Harness bookkeeping only: recall never reads it for ranking. */
function readTags(storageRoot: string): Record<string, string[]> {
  const path = join(storageRoot, TAGS_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string[]>) : {};
}

/** hippo's token estimate: characters / 4. */
function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function init(storageRoot: string): void {
  mkdirSync(storageRoot, { recursive: true });
  process.stdout.write(`Initialized Hippo at ${storageRoot}\n`);
}

async function rememberCommand(storageRoot: string, args: string[]): Promise<void> {
  const [source, ...flags] = args;
  if (source === undefined) fail("remember: expected - or <text>");
  const tags: string[] = [];
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] !== "--tag" || flags[i + 1] === undefined) fail(`remember: unsupported flags ${flags.join(" ")}`);
    tags.push(flags[i + 1]!);
  }
  const content = source === "-" ? readFileSync(0, "utf8") : source;
  const result = await remember({ content, client: "benchmark", storageRoot, embeddingProvider: armProvider(), triggerConsolidation: false });
  if (!result.embedded) fail(`remember: ${result.id} was stored without an embedding`);
  if (tags.length > 0) writeFileSync(join(storageRoot, TAGS_FILE), JSON.stringify({ ...readTags(storageRoot), [result.id]: tags }));
  process.stdout.write(`Remembered [${result.id}]\n`);
}

function embedStatus(storageRoot: string, args: string[]): void {
  if (args[0] !== "--status") return; // remember already embedded at write time
  const provider = armProvider();
  const memories = readAllMemories(storageRoot);
  const index = readPackedIndex(storageRoot);
  const embedded = memories.filter((memory) => {
    const record = index[memory.frontmatter.id];
    return record !== undefined && identitiesCompatible(record.identity, provider.identity);
  }).length;
  process.stdout.write(`Embedding status: ${embedded}/${memories.length} memories embedded\n`);
}

async function recallJson(storageRoot: string, args: string[]): Promise<void> {
  const [query, ...flags] = args;
  if (query === undefined || !flags.includes("--json")) fail("recall: expected <query> --json");
  const budgetAt = flags.indexOf("--budget");
  const lifted = budgetAt !== -1;
  const budget = lifted ? Number(flags[budgetAt + 1]) : Infinity;
  if (Number.isNaN(budget)) fail("recall: --budget needs a number");
  const why = flags.includes("--why");
  const result = await recall({ query, ...(lifted && { k: LIFTED_K }), storageRoot, embeddingProvider: armProvider(), triggerConsolidation: false });
  if (result.usedFallback) fail("recall: the query embedding failed and recall fell back to lexical scoring");
  const tagsById = readTags(storageRoot);
  const ranked = result.results.map((item) => ({
    id: item.id,
    score: item.score,
    strength: item.strength,
    tokens: tokens(item.detail),
    tags: tagsById[item.id] ?? [],
    content: item.detail,
    layer: item.kind,
    ...(why && { cosine: item.score, bm25: null }),
  }));
  let spent = 0;
  const results = ranked.filter((item) => (spent += item.tokens) <= budget);
  // Without --budget, recall's k cut stands in for hippo's budget cut. With
  // it, k is lifted, so anything recall left out was filtered before ranking
  // (a score at or below minScore) and the rest fell to the token budget.
  const totalCandidates = readAllMemories(storageRoot).length;
  const preRank = totalCandidates - ranked.length;
  const suppressionSummary = {
    totalCandidates,
    droppedByBudget: lifted ? ranked.length - results.length : preRank,
    droppedPreRank: lifted ? preRank : 0,
  };
  process.stdout.write(JSON.stringify({ query, results, budget: null, suppressionSummary }));
}

function version(): void {
  process.stdout.write("raiminiscence\n");
}

const COMMANDS: Record<string, (storageRoot: string, args: string[]) => void | Promise<void>> = {
  "--version": version,
  init,
  remember: rememberCommand,
  embed: embedStatus,
  recall: recallJson,
};

const [command, ...args] = process.argv.slice(2);
const run = command === undefined ? undefined : COMMANDS[command];
if (run === undefined) fail(`unsupported command: ${command ?? "(none)"}`);
await run(join(process.cwd(), ".hippo"), args);
