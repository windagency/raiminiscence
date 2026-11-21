import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnDetached } from "./adapters/detached-process.js";
import type { EmbeddingProviderIdentity } from "./embeddings/provider.js";
import { storageRootHash } from "./recall-socket.js";

/**
 * ADR-0040: when no server answers, the per-turn hook starts a warm process
 * for its storage root, at most once per interval. This module never
 * imports the engine: it only decides whether to spawn, then spawns.
 */

/** The least time between two spawns for one storage root and model. */
export const WARM_SPAWN_INTERVAL_MS = 60_000;

/** The spawn marker, next to the recall socket and named by the same hash. */
export function warmMarkerPath(storageRoot: string, identity: EmbeddingProviderIdentity, home: string = homedir()): string {
  return join(home, ".raiminiscence", "run", `warm-${storageRootHash(storageRoot, identity)}.spawned`);
}

/** Creates `path` only if it doesn't exist, so one of several concurrent callers wins. */
function createExclusive(path: string): boolean {
  try {
    writeFileSync(path, "", { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** Whether this caller may spawn now: true at most once per interval for one marker. */
export function claimWarmSpawn(markerPath: string, now: number = Date.now()): boolean {
  mkdirSync(dirname(markerPath), { recursive: true, mode: 0o700 });
  if (createExclusive(markerPath)) return true;
  if (now - statSync(markerPath).mtimeMs < WARM_SPAWN_INTERVAL_MS) return false;
  rmSync(markerPath, { force: true });
  return createExclusive(markerPath);
}

export interface WarmSpawnRequest {
  storageRoot: string;
  identity: EmbeddingProviderIdentity;
  /** The warm process's entry point, `dist/warm.js`. */
  entry: string;
  home?: string;
  /** Injectable for testing; defaults to a detached, unref'd child. */
  spawn?: (command: string, args: string[]) => void;
}

/**
 * Spawns `node <entry> <storageRoot> <pid>` unless one was spawned within
 * the interval. The warm process waits for this pid to exit before loading
 * anything heavy. Never throws.
 */
export function spawnWarmProcess(request: WarmSpawnRequest): boolean {
  try {
    if (!claimWarmSpawn(warmMarkerPath(request.storageRoot, request.identity, request.home))) return false;
    (request.spawn ?? spawnDetached)(process.execPath, [request.entry, request.storageRoot, String(process.pid)]);
    return true;
  } catch {
    return false;
  }
}
