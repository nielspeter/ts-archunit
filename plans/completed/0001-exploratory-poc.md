# Plan 0001: Exploratory PoC & Technical Validation

## Status

- **State:** Complete
- **Priority:** P0 — Gate for all subsequent plans
- **Effort:** 0.5 day
- **Created:** 2026-03-25
- **Completed:** 2026-03-25
- **Depends on:** 0000 (Project Bootstrap)

### Result: GO

All three probes pass (28 tests). ts-morph can support the spec's DSL. See `poc/findings.md` for details.

### Deviations from plan

1. **`@types/node` needed** — added as devDependency for `node:path` and `import.meta.dirname` in test files
2. **Fixtures excluded from ESLint** — fixture files have intentional violations (async without await, unbound methods). Added `tests/fixtures/**` to ESLint ignores.
3. **Adjustments for future plans** documented in findings: (a) plan 0009 must handle const arrow functions, (b) plan 0010 must strip undefined before type checks, (c) plan 0011 must handle optional chaining in call matching.

## Purpose

Validate that ts-morph can support the core capabilities ts-archunit needs. Three capabilities, three probes:

| Capability | Spec reference | Probe |
| --- | --- | --- |
| **Find elements by name/location** — functions, classes, interfaces matched by regex and file path glob | Predicates (Section 5) | Probe 1 |
| **Inspect method bodies** — detect specific calls (`parseInt`, `this.normalizeCount`), constructors (`new Error`, `new URLSearchParams`), and property access chains inside function/method bodies | Body Analysis (Section 6.3) | Probe 2 |
| **Query the type system** — distinguish `string` from `'a' \| 'b'`, resolve through type aliases, `Partial<>`, `Pick<>`, and optional properties | Type-Level Conditions (Section 6.4) | Probe 3 |

If ts-morph can do these three things reliably, the spec's DSL is implementable. If it can't, we need to adjust the spec before building anything.

Findings feed back into the plan set and may change API design, split/merge plans, or surface unknown risks.

## Fixture Project

A self-contained mini-project in `tests/fixtures/poc/` with its own `tsconfig.json`. Models a small REST API backend — services with a shared base class, route handlers, and typed query options. Realistic enough to exercise ts-morph, generic enough to not be tied to any specific project.

### `tests/fixtures/poc/tsconfig.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "noEmit": true
  },
  "include": ["src"]
}
```

### `tests/fixtures/poc/src/base-service.ts`

Abstract base class with a helper method — mirrors the "use shared utility instead of inline code" pattern.

```typescript
export abstract class BaseService {
  protected db: Record<string, unknown> = {}

  protected normalizeCount(result: { count: string | number }): number {
    return typeof result.count === 'string'
      ? parseInt(result.count, 10)
      : result.count
  }

  protected toError(entity: string, id: string): never {
    throw new DomainError(`${entity} '${id}' not found`)
  }
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}
```

### `tests/fixtures/poc/src/good-service.ts`

Uses the shared helpers — should pass all rules.

```typescript
import { BaseService, DomainError } from './base-service.js'

export class OrderService extends BaseService {
  async getTotal(): Promise<number> {
    const result = { count: '42' }
    return this.normalizeCount(result)
  }

  async findById(id: string) {
    const result = this.db[id]
    if (!result) {
      throw new DomainError(`Order '${id}' not found`)
    }
    return result
  }

  async search(query: string) {
    const items = Object.values(this.db)
    return items.filter((item) => JSON.stringify(item).includes(query))
  }
}
```

### `tests/fixtures/poc/src/bad-service.ts`

Violates the patterns — inline parseInt, generic Error, manual URLSearchParams.

```typescript
import { BaseService } from './base-service.js'

export class ProductService extends BaseService {
  async getTotal(): Promise<number> {
    const result = { count: '42' }
    // BAD: inline parseInt instead of this.normalizeCount()
    return typeof result.count === 'string'
      ? parseInt(result.count, 10)
      : result.count
  }

  async findById(id: string) {
    const result = this.db[id]
    if (!result) {
      // BAD: generic Error instead of DomainError
      throw new Error(`Product '${id}' not found`)
    }
    return result
  }

  async buildUrl(params: Record<string, string>): Promise<string> {
    // BAD: manual URLSearchParams
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      search.append(key, value)
    }
    return `/products?${search.toString()}`
  }
}
```

### `tests/fixtures/poc/src/edge-cases.ts`

Edge cases for body analysis — optional chaining, destructured methods, nested calls, chained calls.

```typescript
import { BaseService } from './base-service.js'

