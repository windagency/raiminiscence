import matter from "gray-matter";

/**
 * The one module allowed to import `gray-matter` — every frontmatter
 * parse/stringify in this codebase (`core/storage.ts`'s Memory file
 * read/write) goes through `parseFrontmatter`/`stringifyFrontmatter`
 * instead of calling the library directly, per the adapter-pattern
 * non-negotiable (`CODING_RULES/04-architecture.md`). Named for what it
 * does, not for the library behind it — mirroring `core/adapters/id.ts`'s
 * `generateId` — partly so a future swap of the underlying frontmatter
 * format wouldn't leak the name, and partly because a file named after the
 * library (e.g. `gray-matter.ts`) would make the containment test's
 * substring match on every importer's resolved import path false-positive
 * on itself.
 */
export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const parsed = matter(raw);
  return { data: parsed.data, content: parsed.content };
}

export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data);
}
