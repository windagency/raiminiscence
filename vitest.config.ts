import { defineConfig } from "vitest/config";

export default defineConfig({
  // Each package's `#src/*` subpath import resolves to its `src/` under the "source" condition
  // and to `dist/` by default, so tests run against source, never a stale build. Not Vite's
  // default server conditions: their "module" picks @opentelemetry/api's extensionless ESM build.
  ssr: { resolve: { conditions: ["source", "node"] } },
  test: {
    // The arch-unit-ts tests parse a whole package with the TypeScript compiler per test. Under v8
    // coverage on a loaded runner that passes the 5s default, so the ceiling is raised for every test.
    testTimeout: 20_000,
    setupFiles: ["./packages/raiminiscence-mcp/test/stub-embedding-model.setup.ts"],
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/*/__tests__/architecture/**/*.test.ts",
      "__tests__/architecture/**/*.test.ts",
      "__tests__/scripts/**/*.test.ts",
      "benchmarks/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      // The shipped packages only. Benchmarks and repo tooling (scripts/, release and
      // lint configs) aren't published and would otherwise dilute the figure.
      // .ts only: src/ also holds JSON/TOML hook templates, which the v8 provider can't parse.
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text-summary", "html"],
      // CODING_RULES/09-enforcement.md's "> 60%" target, measured across every
      // package's src/. Only enforced when `--coverage` is passed (the `test:coverage`
      // script and CI), not on `pnpm test` or a single-file run, so local iteration
      // and AGENTS.md's single-file command stay fast and unaffected.
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
});