export class EdgeCaseService extends BaseService {
  // Optional chaining — does getText() return 'this?.normalizeCount' or 'this.normalizeCount'?
  withOptionalChain() {
    const result = { count: '5' }
    return this?.normalizeCount(result)
  }

  // Destructured — should NOT match 'this.normalizeCount' (no this prefix)
  withDestructuring() {
    const { normalizeCount } = this
    const result = { count: '5' }
    return normalizeCount.call(this, result)
  }

  // Nested — parseInt buried inside other calls
  withNesting() {
    return Math.max(0, parseInt(String(Math.random()), 10))
  }

  // Chained — method calls on returned objects
  withChaining() {
    return [1, 2, 3].map(String).filter(Boolean).join(',')
  }

  // Multiple violations in one method
  withMultiple() {
    const count = parseInt('10', 10)
    const search = new URLSearchParams()
    search.append('count', String(count))
    throw new Error('not implemented')
  }
}
```

### `tests/fixtures/poc/src/routes.ts`

Functions matching a naming pattern — tests function existence by regex + file location.

```typescript
// BAD: per-resource parsers (copy-paste pattern)
export function parseFooOrder(order: string | undefined) {
  const isDesc = order?.startsWith('-') ?? false
  const field = isDesc ? order!.slice(1) : order
  return { field: field ?? 'created_at', direction: isDesc ? 'desc' : 'asc' }
}

export function parseBarOrder(order: string | undefined) {
  const isDesc = order?.startsWith('-') ?? false
  const field = isDesc ? order!.slice(1) : order
  return { field: field ?? 'name', direction: isDesc ? 'desc' : 'asc' }
}

// BAD: const arrow function variant (same pattern, different syntax)
export const parseBazOrder = (order: string | undefined) => {
  const isDesc = order?.startsWith('-') ?? false
  const field = isDesc ? order!.slice(1) : order
  return { field: field ?? 'updated_at', direction: isDesc ? 'desc' : 'asc' }
}

// GOOD: no parseXxxOrder function — uses shared utility
export function listItems() {
  return []
}

// GOOD: different naming pattern — should not match /^parse\w+Order$/
export function parseConfig(raw: string) {
  return JSON.parse(raw)
}
```

### `tests/fixtures/poc/src/options.ts`

Interfaces for type checker testing — bare string vs typed union vs aliases vs utility types.

```typescript
// BAD: bare string — the type checker should flag this
export interface UnsafeOptions {
  sortBy?: string
  direction?: 'asc' | 'desc'
}

// GOOD: typed union
export interface SafeOptions {
  sortBy?: 'created_at' | 'updated_at' | 'name'
  direction?: 'asc' | 'desc'
}

// GOOD: via type alias
export type SortColumn = 'created_at' | 'updated_at' | 'price'

export interface AliasedOptions {
  sortBy?: SortColumn
  direction?: 'asc' | 'desc'
}

// Edge case: Partial wrapping a required property
interface StrictOptions {
  sortBy: 'created_at' | 'updated_at'
}
export type PartialStrictOptions = Partial<StrictOptions>

// Edge case: Pick from another interface
export type PickedOptions = Pick<SafeOptions, 'sortBy'>

// Edge case: single string literal (not a union, but not bare string)
export interface SingleLiteralOptions {
  sortBy?: 'created_at'
}

// Edge case: no sortBy property at all
export interface UnrelatedOptions {
  limit?: number
  offset?: number
}

