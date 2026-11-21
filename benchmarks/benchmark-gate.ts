import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runWatched, waitForQuietHost, withStallRetry, type WatchedOptions } from "./benchmark-gate-guard.js";
import {
  gateVerdict,
  hookChecks,
  locomoRecall,
  longMemEvalHits,
  metricChecks,
  renderGateReport,
  type HookSize,
  type LocomoQa,
  type LongMemEvalQuestion,
  type LongMemEvalRow,
  type MetricCheck,
  type Scores,
} from "./benchmark-gate-verdict.js";

/**
 * The benchmark gate (`NEXT_STEPS.md`): one script that runs the corpus,
 * extended and hook suites, then LongMemEval-S and LoCoMo through
 * hippo-memory's own harnesses at the latest hippo-memory release, and says
 * whether rAIminiscence is at least as good. The arithmetic and the verdict
 * are `benchmark-gate-verdict.ts`.
 *
 * Every step runs from a frozen copy of the built repo inside the work
 * directory, so edits made during a run, which takes about a day, cannot leak
 * into it. A step that finished is skipped on a re-run, and both harnesses
 * resume per question, so an interrupted run picks up where it stopped. Each
 * step first waits for a quiet host, and a command silent for too long is
 * killed and its step retried once (`benchmark-gate-guard.ts`).
 * rAIminiscence runs its default, Embedded provider. Ollama must be up for the
 * extended suite.
 *
 * usage: tsx benchmarks/benchmark-gate.ts --work=<dir> --locomo-data=<locomo10.json>
 *          [--longmemeval-data=<longmemeval_s_cleaned.json>] [--limit=<n>] [--evaluate-only]
 *
 * `--limit=n` is a smoke run: LongMemEval-S's first n questions and LoCoMo's
 * first conversation, skipping the corpus, extended and hook suites. Its
 * report says so and is not a verdict.
 */

const REPO = resolve(import.meta.dirname, "..");
const HIPPO_REPO_URL = "https://github.com/kitfunso/hippo-memory";
/** hippo-memory's arm B adds this to embed with MiniLM, as in every published run. */
const TRANSFORMERS = "@huggingface/transformers@4.3.0";
/** A command is killed after this long without output: healthy rAIminiscence LongMemEval-S builds went 34 min between progress lines. */
const SILENCE_MS = 90 * 60_000;
/** Each step waits for the one-minute load average to drop to the core count, so a busy host delays the run instead of skewing it. */
const MAX_LOAD = availableParallelism();
const LOAD_POLL_MS = 60_000;

interface Options {
  work: string;
  locomoData: string;
  longMemEvalData: string;
  limit?: number;
  evaluateOnly: boolean;
}

function parseOptions(argv: string[]): Options {
  const value = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const work = value("work");
  const locomoData = value("locomo-data");
  if (!work || !locomoData)
    throw new Error(
      "usage: benchmark-gate.ts --work=<dir> --locomo-data=<locomo10.json> [--longmemeval-data=<file>] [--limit=<n>] [--evaluate-only]",
    );
  const limit = value("limit");
  return {
    work: resolve(work),
    locomoData: resolve(locomoData),
    longMemEvalData: resolve(value("longmemeval-data") ?? join(REPO, "benchmarks", "longmemeval", "data", "longmemeval_s_cleaned.json")),
    limit: limit === undefined ? undefined : Number(limit),
    evaluateOnly: argv.includes("--evaluate-only"),
  };
}

/**
 * Both harnesses set HOME per question, which breaks a Node version manager's shim, so the real node goes first on PATH.
 * tsx's NODE_PATH points into this repo's pnpm store, which holds `@huggingface/transformers`: inherited, it lets
 * hippo-memory's BM25-only arm A find the package and embed, so it is dropped.
 */
function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const { NODE_PATH: _dropped, ...inherited } = process.env;
  return { ...inherited, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, ...extra };
}

function run(command: string, args: string[], options: Omit<WatchedOptions, "silenceMs"> = {}): Promise<string> {
  console.log(`$ ${command} ${args.join(" ")}`);
  return runWatched(command, args, { env: env(), ...options, silenceMs: SILENCE_MS });
}

const quietHost = () => waitForQuietHost({ maxLoad: MAX_LOAD, pollMs: LOAD_POLL_MS });

/**
 * Runs `body` once per work directory: a finished step leaves a stamp and is skipped next time. It starts on a
 * quiet host, and a stall gets one retry after the host is quiet again.
 */
async function step(work: string, name: string, body: () => Promise<unknown>) {
  const stamp = join(work, "steps", `${name}.done`);
  if (existsSync(stamp)) return console.log(`skip ${name}: done`);
  console.log(`step ${name}`);
  await quietHost();
  await withStallRetry(body, quietHost);
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, new Date().toISOString() + "\n");
}

