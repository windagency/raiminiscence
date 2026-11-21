#!/usr/bin/env tsx
/**
 * Regenerates docs/codemap.json, docs/codemap.md, and docs/codemap.html: an
 * AST-derived index of every named function, class, interface, type alias,
 * and top-level constant across both packages' `src/` trees (test/dist
 * excluded). codemap.html is a self-contained, searchable/filterable
 * visualizer with the data inlined — open it directly in a browser.
 *
 * Usage: `pnpm codemap` (from the repo root).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleKind, ModuleResolutionKind, Node, Project } from "ts-morph";
import type { ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, SourceFile, TypeAliasDeclaration, VariableStatement } from "ts-morph";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

type SymbolKind = "function" | "class" | "interface" | "typeAlias" | "const";

interface SymbolEntry {
  kind: SymbolKind;
  name: string;
  exported: boolean;
  line: number;
  signature: string;
  doc?: string;
}

interface FileEntry {
  path: string;
  package: string;
  symbols: SymbolEntry[];
  /** Repo-relative paths of other codemap files this file imports from or re-exports. */
  imports: string[];
}

const MAX_SIGNATURE_LENGTH = 160;

function truncate(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

function docSummary(node: Node): string | undefined {
  if (!Node.isJSDocable(node)) return undefined;
  const jsDocs = node.getJsDocs();
  if (jsDocs.length === 0) return undefined;
  const description = jsDocs[jsDocs.length - 1]!.getDescription().trim();
  return description ? truncate(description, MAX_SIGNATURE_LENGTH) : undefined;
}

function functionSignature(node: FunctionDeclaration): string {
  const name = node.getName() ?? "(anonymous)";
  const typeParams = node.getTypeParameters().map((tp) => tp.getText());
  const typeParamsText = typeParams.length > 0 ? `<${typeParams.join(", ")}>` : "";
  const params = node
    .getParameters()
    .map((p) => p.getText())
    .join(", ");
  const returnType = node.getReturnTypeNode()?.getText();
  const asyncPrefix = node.isAsync() ? "async " : "";
  return truncate(`${asyncPrefix}function ${name}${typeParamsText}(${params})${returnType ? `: ${returnType}` : ""}`, MAX_SIGNATURE_LENGTH);
}

function packageNameOf(relPath: string): string {
  return relPath.split("/")[1] ?? "(root)";
}

type DeclarationNode = ClassDeclaration | FunctionDeclaration | InterfaceDeclaration | TypeAliasDeclaration;

function declarationSymbol(node: DeclarationNode, kind: SymbolKind, name: string, signature: string): SymbolEntry {
  return {
    kind,
    name,
    exported: node.isExported(),
    line: node.getStartLineNumber(),
    signature: truncate(signature, MAX_SIGNATURE_LENGTH),
    doc: docSummary(node),
  };
}

function heritageSuffix(node: ClassDeclaration | InterfaceDeclaration): string {
  const heritage = node
    .getHeritageClauses()
    .map((h) => h.getText())
    .join(" ");
  return heritage ? ` ${heritage}` : "";
}

function variableSymbols(node: VariableStatement): SymbolEntry[] {
  const exported = node.isExported();
  const doc = docSummary(node);
  return node.getDeclarations().map((decl) => {
    const typeNode = decl.getTypeNode();
    return {
      kind: "const",
      name: decl.getName(),
      exported,
      line: decl.getStartLineNumber(),
      signature: truncate(`const ${decl.getName()}${typeNode ? `: ${typeNode.getText()}` : ""}`, MAX_SIGNATURE_LENGTH),
      doc,
    };
  });
}

/** The codemap entries one top-level statement declares: none for anything but a named declaration. */
function symbolsOf(node: Node): SymbolEntry[] {
  if (Node.isFunctionDeclaration(node)) {
    const name = node.getName();
    return name ? [{ ...declarationSymbol(node, "function", name, ""), signature: functionSignature(node) }] : [];
  }
  if (Node.isClassDeclaration(node)) {
    const name = node.getName();
    return name ? [declarationSymbol(node, "class", name, `class ${name}${heritageSuffix(node)}`)] : [];
  }
  if (Node.isInterfaceDeclaration(node)) {
    return [declarationSymbol(node, "interface", node.getName(), `interface ${node.getName()}${heritageSuffix(node)}`)];
  }
  if (Node.isTypeAliasDeclaration(node)) {
    return [declarationSymbol(node, "typeAlias", node.getName(), `type ${node.getName()} = ${node.getTypeNode()?.getText() ?? "?"}`)];
  }
  if (Node.isVariableStatement(node)) return variableSymbols(node);
  return [];
}

function collectSymbols(sourceFile: SourceFile): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  sourceFile.forEachChild((node) => {
    symbols.push(...symbolsOf(node));
  });
  return symbols.sort((a, b) => a.line - b.line);
}

