import type { Memory } from "./types.js";
import { readAllMemories } from "./storage.js";
import { isActive } from "./memory-view.js";
import type { CommitSubjects } from "./git.js";

export interface CommitInvalidationFlag {
  memory: Memory;
  triggeringTarget: string;
}

/**
 * v9 (ADR-0014): rejects a trivial or overly common extracted target before
 * any matching runs. More load-bearing here than it would be for a
 * fuzzy-matching approach, precisely because plain substring matching was
 * chosen over one.
 */
const MIN_TARGET_LENGTH = 3;
const STOPWORD_TARGETS = new Set(["the", "a", "an", "it", "its", "this", "that", "these", "those", "old", "new", "code"]);

/**
 * The four recognised commit-subject shapes (ADR-0014), tried in this
 * order, each capturing the outgoing target X — never the incoming
 * replacement Y.
 */
const EXTRACTION_PATTERNS: RegExp[] = [
  /\b(?:migrate|switch|move|convert|transition|upgrade)\b.*?\bfrom\s+(.+?)\s+to\s+.+$/i,
  /\breplace\s+(.+?)\s+with\s+.+$/i,
  /\bdeprecate\s+(.+?)\s*$/i,
  /\b(?:remove|drop)\s+(.+?)\s*$/i,
];

function cleanTarget(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.,:;!?]+$/g, "")
    .trim();
}

function extractTarget(subject: string): string | null {
  for (const pattern of EXTRACTION_PATTERNS) {
    const match = subject.match(pattern);
    const captured = match?.[1];
    if (!captured) continue;
    const target = cleanTarget(captured);
    if (target) return target;
  }
  return null;
}

function passesGuardrail(target: string): boolean {
  return target.length >= MIN_TARGET_LENGTH && !STOPWORD_TARGETS.has(target.toLowerCase());
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive, word-boundary-aware substring match against a Memory's full body. */
function bodyMentionsTarget(memory: Memory, target: string): boolean {
  const pattern = new RegExp(`\\b${escapeForRegExp(target)}\\b`, "i");
  return pattern.test(memory.body);
}

/**
 * Commit Invalidation candidates (v9, ADR-0014): every currently-active
 * Memory of any Kind whose `relatedFiles` is `null` or empty — the exact
 * complement of `eligibleForInvalidation`'s own "anchored" test — whose
 * full body mentions the outgoing target extracted from a qualifying
 * commit subject dated after that Memory's own `createdAt`.
 * `commitSubjects` is queried once for the whole pass, not once per Memory.
 */
export function eligibleForCommitInvalidation(storageRoot: string, commitSubjects: CommitSubjects): CommitInvalidationFlag[] {
  const qualifyingCommits = commitSubjects(storageRoot)
    .map((commit) => ({ timestamp: new Date(commit.timestamp), target: extractTarget(commit.subject) }))
    .filter((commit): commit is { timestamp: Date; target: string } => commit.target !== null && passesGuardrail(commit.target));

  const flagged: CommitInvalidationFlag[] = [];
  for (const memory of readAllMemories(storageRoot)) {
    if (!isActive(memory)) continue;
    const relatedFiles = memory.frontmatter.relatedFiles;
    if (relatedFiles && relatedFiles.length > 0) continue;

    const createdAt = new Date(memory.frontmatter.createdAt);
    const triggering = qualifyingCommits.find((commit) => commit.timestamp > createdAt && bodyMentionsTarget(memory, commit.target));
    if (triggering) flagged.push({ memory, triggeringTarget: triggering.target });
  }
  return flagged;
}