function pinnedHippoVersion(): string {
  const pkg = JSON.parse(readFileSync(join(REPO, "benchmarks", "hippo-memory-runner", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  return pkg.dependencies["hippo-memory"]!;
}

async function prepare(options: Options, version: string) {
  const { work } = options;
  const frozen = join(work, "frozen");
  await step(work, "freeze", async () => {
    await run("pnpm", ["build"], { cwd: REPO });
    mkdirSync(frozen, { recursive: true });
    await run("rsync", ["-a", "--exclude=node_modules/", join(REPO, "package.json"), join(REPO, "packages"), frozen]);
    await run("rsync", [
      "-a",
      "--exclude=node_modules/",
      "--exclude=longmemeval/",
      "--exclude=locomo/",
      "--exclude=results/*",
      join(REPO, "benchmarks"),
      frozen,
    ]);
    for (const dir of readdirSync(join(REPO, "packages"))) {
      const modules = join(REPO, "packages", dir, "node_modules");
      if (existsSync(modules)) symlinkSync(modules, join(frozen, "packages", dir, "node_modules"));
    }
    symlinkSync(join(REPO, "node_modules"), join(frozen, "node_modules"));
    symlinkSync(join(REPO, "benchmarks", "hippo-memory-runner", "node_modules"), join(frozen, "benchmarks", "hippo-memory-runner", "node_modules"));
  });
  await step(work, "hippo-installs", async () => {
    for (const [arm, extra] of [
      ["hippoA", []],
      ["hippoB", [TRANSFORMERS]],
    ] as const) {
      const dir = join(work, arm);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `gate-${arm.toLowerCase()}`, private: true }) + "\n");
      await run("npm", ["install", "--no-audit", "--no-fund", `hippo-memory@${version}`, ...extra], { cwd: dir });
    }
  });
  await step(work, "harness", async () => {
    await run("git", ["clone", "--quiet", "--depth", "1", "--branch", `v${version}`, HIPPO_REPO_URL, join(work, "harness")]);
    await run("python3", ["-m", "venv", join(work, "venv")]);
    await run(join(work, "venv", "bin", "pip"), ["install", "--quiet", "-r", join(work, "harness", "benchmarks", "locomo", "requirements.txt")]);
  });
}

const hippoBin = (work: string, arm: "hippoA" | "hippoB") => join(work, arm, "node_modules", "hippo-memory", "bin", "hippo.js");
const shim = (work: string) => join(work, "frozen", "benchmarks", "raiminiscence-runner", "hippo-cli-shim.ts");

async function runSuites(options: Options) {
  const { work } = options;
  const frozenBench = join(work, "frozen", "benchmarks");
  const tsx = join(REPO, "node_modules", ".bin", "tsx");
  for (const suite of ["compare", "extended-compare", "hook-latency-interleaved"]) {
    await step(work, suite, () => run(tsx, [join(frozenBench, `${suite}.ts`)], { cwd: join(work, "frozen") }));
  }
}

async function runLongMemEval(options: Options) {
  const { work, longMemEvalData, limit } = options;
  const harness = join(work, "harness", "benchmarks", "longmemeval", "recall_cli_haystack.py");
  const limitArgs = limit === undefined ? [] : ["--limit", String(limit)];
  const lifted = ["--budget", "100000000"];
  const lme = (dir: string, bin: string, args: string[]) =>
    run("python3", [harness, args[0]!, "--hippo", bin, "--data", longMemEvalData, "--work", join(work, "lme", dir), ...args.slice(1), ...limitArgs]);
  await step(work, "longmemeval-hippo", async () => {
    await lme("hippo", hippoBin(work, "hippoA"), ["build", "--workers", "4"]);
    await lme("hippo", hippoBin(work, "hippoA"), ["recall", "--run", "A-lifted", ...lifted]);
    await lme("hippo", hippoBin(work, "hippoB"), ["embed", "--workers", "2"]);
    await lme("hippo", hippoBin(work, "hippoB"), ["recall", "--store", "embedded", "--run", "B-lifted", ...lifted]);
  });
  await step(work, "longmemeval-raiminiscence", async () => {
    // The harness passes each call a clean environment, so the shim finds its arm in this file instead of RAIMINISCENCE_ARM.
    mkdirSync(join(work, "lme", "raiminiscence"), { recursive: true });
    writeFileSync(join(work, "lme", "raiminiscence", "raiminiscence-arm.json"), JSON.stringify({ provider: "embedded" }) + "\n");
    // One worker: the Embedded model in every process hit memory pressure at more on 2026-10-31.
    await lme("raiminiscence", shim(work), ["build", "--workers", "1"]);
    await lme("raiminiscence", shim(work), ["embed", "--workers", "8"]);
    await lme("raiminiscence", shim(work), ["recall", "--store", "embedded", "--run", "E-lifted", "--workers", "1", ...lifted]);
  });
}

