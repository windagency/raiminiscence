# TypeScript Standards

[Back to 09-enforcement.md](09-enforcement.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0029-subpath-imports-replace-parent-relative-imports.md](../docs/adr/0029-subpath-imports-replace-parent-relative-imports.md)

Load when touching `.ts` / `.tsx` source.

## Quick reference

| Area | Rule | Enforced by |
|---|---|---|
| Classes/interfaces | PascalCase noun, no `I` prefix | `@typescript-eslint/naming-convention` |
| Functions | camelCase verb (noun if value-returning) | ESLint |
| Files | kebab-case | `eslint-plugin-check-file` |
| Constants | `UPPER_SNAKE_CASE` | ESLint |
| Imports | `#src/*` subpath imports; `./` only within the same folder | `no-restricted-imports` |
| Types | `interface` for extensible objects, `type` for unions/primitives | ESLint |
| `any` | forbidden without a comment justifying it | `@typescript-eslint/no-explicit-any` |
| Value mappings | object literal lookup over `switch`/`if-else` | code review |

## Naming

```typescript
// correct
class UserRepository {}
interface PaymentGateway {}
function calculateTotal() {}
function userName() {} // value-returning, noun is fine

// wrong
class userRepository {}      // case
interface IPaymentGateway {} // Hungarian prefix
function get() {}            // not descriptive
```

## `interface` vs `type`

Use `interface` for anything meant to be extended (`extends`) or implemented. Use `type` for unions, primitives, and mapped/utility types. Lean on `Partial`, `Pick`, `Omit`, `Record` rather than re-declaring shapes.

## Type inference

Trust inference for internal implementation details. Require explicit types at the boundary:

- Function **parameters** — always explicit.
- **Exported/public** function return types — always explicit; it's the contract.
- **Internal/private** function return types — let TypeScript infer.
- Class properties — explicit.
- A widened literal you intend to reassign later (`let status: 'a' | 'b' = 'a'`) — explicit.

```typescript
// internal helper — inferred
function calculateDiscount(price: number, pct: number) {
	return price * (pct / 100);
}

// public API — explicit
export function calculateTotal(items: CartItem[]): number {
	return items.reduce((sum, i) => sum + i.price, 0);
}
```

## Object literal lookups over switch/if-else

Use a lookup table for simple value mappings. Reserve `switch`/`if-else` for branches with side effects, multiple conditions per case, or structural pattern matching.

```typescript
// correct
const statusColors = { pending: 'yellow', active: 'green', inactive: 'gray' } as const;
const getStatusColor = (s: keyof typeof statusColors) => statusColors[s];

// wrong — simple value mapping in a switch
function getStatusColor(status: string) {
	switch (status) {
		case 'pending': return 'yellow';
		// ...
	}
}
```

## Conditional object construction

Build the object once with conditional spreads. Don't mutate it after construction.

```typescript
// correct
const config = { required: 'value', ...(optional && { key: optional }) };

// wrong
const config = { required: 'value' };
if (optional) config.key = optional;
```

## Data structures

`Set` for unique collections, `Map` for non-string-keyed lookups — not a plain array with `.includes()` checks, and not a plain object used as a hash map (its keys get coerced to strings).

## Path aliases

No parent-relative imports. Reach another folder of the same package through its `#src/*` [subpath import](https://nodejs.org/api/packages.html#subpath-imports), declared in the package's `package.json` `imports` field. Relative imports are fine only within the same folder (`./helper`). Never `../`.

```typescript
// correct
import { memoryStoreDir } from "#src/core/storage.js";
import { helper } from "./helper.js";

// wrong
import { memoryStoreDir } from "../storage.js";
```

Each mapping resolves to `src/` under the `source` condition, which Vitest sets, and to `dist/` by default, which Node uses at runtime. TypeScript maps `dist/` back to `src/` itself, so builds need no extra configuration. Not `tsconfig.json` `paths`: plain `tsc` doesn't rewrite them, so the published JavaScript would fail to resolve.

## Functional iteration over imperative loops

Prefer `map` / `filter` / `reduce` / `find` / `some` / `every` / `flatMap`, chained for multi-step transforms.

Imperative `for` / `for...of` is acceptable for: early exit combined with a side effect, performance-critical tight loops where profiling shows a real bottleneck, or control flow with several distinct branches per iteration.

For async work: `Promise.all` for parallel operations, `for...of` with `await` for sequential ones. Never `forEach` with an `async` callback — it does not wait for it.