// Edge case: string literal union with undefined explicitly
export interface ExplicitUndefinedOptions {
  sortBy: 'a' | 'b' | undefined
}
```

## Probe 1: Function Existence

**Risk:** Can ts-morph find functions by name regex, filter by file path, and handle both `function` declarations and `const` arrow functions?

**Test file:** `tests/poc/probe1-function-existence.test.ts`

**Assertions:**

1. Load `tests/fixtures/poc/` with ts-morph `Project`
2. Get all `FunctionDeclaration` nodes across all source files
3. Filter by name regex `/^parse\w+Order$/` — expect `parseFooOrder`, `parseBarOrder`
4. Verify `listItems` and `parseConfig` are NOT matched
5. Get all `VariableDeclaration` nodes with arrow function initializers
6. Filter by name regex `/^parse\w+Order$/` — expect `parseBazOrder`
7. Filter by file path glob `**/routes.*` — verify all three are in `routes.ts`

**Key question:** What's the cleanest way to find both `function parseFooOrder()` and `const parseBazOrder = () => {}`? This directly informs plan 0009 (Function Entry Point).

## Probe 2: Body Analysis

**Risk:** Can ts-morph reliably match `CallExpression` and `NewExpression` nodes inside method bodies?

**Test file:** `tests/poc/probe2-body-analysis.test.ts`

**Assertions:**

### Finding classes by extends
1. Find all classes where `getExtends()?.getExpression().getText() === 'BaseService'` — expect `OrderService`, `ProductService`, `EdgeCaseService`

### CallExpression matching
2. `ProductService.getTotal()` — find `parseInt` via `getDescendantsOfKind(SyntaxKind.CallExpression)`, match `getExpression().getText() === 'parseInt'`
3. `OrderService.getTotal()` — find `this.normalizeCount` call, match `getExpression().getText() === 'this.normalizeCount'`
4. `OrderService.getTotal()` — verify NO `parseInt` call exists
5. `EdgeCaseService.withOptionalChain()` — check what `getText()` returns for `this?.normalizeCount(result)` (is it `'this?.normalizeCount'` or `'this.normalizeCount'`?)
6. `EdgeCaseService.withDestructuring()` — verify the call expression is `normalizeCount.call`, NOT `this.normalizeCount`
7. `EdgeCaseService.withNesting()` — verify `parseInt` is found even when nested inside `Math.max(0, parseInt(...))`

### NewExpression matching
8. `ProductService.findById()` — find `new Error(...)`, match `getExpression().getText() === 'Error'`
9. `OrderService.findById()` — find `new DomainError(...)`, verify expression text is `'DomainError'` not `'Error'`
10. `ProductService.buildUrl()` — find `new URLSearchParams()`
11. `OrderService` — verify NO `NewExpression` with text `'URLSearchParams'` or `'Error'`
12. `EdgeCaseService.withMultiple()` — verify both `parseInt` and `new Error` and `new URLSearchParams` are found in the same method

**Success criteria:**
- `CallExpression` matching by identifier and property access works
- `NewExpression` matching correctly distinguishes `Error` from `DomainError`
- Optional chaining behavior documented
- Destructured calls correctly identified as a different pattern

## Probe 3: Type Checker

**Risk:** Can the type checker distinguish `string` from `'a' | 'b'` through optional properties, aliases, and utility types?

**Test file:** `tests/poc/probe3-type-checker.test.ts`

**Assertions:**

1. Load `tests/fixtures/poc/` with ts-morph (needs tsconfig for type resolution)
2. For each interface/type, get `sortBy` property and check its type:

| Type | `getNonNullableType().isString()` | Expected |
| --- | --- | --- |
| `UnsafeOptions.sortBy` | `true` | VIOLATION — bare string |
| `SafeOptions.sortBy` | `false` | pass — union of literals |
| `AliasedOptions.sortBy` | `false` | pass — alias resolves to union |
| `PartialStrictOptions.sortBy` | `false` | pass — Partial resolves |
| `PickedOptions.sortBy` | `false` | pass — Pick resolves |
| `SingleLiteralOptions.sortBy` | `false` | pass — single literal, not string |
| `UnrelatedOptions` | N/A | no `sortBy` property |
| `ExplicitUndefinedOptions.sortBy` | `false` | pass — union of literals + undefined |

3. Also verify for unions: `getNonNullableType().isUnion()` returns `true` and each union member `isStringLiteral()` returns `true`

**Key questions to answer:**
- Does `getNonNullableType()` correctly strip `undefined` from optional properties?
- Does `isString()` return `false` for a union of string literals?
- Do `Partial<>` and `Pick<>` resolve before we check?
- What about `ExplicitUndefinedOptions` where `undefined` is explicit, not from `?:`?

## Deliverables

1. **Fixture files** in `tests/fixtures/poc/` — generic, reusable
2. **Three probe test files** in `tests/poc/` — vitest tests with assertions
3. **`poc/findings.md`** — results document with:
   - Per-probe results: what works, what doesn't, edge case behavior
   - Exact ts-morph API calls needed for each operation
   - Edge case inventory with behavior documented
   - Go/no-go recommendation for the current plan set
   - Specific adjustments to plans 0002-0013 if needed

## Deferred to Later Plans

- **Performance baseline** → plan 0002 (Query Engine)
- **Fluent DSL ergonomics** → observation in findings.md, tested properly in plan 0005
- **Domain-specific fixtures** → plans 0007+ when testing the actual library entry points

## Out of Scope

- `calls()` entry point / `within()` — Phase 2
- Slice/cycle detection — well-understood algorithm, no ts-morph risk
- GraphQL extension — Phase 3
- CLI runner — trivial
- Custom predicates API — pure interface design
- Violation formatting / code frames — string manipulation
- Smell detectors — same body analysis primitives as Probe 2
- Building the fluent DSL — plans 0003-0005
