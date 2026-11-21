import { describe, expect, it } from "vitest";
import { WORKSPACE_PACKAGES, refersTo, specifiersByFile } from "./source-imports.js";

/**
 * The adapter rule (CONTRIBUTING.md's non-negotiables), checked on every form
 * of reference: static and type imports, re-exports, dynamic import(),
 * require(), and Node built-ins with or without the `node:` prefix. The
 * per-package arch-unit-ts suites assert the same containment on static
 * imports; this one closes the bypasses they can't see.
 */
const CONTAINED: { pkg: string; module: string; allowed: string[] }[] = [
  { pkg: "raiminiscence-mcp", module: "@modelcontextprotocol/sdk", allowed: ["adapters/mcp-server.ts"] },
  { pkg: "raiminiscence-mcp", module: "gray-matter", allowed: ["core/adapters/frontmatter.ts"] },
  { pkg: "raiminiscence-mcp", module: "pino", allowed: ["adapters/logger.ts"] },
  { pkg: "raiminiscence-mcp", module: "@opentelemetry/api", allowed: ["adapters/telemetry.ts"] },
  { pkg: "raiminiscence-mcp", module: "ulid", allowed: ["core/adapters/id.ts"] },
  { pkg: "raiminiscence-mcp", module: "@huggingface/transformers", allowed: ["core/adapters/feature-extraction.ts"] },
  { pkg: "raiminiscence-mcp", module: "child_process", allowed: ["core/adapters/detached-process.ts", "core/adapters/git.ts"] },
  { pkg: "raiminiscence-mcp", module: "net", allowed: ["core/adapters/local-socket.ts"] },
  { pkg: "raiminiscence-hooks", module: "smol-toml", allowed: ["adapters/toml-config.ts"] },
];

describe("workspace architecture: third-party containment, every import form", () => {
  for (const { pkg, module, allowed } of CONTAINED) {
    it(`${pkg}: ${module} is referenced only from ${allowed.join(", ")}`, () => {
      const referencing = [...specifiersByFile(pkg)]
        .filter(([, specifiers]) => specifiers.some((specifier) => refersTo(specifier, module)))
        .map(([file]) => file);
      expect(referencing).toEqual(allowed.map((path) => `packages/${pkg}/src/${path}`).sort());
    });
  }
});

/**
 * Zod is confined by file name rather than wrapped (ADR-0027): only a
 * `*-schema.ts` module may import it, and each exposes plain parse functions
 * or, for the MCP SDK's tool registration, raw input shapes.
 */
describe("workspace architecture: zod stays in *-schema.ts modules", () => {
  for (const pkg of WORKSPACE_PACKAGES) {
    it(`${pkg}: zod is referenced only from *-schema.ts files`, () => {
      const outside = [...specifiersByFile(pkg)]
        .filter(([file, specifiers]) => !file.endsWith("-schema.ts") && specifiers.some((specifier) => refersTo(specifier, "zod")))
        .map(([file]) => file);
      expect(outside).toEqual([]);
    });
  }
});