/** Resolves a file's relative import/re-export specifiers to other codemap files it links to. */
function collectLocalImports(sourceFile: SourceFile, ownPath: string, knownPaths: Set<string>): string[] {
  const targets = new Set<string>();
  const specifierSources = [
    ...sourceFile.getImportDeclarations().map((d) => d.getModuleSpecifierSourceFile()),
    ...sourceFile.getExportDeclarations().map((d) => d.getModuleSpecifierSourceFile()),
  ];
  for (const target of specifierSources) {
    if (!target) continue;
    const relPath = relative(REPO_ROOT, target.getFilePath());
    if (relPath !== ownPath && knownPaths.has(relPath)) targets.add(relPath);
  }
  return [...targets].sort();
}

function buildFileEntries(): FileEntry[] {
  // NodeNext plus the "source" condition, so each package's `#src/*` subpath imports resolve to src/.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext, customConditions: ["source"] },
  });
  const sourceFiles = project.addSourceFilesAtPaths(join(REPO_ROOT, "packages/*/src/**/*.ts"));

  const candidates: { relPath: string; symbols: SymbolEntry[]; sourceFile: SourceFile }[] = [];
  for (const sourceFile of sourceFiles) {
    const relPath = relative(REPO_ROOT, sourceFile.getFilePath());
    const symbols = collectSymbols(sourceFile);
    if (symbols.length > 0) candidates.push({ relPath, symbols, sourceFile });
  }

  const knownPaths = new Set(candidates.map((c) => c.relPath));
  const entries = candidates.map(({ relPath, symbols, sourceFile }) => ({
    path: relPath,
    package: packageNameOf(relPath),
    symbols,
    imports: collectLocalImports(sourceFile, relPath, knownPaths),
  }));

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function renderMarkdown(files: FileEntry[]): string {
  const lines: string[] = [
    "# Codemap",
    "",
    "Generated by `pnpm codemap` (`scripts/build-codemap.ts`) — **do not hand-edit**. " +
      "Re-run after adding, removing, or renaming a top-level symbol. " +
      "See [`codemap.json`](./codemap.json) for the machine-readable form.",
    "",
  ];

  const byPackage = new Map<string, FileEntry[]>();
  for (const file of files) {
    const list = byPackage.get(file.package) ?? [];
    list.push(file);
    byPackage.set(file.package, list);
  }

  for (const [pkg, pkgFiles] of [...byPackage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${pkg}`, "");
    for (const file of pkgFiles) {
      lines.push(`### \`${file.path}\``, "");
      if (file.imports.length > 0) {
        lines.push(`Imports: ${file.imports.map((p) => `\`${p}\``).join(", ")}`, "");
      }
      lines.push("| Kind | Name | Exported | Line | Signature |", "| --- | --- | --- | --- | --- |");
      for (const symbol of file.symbols) {
        const signature = symbol.signature.replace(/\|/g, "\\|");
        lines.push(`| ${symbol.kind} | ${symbol.name} | ${symbol.exported ? "yes" : ""} | ${symbol.line} | \`${signature}\` |`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

/** Serialises a value for embedding inside an inline `<script>` tag, defusing `</script>` breakout. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Renders a self-contained HTML page: a zoomable circle-packing diagram
 * (repo → package → file → symbol) built with D3, with the codemap data
 * inlined so the file works standalone (no fetch, no build step). The
 * static shell/styles/client-side script live in `codemap-template.html`
 * (kept separate so the D3 diagram code isn't buried in this file's
 * symbol-extraction logic, and so it can be edited as plain HTML/CSS/JS).
 */
function renderHtml(files: FileEntry[], generatedAt: string): string {
  const dataBlob = jsonForScript({ generatedAt, files });
  const template = readFileSync(join(REPO_ROOT, "scripts", "codemap-template.html"), "utf8");
  return template.replace("__CODEMAP_DATA_JSON__", () => dataBlob);
}

function main(): void {
  const files = buildFileEntries();
  const symbolCount = files.reduce((sum, file) => sum + file.symbols.length, 0);
  const generatedAt = new Date().toISOString();

  const docsDir = join(REPO_ROOT, "docs");
  mkdirSync(docsDir, { recursive: true });

  writeFileSync(join(docsDir, "codemap.json"), `${JSON.stringify({ generatedAt, files }, null, 2)}\n`, "utf8");
  writeFileSync(join(docsDir, "codemap.md"), renderMarkdown(files), "utf8");
  writeFileSync(join(docsDir, "codemap.html"), renderHtml(files, generatedAt), "utf8");

  console.log(`Wrote docs/codemap.json, docs/codemap.md, and docs/codemap.html (${files.length} files, ${symbolCount} symbols).`);
}

main();
