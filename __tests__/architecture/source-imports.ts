import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";

/** The workspace's packages, read from `packages/` (each directory name matches its npm name). */
export const WORKSPACE_PACKAGES = readdirSync("packages", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join("packages", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

export interface ImportedBinding {
  file: string;
  specifier: string;
  /** Named bindings imported or re-exported from `specifier`; `*` for a namespace import or `export *`. */
  names: string[];
}

function sourceFiles(pkg: string): string[] {
  const srcDir = join("packages", pkg, "src");
  return (
    readdirSync(srcDir, { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ts"))
      // Forward slashes on Windows too, so paths compare equal on every OS.
      .map((entry) => join(srcDir, entry).split(sep).join("/"))
      .sort()
  );
}

/**
 * Every module specifier each file under `packages/<pkg>/src` references.
 * `ts.preProcessFile` sees static imports, `import type`, re-exports, side-effect
 * imports, dynamic `import()` and `require()`, and ignores comments and string
 * contents. That closes the two gaps arch-unit-ts's `hasImport` leaves: it only
 * sees static import declarations, and it matches resolved file paths, so a
 * Node built-in (`child_process`) never matches by name.
 */
export function specifiersByFile(pkg: string): Map<string, string[]> {
  return new Map(
    sourceFiles(pkg).map((file) => [file, ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((ref) => ref.fileName)]),
  );
}

/** True when `specifier` names `module` or one of its subpaths. A `node:` prefix is ignored, so `child_process` matches both forms. */
export function refersTo(specifier: string, module: string): boolean {
  const bare = specifier.replace(/^node:/, "");
  return bare === module || bare.startsWith(`${module}/`);
}

function importNames(statement: ts.ImportDeclaration): string[] {
  const bindings = statement.importClause?.namedBindings;
  if (!bindings) return [];
  return ts.isNamespaceImport(bindings) ? ["*"] : bindings.elements.map((el) => (el.propertyName ?? el.name).text);
}

function exportNames(statement: ts.ExportDeclaration): string[] {
  const clause = statement.exportClause;
  return !clause || ts.isNamespaceExport(clause) ? ["*"] : clause.elements.map((el) => (el.propertyName ?? el.name).text);
}

function toBinding(file: string, statement: ts.Statement): ImportedBinding[] {
  const specifier = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier;
  if (!specifier || !ts.isStringLiteral(specifier)) return [];
  const names = ts.isImportDeclaration(statement) ? importNames(statement) : exportNames(statement as ts.ExportDeclaration);
  return [{ file, specifier: specifier.text, names }];
}

/** Static imports and re-exports in `packages/<pkg>/src`, with the bindings each one pulls in. */
export function importedBindings(pkg: string): ImportedBinding[] {
  return sourceFiles(pkg).flatMap((file) =>
    ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest).statements.flatMap((statement) => toBinding(file, statement)),
  );
}