async function runLocomo(options: Options) {
  const { work, locomoData, limit } = options;
  const dir = join(work, "harness", "benchmarks", "locomo");
  const python = join(work, "venv", "bin", "python");
  const out = join(work, "locomo");
  const arms = { hippoA: `node ${hippoBin(work, "hippoA")}`, hippoB: `node ${hippoBin(work, "hippoB")}`, raiminiscence: `node ${shim(work)}` };
  for (const [arm, bin] of Object.entries(arms)) {
    await step(work, `locomo-${arm}`, async () => {
      const result = join(out, `${arm}-evidence.json`);
      const conversations = limit === undefined ? [] : ["--conversations", "1"];
      const armEnv = env({ HIPPO_BIN: bin, RAIMINISCENCE_ARM: "embedded" });
      await run(
        python,
        [
          "run.py",
          "--data",
          locomoData,
          "--output-dir",
          out,
          "--output-name",
          `${arm}-evidence.json`,
          "--score-mode",
          "evidence",
          "--resume",
          ...conversations,
        ],
        { cwd: dir, env: armEnv },
      );
      await run(python, ["score_evidence.py", "--data", locomoData, "--result", result, "--output", join(out, `${arm}-rescored.json`)], {
        cwd: dir,
        env: armEnv,
      });
    });
  }
}

const readRows = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LongMemEvalRow);

const pairUp = (rai: Record<string, Scores>, hippo: Record<string, Scores>) =>
  Object.fromEntries(Object.keys(rai).map((metric) => [metric, { rai: rai[metric]!, hippo: hippo[metric]! }]));

function evaluate(options: Options, version: string) {
  const { work, longMemEvalData, limit } = options;
  const sources: string[] = [];
  const source = (path: string) => {
    sources.push(path);
    return path;
  };
  const questions = JSON.parse(readFileSync(longMemEvalData, "utf8")) as LongMemEvalQuestion[];
  const lmeHits = (dir: string, run: string) => longMemEvalHits(readRows(source(join(work, "lme", dir, `${run}.jsonl`))), questions);
  const raiLme = lmeHits("raiminiscence", "E-lifted");
  const locomo = (arm: string) =>
    locomoRecall((JSON.parse(readFileSync(source(join(work, "locomo", `${arm}-rescored.json`)), "utf8")) as { per_qa: LocomoQa[] }).per_qa);
  const raiLocomo = locomo("raiminiscence");

  const metrics: MetricCheck[] = [];
  for (const arm of ["A", "B"] as const) {
    metrics.push(...metricChecks("LongMemEval-S, whole haystack", `hippo-memory ${arm}`, pairUp(raiLme, lmeHits("hippo", `${arm}-lifted`))));
    metrics.push(...metricChecks("LoCoMo, evidence", `hippo-memory ${arm}`, pairUp(raiLocomo, locomo(`hippo${arm}`))));
  }
  let hooks: HookSize[] = [];
  if (limit === undefined) {
    const results = join(work, "frozen", "benchmarks", "results");
    const hookFile = readdirSync(results)
      .filter((name) => name.endsWith("-hook-latency-interleaved.json"))
      .sort()
      .at(-1);
    if (!hookFile) throw new Error(`no hook latency results in ${results}`);
    hooks = (JSON.parse(readFileSync(source(join(results, hookFile)), "utf8")) as { results: HookSize[] }).results;
  }

  const verdict = gateVerdict(metrics, hookChecks(hooks));
  const date = new Date().toISOString().slice(0, 10);
  const smoke = limit === undefined ? "" : `-smoke`;
  let report = renderGateReport(verdict, { date, hippoVersion: version, sources });
  if (limit !== undefined)
    report += `\nSmoke run: LongMemEval-S's first ${limit} questions and LoCoMo's first conversation, no hook suite. Not a verdict.\n`;
  const base = join(REPO, "benchmarks", "results", `${date}-benchmark-gate${smoke}`);
  writeFileSync(`${base}.md`, report);
  writeFileSync(`${base}.json`, JSON.stringify({ date, hippoVersion: version, limit: limit ?? null, ...verdict }, null, 2) + "\n");
  console.log(`Wrote ${base}.md`);
  return verdict.pass;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const version = pinnedHippoVersion();
  const latest = (await run("npm", ["view", "hippo-memory", "version"])).trim();
  if (latest !== version)
    throw new Error(`benchmarks/hippo-memory-runner pins hippo-memory ${version}, but the latest release is ${latest}. Upgrade it first.`);
  mkdirSync(options.work, { recursive: true });
  if (!options.evaluateOnly) {
    await prepare(options, version);
    if (options.limit === undefined) await runSuites(options);
    await runLongMemEval(options);
    await runLocomo(options);
  }
  process.exitCode = evaluate(options, version) ? 0 : 1;
}

await main();
