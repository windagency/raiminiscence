import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Absolute path to the real hippo-memory CLI entrypoint, resolved from this
 * package's OWN isolated node_modules (installed via `npm install` scoped
 * to benchmarks/hippo-memory-runner/ only — see package.json's comment and
 * benchmarks/README.md's isolation statement). Never touches the root
 * pnpm workspace or its lockfile.
 */
export const HIPPO_CLI_PATH = join(import.meta.dirname, "node_modules", "hippo-memory", "dist", "cli.js");

export interface HippoRunResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Shared across every hippo-memory-runner/*.ts file that writes corpus/scenario memories (was redeclared identically in recall-runner.ts and invalidation-runner.ts). */
export type MemoryKind = "episodic" | "semantic" | "decision";

const REMEMBER_ID_PATTERN = /Remembered \[(\S+)\]/;
const DECIDE_ID_PATTERN = /memory:\s*(\S+)/;

/**
 * Runs one `hippo <args>` invocation with `cwd` pinned to the caller's
 * isolated scratch directory — hippo-memory stores its state in a `.hippo/`
 * folder resolved relative to cwd (confirmed empirically: `hippo init` in a
 * fresh temp dir creates `<cwd>/.hippo/`, and subsequent commands search
 * upward from cwd for one, never touching a directory outside it or any
 * other run's store). Never throws on a non-zero exit — callers inspect
 * `status`/`stderr` themselves, since some commands (e.g. a `remember` with
 * too-short content) are expected to exit non-zero in negative-path tests.
 */
export function runHippo(args: string[], cwd: string): HippoRunResult {
  try {
    const stdout = execFileSync("node", [HIPPO_CLI_PATH, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HIPPO_SKIP_POSTINSTALL: "1" },
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number | null };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      status: execError.status ?? 1,
    };
  }
}

/**
 * Writes one memory into hippo-memory, mapping rAIminiscence's MemoryKind
 * onto hippo-memory's actual write surface (documented as a schema-mapping
 * compromise in benchmarks/README.md):
 *   - kind: "decision"            -> `hippo decide "<content>"` (hippo's
 *     own first-class decision object + memory mirror; lands in its
 *     "semantic" layer, tagged "decision")
 *   - kind: "episodic"/"semantic" -> `hippo remember "<content>" --observed`
 *     (hippo has no direct "write straight to semantic" primitive outside
 *     `sleep`-driven consolidation or a first-class object type like
 *     decide/policy/skill; both rAIminiscence kinds collapse onto hippo's
 *     one raw-write path, its episodic buffer)
 * Confidence is left at rAIminiscence's own `remember()` default
 * ("observed") on both sides for parity, since the corpus doesn't specify
 * per-memory confidence.
 * Returns the id hippo itself assigned, parsed from its stdout. Shared by
 * recall-runner.ts, invalidation-runner.ts (both need that id back to key
 * results against the shared corpus/scenario fixture's own human-authored
 * id) and latency-runner.ts (discards the id — its synthetic memories don't
 * need one).
 */
export function writeHippoMemory(memory: { id: string; kind: MemoryKind; content: string }, cwd: string): string {
  if (memory.kind === "decision") {
    const result = runHippo(["decide", memory.content], cwd);
    if (result.status !== 0) throw new Error(`hippo decide failed for ${memory.id}: ${result.stderr}`);
    const match = result.stdout.match(DECIDE_ID_PATTERN);
    if (!match) throw new Error(`Could not parse hippo decide output for ${memory.id}: ${result.stdout}`);
    return match[1]!;
  }
  const result = runHippo(["remember", memory.content, "--observed"], cwd);
  if (result.status !== 0) throw new Error(`hippo remember failed for ${memory.id}: ${result.stderr}`);
  const match = result.stdout.match(REMEMBER_ID_PATTERN);
  if (!match) throw new Error(`Could not parse hippo remember output for ${memory.id}: ${result.stdout}`);
  return match[1]!;
}

export interface HippoRecallHit {
  id: string;
  score: number;
  content: string;
  layer: string;
  tags: string[];
}

export interface HippoRecallResponse {
  query: string;
  results: HippoRecallHit[];
  total: number;
}

/**
 * hippo-memory's `recall` has no direct "top N" flag (only a token
 * `--budget`, which truncates by content size, and `--min-results`, a
 * floor). To get a score-ranked candidate list we don't have to guess a
 * budget for, we pass a deliberately huge budget/min-results so nothing is
 * truncated, then sort by the `score` field and slice top-k ourselves —
 * scored exactly the same way the rAIminiscence runner's own top-k slicing
 * works, for a fair, apples-to-apples comparison.
 */
export function hippoRecall(query: string, cwd: string): HippoRecallResponse {
  const result = runHippo(["recall", query, "--json", "--budget", "1000000", "--min-results", "1000"], cwd);
  if (result.status !== 0) {
    throw new Error(`hippo recall "${query}" failed (status ${result.status}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as HippoRecallResponse;
  parsed.results.sort((a, b) => b.score - a.score);
  return parsed;
}
