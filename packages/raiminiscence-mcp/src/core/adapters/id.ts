import { ulid } from "ulid";

/**
 * The one module allowed to import `ulid` — every id generation in this
 * codebase (`server.ts`'s `callId`/`sessionId`, `core/create-frontmatter.ts`'s
 * memory `id`, `core/writer-identity.ts`'s default `sessionId`) goes through
 * `generateId` instead of calling the library directly, per the
 * adapter-pattern non-negotiable (`CODING_RULES/04-architecture.md`). Named
 * for what it does, not for the library behind it — mirroring
 * `core/adapters/git.ts`'s `runGitSync`/`runGitAsyncRaw` — partly so a
 * future swap of the underlying id scheme wouldn't leak the name, and partly
 * because a file named after the library (e.g. `ulid.ts`) would make the
 * containment test's substring match on every importer's resolved import
 * path false-positive on itself.
 */
export function generateId(): string {
  return ulid();
}
