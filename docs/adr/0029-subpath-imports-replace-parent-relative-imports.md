# Cross-folder imports go through each package's `#src/*` subpath import

[Back to docs/adr/README.md](README.md) • [Back to developer-guide.md](../developer-guide.md)

`CODING_RULES/03-typescript.md` required absolute imports, with relative ones allowed only within the same folder, and named `tsconfig.json` `paths` as the mechanism and `import/no-relative-parent-imports` as the enforcement. Neither existed. ESLint only banned `../../` chains, so 19 single-level `../` imports sat in `raiminiscence-mcp/src`, every test reached its source through `../src/`, and `core/logger.ts` existed only to dodge the two-level ban.

`tsconfig.json` `paths` can't be the fix on its own: plain `tsc`, the only build step here, doesn't rewrite them, so the published JavaScript would fail to resolve.

## Decision

Each package declares a Node [subpath import](https://nodejs.org/api/packages.html#subpath-imports) in its `package.json`:

```json
"imports": { "#src/*": { "source": "./src/*", "default": "./dist/*" } }
```

- Node, at runtime, takes `default` and loads `dist/`.
- TypeScript maps `dist/` back to `src/` through `outDir`/`rootDir`, so builds and type-checks need no extra configuration.
- Vitest sets the `source` condition (`vitest.config.ts`), so tests run against source, never a stale build. It also sets `node`, but not Vite's other default server conditions: their `module` condition picks `@opentelemetry/api`'s extensionless ESM build, which Node can't load.
- `scripts/build-codemap.ts` resolves with `NodeNext` and the `source` condition, so codemap import edges survive.

ESLint's `no-restricted-imports` now rejects every `../` specifier under `packages/*/src` and `packages/*/test`. `./` stays allowed within one folder. `core/logger.ts` is deleted; modules import `#src/adapters/logger.js` directly.

## Considered options

- **Relax the rule to allow one `../` level.** Rejected by the operator: it would have matched the code to the lint config rather than to the rule.
- **`paths` plus a build-time rewriter such as `tsc-alias`.** Rejected: a new dev dependency and build step for what Node already does natively.

## Consequences

- `benchmarks/` keeps its relative imports into `packages/*/src`: it measures package internals and sits outside the lint scope, as before.
- The `source` mapping points at `src/`, which isn't published. Node never selects it unless a consumer passes `--conditions=source`.
