import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./adapters/frontmatter.js";
import { ALL_MEMORY_KINDS, type Memory, type MemoryKind } from "./types.js";
import { parseMemoryFrontmatter } from "./memory-frontmatter-schema.js";
import { invalidateCachedRecords } from "./recall-cache.js";
import { OperationalError } from "./errors.js";
import { fallbackLogger } from "#src/adapters/logger.js";

const KIND_DIRS: Record<MemoryKind, string> = {
  episodic: "episodic",
  semantic: "semantic",
  decision: "decisions",
  checkpoint: "checkpoints",
};

export function memoryStoreDir(storageRoot: string): string {
  return join(storageRoot, ".raiminiscence", "memory");
}

export function kindDir(storageRoot: string, kind: MemoryKind): string {
  return join(memoryStoreDir(storageRoot), KIND_DIRS[kind]);
}

function memoryFilePath(storageRoot: string, kind: MemoryKind, id: string): string {
  return join(kindDir(storageRoot, kind), `${id}.md`);
}

function serialize(memory: Memory): string {
  // gray-matter's stringify only accepts an untyped Record<string, unknown>; MemoryFrontmatter's
  // structural shape is otherwise fully assignable, so this is a signature mismatch, not real type erasure.
  return stringifyFrontmatter(memory.body, memory.frontmatter as unknown as Record<string, unknown>);
}

/** The Memory in a file, or `null` (with a warning) when its frontmatter fails validation, so one bad file can't break the store. */
function readMemoryFile(path: string): Memory | null {
  const parsed = parseFrontmatter(readFileSync(path, "utf8"));
  const frontmatter = parseMemoryFrontmatter(parsed.data);
  if (!frontmatter) {
    fallbackLogger().warn({ path }, "memory file frontmatter failed validation; skipping it");
    return null;
  }
  return { frontmatter, body: parsed.content.replace(/^\n+/, "").replace(/\n+$/, "") };
}

/**
 * v14 (ADR-0021): bumps the records cache's version marker on every write —
 * an automatic safety net beneath the whole memory-file layer, independent
 * of whether the caller (`remember`, `consolidate`, or code that writes a
 * Memory file directly, e.g. a test fixture) knows the cache exists. See
 * `recall-cache.ts`'s `invalidateCache` doc comment.
 */
export function writeMemory(storageRoot: string, memory: Memory): void {
  const dir = kindDir(storageRoot, memory.frontmatter.kind);
  mkdirSync(dir, { recursive: true });
  ensureGitignoreEntry(storageRoot);
  writeFileSync(memoryFilePath(storageRoot, memory.frontmatter.kind, memory.frontmatter.id), serialize(memory), "utf8");
  invalidateCachedRecords(storageRoot);
}

export function readMemory(storageRoot: string, kind: MemoryKind, id: string): Memory | null {
  const path = memoryFilePath(storageRoot, kind, id);
  if (!existsSync(path)) return null;
  return readMemoryFile(path);
}

export function deleteMemory(storageRoot: string, kind: MemoryKind, id: string): void {
  const path = memoryFilePath(storageRoot, kind, id);
  if (existsSync(path)) {
    unlinkSync(path);
    invalidateCachedRecords(storageRoot);
  }
}

export function findMemoryById(storageRoot: string, id: string): { kind: MemoryKind; memory: Memory } | null {
  for (const kind of ALL_MEMORY_KINDS) {
    const memory = readMemory(storageRoot, kind, id);
    if (memory) return { kind, memory };
  }
  return null;
}

/** Finds a Memory by id, or throws the shared "no such Memory" error every id-accepting tool rejects an unknown id with. */
function requireMemoryById(storageRoot: string, id: string): { kind: MemoryKind; memory: Memory } {
  const found = findMemoryById(storageRoot, id);
  if (!found) {
    throw new OperationalError(`No memory found with id "${id}"`);
  }
  return found;
}

/** Validates an id exists, for a tool that only needs the existence check (e.g. before recording a Conflict Edge). */
export function assertMemoryExists(storageRoot: string, id: string): void {
  requireMemoryById(storageRoot, id);
}

/**
 * Finds a Memory by id, hands it to `mutator` to change in place, then
 * always persists it — the shared find-or-throw/mutate/write cycle a
 * single-id mutation needs, mirroring `record-index.ts`'s `withRecord`
 * for Memory files instead of index records.
 */
export function mutateMemoryById<TResult>(storageRoot: string, id: string, mutator: (memory: Memory) => TResult): TResult {
  const found = requireMemoryById(storageRoot, id);
  const result = mutator(found.memory);
  writeMemory(storageRoot, found.memory);
  return result;
}

export function readAllMemories(storageRoot: string, kinds: MemoryKind[] = ALL_MEMORY_KINDS): Memory[] {
  return kinds
    .map((kind) => kindDir(storageRoot, kind))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => readMemoryFile(join(dir, file))),
    )
    .filter((memory): memory is Memory => memory !== null);
}

/**
 * `.raiminiscence/` holds per-developer working memory, not team-shared
 * history, so it's excluded from version control by default (opt-in
 * sharing is a manual, deliberate git add by the developer).
 */
export function ensureGitignoreEntry(projectRoot: string): void {
  if (!existsSync(join(projectRoot, ".git"))) return;
  const gitignorePath = join(projectRoot, ".gitignore");
  const entry = ".raiminiscence/";
  if (existsSync(gitignorePath)) {
    const contents = readFileSync(gitignorePath, "utf8");
    if (contents.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === ".raiminiscence")) {
      return;
    }
    appendFileSync(gitignorePath, `${contents.endsWith("\n") || contents === "" ? "" : "\n"}${entry}\n`);
  } else {
    writeFileSync(gitignorePath, `${entry}\n`);
  }
}
