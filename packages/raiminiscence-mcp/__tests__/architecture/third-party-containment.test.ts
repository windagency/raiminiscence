import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classesImporting } from "./helpers.js";

const MCP_SRC = "packages/raiminiscence-mcp/src";

describe("raiminiscence-mcp architecture: third-party containment", () => {
  it("@modelcontextprotocol/sdk is importable only from adapters/mcp-server.ts", () => {
    const importers = classesImporting(MCP_SRC, "@modelcontextprotocol/sdk");
    expect(importers).toEqual(["packages/raiminiscence-mcp/src/adapters/mcp-server.ts"]);
  });

  it("gray-matter is importable only from core/adapters/frontmatter.ts", () => {
    const importers = classesImporting(MCP_SRC, "gray-matter");
    expect(importers).toEqual(["packages/raiminiscence-mcp/src/core/adapters/frontmatter.ts"]);
  });

  it("pino is importable only from adapters/logger.ts", () => {
    const importers = classesImporting(MCP_SRC, "pino");
    expect(importers).toEqual(["packages/raiminiscence-mcp/src/adapters/logger.ts"]);
  });

  it("@opentelemetry/api is importable only from adapters/telemetry.ts", () => {
    const importers = classesImporting(MCP_SRC, "@opentelemetry/api");
    expect(importers).toEqual(["packages/raiminiscence-mcp/src/adapters/telemetry.ts"]);
  });

  it("ulid is importable only from core/adapters/id.ts", () => {
    const importers = classesImporting(MCP_SRC, "ulid");
    expect(importers).toEqual(["packages/raiminiscence-mcp/src/core/adapters/id.ts"]);
  });

  /**
   * `core/adapters/feature-extraction.ts` reaches `@huggingface/transformers`
   * via a dynamic `await import(...)`, deliberately (so the ONNX runtime only
   * loads when the Embedded Provider is actually used) — but
   * arch-unit-ts's dependency graph is built from `ts-morph`'s
   * `getImportDeclarations()`, which only sees static `import ... from`
   * statements, never dynamic `import()` expressions (confirmed empirically:
   * `hasImport` returns false for a dynamic import even though it's the one
   * legitimate user). A source-text search is the only way to actually
   * enforce this containment rule against both dynamic and static imports.
   */
  it("@huggingface/transformers is referenced only from core/adapters/feature-extraction.ts", () => {
    const files = readdirSync(MCP_SRC, { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ts"))
      .map((entry) => join(MCP_SRC, entry));
    const referencing = files.filter((path) => readFileSync(path, "utf8").includes("@huggingface/transformers"));
    expect(referencing).toEqual(["packages/raiminiscence-mcp/src/core/adapters/feature-extraction.ts"]);
  });

  /**
   * `node:child_process` is a built-in, not an npm package, so unlike
   * gray-matter/the SDK above, `classesImporting`'s `hasImport` can't see it
   * at all here: it matches on each import's *resolved source file path*
   * (confirmed empirically against this repo), and a built-in resolves
   * against `@types/node`'s ambient declaration file, not a path containing
   * "child_process" — `hasImport("node:child_process")` returns `[]` even
   * though three files import it. A source-text search is the only way to
   * actually enforce this containment rule, mirroring the transformers case.
   */
  it("node:child_process is importable only from core/adapters/git.ts and core/adapters/detached-process.ts", () => {
    const files = readdirSync(MCP_SRC, { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ts"))
      .map((entry) => join(MCP_SRC, entry));
    const referencing = files.filter((path) => readFileSync(path, "utf8").includes("node:child_process"));
    expect(referencing.sort()).toEqual([
      "packages/raiminiscence-mcp/src/core/adapters/detached-process.ts",
      "packages/raiminiscence-mcp/src/core/adapters/git.ts",
    ]);
  });
});
