import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importedBindings, specifiersByFile } from "./source-imports.js";

const MCP = "raiminiscence-mcp";
const CONSUMERS = ["raiminiscence-hooks", "raiminiscence-cli"];

/**
 * The subpaths raiminiscence-mcp's `exports` declares, such as ADR-0039's
 * light `raiminiscence-mcp/recall-client`. A declared entry is a library
 * export like the root one; anything else (`dist/server.js`, `src/...`) is
 * reaching into the package.
 */
const declaredSubpaths = Object.keys((JSON.parse(readFileSync(`packages/${MCP}/package.json`, "utf8")) as { exports?: object }).exports ?? {})
  .filter((key) => key !== ".")
  .map((key) => `${MCP}/${key.slice(2)}`);

/**
 * docs/architecture/hld.md, "Package boundaries": hooks and cli depend on
 * raiminiscence-mcp "for its library exports only — never for the MCP server
 * itself". The package's index.ts re-exports the server too, so the rule is
 * enforced on what consumers pull in, not only on where they import it from.
 */
const serverExports = importedBindings(MCP)
  .filter((binding) => binding.file.endsWith("/src/index.ts") && binding.specifier === "./server.js")
  .flatMap((binding) => binding.names);

describe("workspace architecture: hooks and cli use raiminiscence-mcp as a library only", () => {
  it("finds the server's re-exports in raiminiscence-mcp's index.ts (a canary against checking nothing)", () => {
    expect(serverExports.length).toBeGreaterThan(0);
  });

  it("declares no subpath that points into dist/server.js or src/", () => {
    const manifest = JSON.parse(readFileSync(`packages/${MCP}/package.json`, "utf8")) as { exports?: Record<string, { default?: string }> };
    const targets = Object.values(manifest.exports ?? {}).map((entry) => entry.default ?? "");
    expect(targets.filter((target) => target.endsWith("/server.js") || target.includes("/src/"))).toEqual([]);
  });

  for (const pkg of CONSUMERS) {
    it(`${pkg} never imports an undeclared raiminiscence-mcp subpath (dist/server.js, src/...)`, () => {
      const deep = [...specifiersByFile(pkg)].flatMap(([file, specifiers]) =>
        specifiers
          .filter((specifier) => specifier.startsWith(`${MCP}/`) && !declaredSubpaths.includes(specifier))
          .map((specifier) => `${file}: ${specifier}`),
      );
      expect(deep).toEqual([]);
    });

    it(`${pkg} never imports the MCP server's exports, or all of raiminiscence-mcp at once`, () => {
      const offending = importedBindings(pkg)
        .filter((binding) => binding.specifier === MCP)
        .flatMap((binding) => binding.names.filter((name) => name === "*" || serverExports.includes(name)).map((name) => `${binding.file}: ${name}`));
      expect(offending).toEqual([]);
    });

    it(`${pkg} never loads raiminiscence-mcp through a dynamic import() or require()`, () => {
      const staticCounts = new Map<string, number>();
      for (const binding of importedBindings(pkg).filter((b) => b.specifier === MCP)) {
        staticCounts.set(binding.file, (staticCounts.get(binding.file) ?? 0) + 1);
      }
      const dynamic = [...specifiersByFile(pkg)]
        .filter(([file, specifiers]) => specifiers.filter((specifier) => specifier === MCP).length > (staticCounts.get(file) ?? 0))
        .map(([file]) => file);
      expect(dynamic).toEqual([]);
    });
  }
});
