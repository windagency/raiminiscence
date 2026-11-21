import { RelativePath } from "arch-unit-ts/dist/arch-unit/core/domain/RelativePath.js";
import { TypeScriptProject } from "arch-unit-ts/dist/arch-unit/core/domain/TypeScriptProject.js";
import { describe, expect, it } from "vitest";

/**
 * arch-unit-ts's class-level DSL (`classes()`/`noClasses()`) matches on internal
 * project package paths, not bare npm specifiers — it has no built-in "only
 * importable from X" assertion for a third-party library. `TypeScriptClass.hasImport`
 * does resolve a bare specifier (confirmed empirically: it follows the same
 * module resolution ts-morph itself uses), so containment is asserted directly:
 * every class with the import, filtered down to its path, must equal the one
 * allowed adapter file.
 */
function classesImporting(rootSrc: string, specifier: string): string[] {
  const project = new TypeScriptProject(RelativePath.of(rootSrc));
  return project
    .allClasses()
    .get()
    .filter((klass) => klass.hasImport(specifier))
    .map((klass) => klass.getPath().get());
}

describe("raiminiscence-hooks architecture: third-party containment", () => {
  it("smol-toml is importable only from its TomlConfig adapter module", () => {
    expect(classesImporting("packages/raiminiscence-hooks/src", "smol-toml")).toEqual(["packages/raiminiscence-hooks/src/adapters/toml-config.ts"]);
  });
});
