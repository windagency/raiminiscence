import { RelativePath } from "arch-unit-ts/dist/arch-unit/core/domain/RelativePath.js";
import { TypeScriptProject } from "arch-unit-ts/dist/arch-unit/core/domain/TypeScriptProject.js";

/**
 * arch-unit-ts's class-level DSL (`classes()`/`noClasses()`) matches on internal
 * project package paths, not bare npm specifiers or specific file targets — it
 * has no built-in "only importable from X" assertion. `TypeScriptClass.hasImport`
 * resolves a search string against each dependency's *resolved target file path*
 * (confirmed empirically against this repo), so containment is asserted
 * directly: collect every class with a matching import, then assert on that set.
 */
export function classesImporting(rootSrc: string, specifier: string): string[] {
  const project = new TypeScriptProject(RelativePath.of(rootSrc));
  return project
    .allClasses()
    .get()
    .filter((klass) => klass.hasImport(specifier))
    .map((klass) => klass.getPath().get());
}
