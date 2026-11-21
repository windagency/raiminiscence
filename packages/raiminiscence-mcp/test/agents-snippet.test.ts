import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const snippetDocPath = fileURLToPath(new URL("../docs/agents-md-snippet.md", import.meta.url));

function extractMarkdownSnippetBlock(doc: string): string {
  const match = doc.match(/```markdown\n([\s\S]*?)```/);
  if (!match) throw new Error("No ```markdown block found in agents-md-snippet.md");
  return match[1]!;
}

describe("AGENTS.md/CLAUDE.md fallback snippet", () => {
  const doc = readFileSync(snippetDocPath, "utf8");
  const snippet = extractMarkdownSnippetBlock(doc);

  it("references the public recall/overview tools", () => {
    expect(snippet).toMatch(/\brecall\b/);
    expect(snippet).toMatch(/\boverview\b/);
  });

  it("references remember for capturing decisions/patterns/corrections", () => {
    expect(snippet).toMatch(/\bremember\b/);
  });

  it("instructs the agent to populate relatedFiles for file-anchored Decision Memories", () => {
    expect(snippet).toMatch(/\brelatedFiles\b/);
  });

  it("never depends on the hooks package's internal shim", () => {
    expect(snippet).not.toMatch(/shim/i);
    expect(snippet).not.toMatch(/raiminiscence-hooks/i);
  });

  it("documents itself as the universal fallback regardless of raiminiscence-hooks", () => {
    expect(doc).toMatch(/universal fallback/i);
  });
});
