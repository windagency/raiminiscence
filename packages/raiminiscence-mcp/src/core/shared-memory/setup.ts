import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { memoryStoreDir } from "#src/core/storage.js";
import { hasStagedChanges, runGit, type RunGit } from "./git.js";

export const SHARED_MEMORY_BRANCH = "raiminiscence-memory";
const MERGE_DRIVER_NAME = "raiminiscence-memory";
const MERGE_DRIVER_DISPLAY_NAME = "rAIminiscence recency-keyed merge driver";

/**
 * The per-record file globs this driver owns — `record-index.ts`'s index names, plus every Memory file.
 * ADR-0037: `co-access/*` stays, so edge files a machine on an older version still writes merge cleanly.
 */
const SHARED_MEMORY_RECORD_GLOBS = ["co-access/*", "conflict/*", "embeddings/*", "*.md"];

/** A worktree checkout's `.git` is a *file* (pointing at the real gitdir), unlike a normal repo's `.git` directory. */
export function isSharedMemoryWorktree(storageRoot: string): boolean {
  return existsSync(join(memoryStoreDir(storageRoot), ".git"));
}

function branchExistsLocally(repoRoot: string, git: RunGit, branch: string): boolean {
  try {
    git(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function hasRemote(repoRoot: string, git: RunGit): boolean {
  try {
    return git(repoRoot, ["remote"]).trim().length > 0;
  } catch {
    return false;
  }
}

function branchExistsOnRemote(repoRoot: string, git: RunGit, branch: string): boolean {
  if (!hasRemote(repoRoot, git)) return false;
  try {
    return git(repoRoot, ["ls-remote", "--heads", "origin", branch]).trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The compiled sibling next to this file in a real (published) install. In
 * dev/test, this module runs straight from TS source under `src/`, where no
 * such compiled file exists — fall back to the equivalent path under the
 * package's own `dist/` build output instead.
 */
function mergeDriverScriptPath(): string {
  const candidate = fileURLToPath(new URL("./merge-driver-cli.js", import.meta.url));
  if (existsSync(candidate)) return candidate;

  const distCandidate = candidate.replace(`${sep}src${sep}`, `${sep}dist${sep}`);
  if (existsSync(distCandidate)) return distCandidate;

  throw new Error(`Shared Memory merge driver script not found at "${candidate}" or "${distCandidate}" — build the package first.`);
}

function registerMergeDriver(repoRoot: string, worktreeDir: string, git: RunGit): void {
  const attributesPath = join(worktreeDir, ".gitattributes");
  const attributesContent = `${SHARED_MEMORY_RECORD_GLOBS.map((glob) => `${glob} merge=${MERGE_DRIVER_NAME}`).join("\n")}\n`;
  const existing = existsSync(attributesPath) ? readFileSync(attributesPath, "utf8") : "";
  if (existing !== attributesContent) {
    writeFileSync(attributesPath, attributesContent, "utf8");
  }

  git(repoRoot, ["config", `merge.${MERGE_DRIVER_NAME}.name`, MERGE_DRIVER_DISPLAY_NAME]);
  git(repoRoot, [
    "config",
    `merge.${MERGE_DRIVER_NAME}.driver`,
    `${JSON.stringify(process.execPath)} ${JSON.stringify(mergeDriverScriptPath())} %O %A %B`,
  ]);
}

function commitIfChanged(worktreeDir: string, git: RunGit, message: string): void {
  git(worktreeDir, ["add", "-A"]);
  if (hasStagedChanges(worktreeDir, git)) {
    git(worktreeDir, ["commit", "-m", message]);
  }
}

function assertGitAvailable(storageRoot: string, git: RunGit): void {
  try {
    git(storageRoot, ["--version"]);
  } catch (error) {
    throw new Error(
      `Shared Memory requires git, but it could not be run at "${storageRoot}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Clears `worktreeDir` for the checkout, first copying any pre-existing local-only content (a single-writer store predating opt-in) to a temp dir it returns. */
function clearExistingStore(worktreeDir: string): string | undefined {
  if (!existsSync(worktreeDir)) return undefined;
  let seedBackupDir: string | undefined;
  if (readdirSync(worktreeDir).length > 0) {
    seedBackupDir = mkdtempSync(join(tmpdir(), "raiminiscence-shared-memory-seed-"));
    cpSync(worktreeDir, seedBackupDir, { recursive: true });
  }
  rmSync(worktreeDir, { recursive: true, force: true });
  return seedBackupDir;
}

/** Checks out the Shared Memory branch at `worktreeDir`: fetched from origin when only the remote has it, created as an orphan when neither does. */
function checkOutSharedMemoryBranch(storageRoot: string, worktreeDir: string, git: RunGit): void {
  const hasRemoteBranch = branchExistsOnRemote(storageRoot, git, SHARED_MEMORY_BRANCH);
  const hasLocalBranch = branchExistsLocally(storageRoot, git, SHARED_MEMORY_BRANCH);

  if (hasRemoteBranch && !hasLocalBranch) {
    git(storageRoot, ["fetch", "origin", `${SHARED_MEMORY_BRANCH}:${SHARED_MEMORY_BRANCH}`]);
  }

  if (hasLocalBranch || hasRemoteBranch) {
    git(storageRoot, ["worktree", "add", worktreeDir, SHARED_MEMORY_BRANCH]);
  } else {
    git(storageRoot, ["worktree", "add", "--orphan", "-b", SHARED_MEMORY_BRANCH, worktreeDir]);
  }
}

/**
 * v11 (ADR-0017): one-time, idempotent setup that turns `.raiminiscence/memory/`
 * into a `git worktree` checkout of the dedicated `raiminiscence-memory`
 * orphan branch. Safe to call on every startup: a no-op once the worktree
 * already exists. Never silently no-ops on a missing/unreachable git binary
 * — sharing genuinely cannot work without git, so that case throws a clear
 * error instead.
 */
export function ensureSharedMemoryWorktree(storageRoot: string, git: RunGit = runGit): void {
  if (isSharedMemoryWorktree(storageRoot)) return;
  assertGitAvailable(storageRoot, git);

  const worktreeDir = memoryStoreDir(storageRoot);
  const seedBackupDir = clearExistingStore(worktreeDir);
  checkOutSharedMemoryBranch(storageRoot, worktreeDir, git);

  registerMergeDriver(storageRoot, worktreeDir, git);
  commitIfChanged(worktreeDir, git, "chore: register shared memory merge driver");

  if (seedBackupDir) {
    cpSync(seedBackupDir, worktreeDir, { recursive: true });
    rmSync(seedBackupDir, { recursive: true, force: true });
    commitIfChanged(worktreeDir, git, "chore: seed shared memory");
  }
}
