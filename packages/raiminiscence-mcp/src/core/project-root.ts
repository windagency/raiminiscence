import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseRaiminiscenceConfig } from "./config-schema.js";
import type { Scope, StorageLocation } from "./types.js";
import { fallbackLogger } from "#src/adapters/logger.js";

const MAX_WALK_DEPTH = 50;
const CONFIG_FILE_NAME = ".raiminiscence.config.json";

/**
 * Nearest `.git` directory walking up from `startDir`, bounded so a
 * pathological filesystem (or no repo at all) can't loop forever.
 * Falls back to `startDir` itself when no `.git` is found.
 */
export function detectProjectRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir);
}

export interface EmbeddingProviderConfig {
  provider?: "ollama" | "embedded";
  endpoint?: string;
  model?: string;
}

interface RaiminiscenceConfig {
  storageRoot?: string;
  embeddingProvider?: EmbeddingProviderConfig;
  sharedMemory?: boolean;
  watchedCommands?: string[];
}

function readConfig(dir: string): RaiminiscenceConfig | null {
  const configPath = join(dir, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parseRaiminiscenceConfig(parsed) as RaiminiscenceConfig;
  } catch (error) {
    // Hand-edited config, malformed JSON, or a shape the schema rejects
    // outright — degrades to "no config" (every resolver below falls back
    // to its own default), but that degrade used to be completely silent.
    fallbackLogger().warn(
      { configPath, error: error instanceof Error ? error.message : String(error) },
      "raiminiscence config file exists but failed to parse; ignoring it and using defaults",
    );
    return null;
  }
}

/**
 * The effective project-local storage root: the monorepo default is one
 * shared store at the repo root (nearest `.git`), but a subpackage can
 * opt into an isolated store by placing a `.raiminiscence.config.json`
 * with a `storageRoot` override in its own directory.
 */
export function resolveStorageRoot(startDir: string = process.cwd()): string {
  const config = readConfig(resolve(startDir));
  if (config?.storageRoot) {
    return resolve(startDir, config.storageRoot);
  }
  return detectProjectRoot(startDir);
}

/**
 * The embedding-provider config, read from the same
 * `.raiminiscence.config.json` file as the `storageRoot` override — no
 * second configuration mechanism. Resolves the `provider` discriminant:
 * an explicit `provider` always wins; otherwise a block that sets
 * `endpoint`/`model` but omits `provider` means `"ollama"` (v16 and
 * earlier's only provider, so an existing config's behaviour never
 * changes silently); otherwise (block absent, or present but empty)
 * means `"embedded"`, the new default (v17).
 */
export function resolveEmbeddingProviderConfig(startDir: string = process.cwd()): EmbeddingProviderConfig {
  const block = readConfig(resolve(startDir))?.embeddingProvider;
  if (block?.provider) return block;
  if (block?.endpoint !== undefined || block?.model !== undefined) return { ...block, provider: "ollama" };
  return { ...block, provider: "embedded" };
}

/**
 * v11 (ADR-0017): whether this project has opted into Shared Memory, read
 * from the same `.raiminiscence.config.json` as every other project-config
 * field. `false` by default — single-writer behaviour is unchanged unless a
 * project explicitly opts in.
 */
export function resolveSharedMemory(startDir: string = process.cwd()): boolean {
  return readConfig(resolve(startDir))?.sharedMemory ?? false;
}

/**
 * v18 (ADR-0023): the Fix Nudge Watched Command patterns, read from the same
 * `.raiminiscence.config.json` as every other project-config field. `[]` by
 * default — Fix Nudge is opt-in, unlike `sharedMemory`'s boolean opt-in. A
 * malformed entry (config is hand-edited, untyped JSON) is dropped rather
 * than passed through, since it's about to be compiled as a regex pattern.
 */
export function resolveWatchedCommands(startDir: string = process.cwd()): string[] {
  const configured = readConfig(resolve(startDir))?.watchedCommands ?? [];
  return Array.isArray(configured) ? configured.filter((pattern): pattern is string => typeof pattern === "string") : [];
}

function parseGitRemoteUrl(gitConfigContents: string): string | null {
  const match = gitConfigContents.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
  return match?.[1] ?? null;
}

function normalizeRemoteUrl(url: string): string {
  return url.replace(/\.git$/, "").replace(/\/$/, "");
}

/**
 * What a global-scope Memory records as its origin: the project's git
 * remote URL when one is configured, otherwise the absolute project-root
 * path — so a global Memory stays interpretable when recalled elsewhere.
 */
export function resolveOriginatingProject(projectRoot: string): string {
  const gitConfigPath = join(projectRoot, ".git", "config");
  if (existsSync(gitConfigPath)) {
    const remote = parseGitRemoteUrl(readFileSync(gitConfigPath, "utf8"));
    if (remote) return normalizeRemoteUrl(remote);
  }
  return resolve(projectRoot);
}

/**
 * Where a Scope actually reads/writes on disk. `storageRoot` is always the
 * calling session's project root (used for originatingProject regardless
 * of scope); a global-scope Memory instead lives under a fixed,
 * project-independent location so it's reachable from any project.
 */
export function effectiveStorageRoot(scope: Scope, location: StorageLocation): string {
  return scope === "global" ? (location.globalStorageRoot ?? homedir()) : location.storageRoot;
}

export interface ResolvedScope {
  scope: Scope;
  root: string;
}

/**
 * The single `params.scope ?? "project"` then `effectiveStorageRoot(...)`
 * shape every scope-aware tool repeats: resolves both the defaulted Scope
 * and where it actually reads/writes, in one call.
 */
export function resolveScope(location: StorageLocation & { scope?: Scope }): ResolvedScope {
  const scope = location.scope ?? "project";
  return { scope, root: effectiveStorageRoot(scope, location) };
}
