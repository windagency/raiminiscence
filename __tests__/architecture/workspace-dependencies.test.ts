import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_PACKAGES } from "./source-imports.js";

/**
 * docs/architecture/hld.md, "Package boundaries": hooks and cli each depend on
 * raiminiscence-mcp and raiminiscence-argv, and "these are the only
 * inter-package dependencies in the monorepo". Checked on the manifests, every
 * dependency field included, because an import of an undeclared workspace
 * package doesn't resolve and is invisible to the source-level tests.
 */
const ALLOWED: Record<string, string[]> = {
  "raiminiscence-argv": [],
  "raiminiscence-mcp": [],
  "raiminiscence-hooks": ["raiminiscence-argv", "raiminiscence-mcp"],
  "raiminiscence-cli": ["raiminiscence-argv", "raiminiscence-mcp"],
};

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function workspaceDependencies(pkg: string): string[] {
  const manifest = JSON.parse(readFileSync(join("packages", pkg, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
  const names = DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}));
  return [...new Set(names.filter((name) => WORKSPACE_PACKAGES.includes(name)))].sort();
}

describe("workspace architecture: inter-package dependencies", () => {
  it("knows every package under packages/, so a new one has to be added to the allowed list", () => {
    expect(Object.keys(ALLOWED).sort()).toEqual([...WORKSPACE_PACKAGES].sort());
  });

  for (const pkg of WORKSPACE_PACKAGES) {
    it(`${pkg} depends only on ${ALLOWED[pkg]?.join(" and ") || "no other workspace package"}`, () => {
      expect(workspaceDependencies(pkg)).toEqual(ALLOWED[pkg]);
    });
  }
});
