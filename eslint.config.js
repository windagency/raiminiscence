import checkFile from "eslint-plugin-check-file";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import tseslint from "typescript-eslint";

/**
 * Mechanically enforces CONTRIBUTING.md's CRITICAL "no unjustified `any`"
 * non-negotiable, CODING_RULES/03-typescript.md's no-parent-relative-imports
 * rule and its naming table (file names via `eslint-plugin-check-file`,
 * identifiers via `@typescript-eslint/naming-convention`), and the MEDIUM
 * "cyclomatic complexity ≤ 10" checklist item from
 * CODING_RULES/09-enforcement.md — not a full house style.
 * `no-explicit-any` is paired with `require-description` so an
 * `eslint-disable` comment must carry a reason, matching this repo's existing
 * "`any` needs a justifying comment" convention.
 */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "coverage/**"] },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "@eslint-community/eslint-comments": eslintComments,
      "check-file": checkFile,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@eslint-community/eslint-comments/require-description": "error",
      "check-file/filename-naming-convention": ["error", { "**/*.ts": "KEBAB_CASE" }, { ignoreMiddleExtensions: true }],
      // MEDIUM per CODING_RULES/09-enforcement.md's severity table ("fix in a fast
      // follow-up, not a blocker") — warn, not error, so it surfaces without
      // breaking `pnpm lint` for the functions already over the line.
      complexity: ["warn", 10],
      // CODING_RULES/03-typescript.md's naming table: PascalCase types with no `I` prefix,
      // camelCase functions, camelCase or UPPER_SNAKE_CASE variables (the latter for constants).
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "interface", format: ["PascalCase"], custom: { regex: "^I[A-Z]", match: false } },
        { selector: "function", format: ["camelCase"] },
        { selector: "variable", format: ["camelCase", "UPPER_CASE"], leadingUnderscore: "allow" },
      ],
    },
  },
  {
    // Scoped to each package's own src/test — this is about a package's internal module
    // graph (CODING_RULES/03-typescript.md). `benchmarks/`'s runner scripts deliberately
    // reach into other packages' internals for measurement, which is a different, out-of-scope
    // concern (there's no public-export alternative for what they measure).
    files: ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              message: "No parent-relative imports. Use the package's `#src/*` subpath import; `./` is fine within the same folder.",
            },
          ],
        },
      ],
    },
  },
);
