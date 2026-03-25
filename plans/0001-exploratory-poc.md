# Plan 0001: Exploratory PoC & Technical Validation

## Status
- **State:** Not Started
- **Priority:** P0 — Gate for all subsequent plans
- **Effort:** 1 day
- **Created:** 2026-03-25
- **Depends on:** 0000 (Project Bootstrap)

## Purpose

Throwaway spike to validate that ts-archunit can actually prevent the architecture rot documented in cmless plan 0212. The PoC uses fixtures modeled on real cmless code patterns — the exact pain points that motivated this project. If ts-archunit can express and evaluate these rules, we're good. If it can't, the spec needs fixing before we build anything.

Findings feed back into the plan set and may change API design, split/merge plans, or surface unknown risks.

## The 0212 Pain Points as Validation Targets

Plan 0212 (`cmless/plans/0212-sdk-list-endpoint-standardization.md`) documents six categories of architecture rot. Each maps to a ts-archunit rule. The PoC validates the four that are Phase 1 (no `calls()` / `within()` needed):

| # | 0212 Pain Point | ts-archunit Rule | Phase 1? | PoC Probe |
|---|---|---|---|---|
| 1 | Copy-pasted `parseXxxOrder()` functions | `functions().that().haveNameMatching(/^parse\w+Order$/).should().notExist()` | Yes | Probe 1 |
| 2 | Routes not using `normalizePagination()` | `within(listRoutes).functions().should().contain(call('normalizePagination'))` | No (Phase 2 — needs `calls()` + `within()`) | — |
| 3 | Inline `parseInt` instead of `this.extractCount()` | `classes().that().extend('BaseRepository').should().useInsteadOf(call('parseInt'), call('this.extractCount'))` | Yes | Probe 2 |
| 4 | `orderBy?: string` instead of typed union | `types().that().haveProperty('orderBy').should().havePropertyType('orderBy', not(isString()))` | Yes | Probe 3 |
| 5 | `throw new Error()` instead of typed domain errors | `classes().that().extend('BaseRepository').should().notContain(newExpr('Error'))` | Yes | Probe 2 |
| 6 | Manual `URLSearchParams` instead of `buildQueryString()` | `functions().that().resideInFolder('packages/sdk/src/wrappers/**').should().notContain(newExpr('URLSearchParams'))` | Yes | Probe 2 |

## Probe 1: Function Existence — "no per-resource order parsers"

**0212 context:** Seven different `parseXxxOrder()` functions exist across Cell and IG routes (parseContentTypeOrder, parseWebhookOrder, parseScheduledActionOrder, parseOrderParam, parseUsersOrder, parseSpacesOrder, parseOrgsOrder). All identical logic, different names.

**Risk:** Can ts-morph find top-level functions by name regex and assert none exist?

**Fixtures:**
```typescript
// fixtures/src/routes/content-types.ts
import { normalizePagination } from '../utils/pagination'

// BAD — should be caught by notExist() rule
function parseContentTypeOrder(order: string | undefined): {
  orderBy: 'created_at' | 'updated_at' | 'name'; orderDirection: 'asc' | 'desc'
} {
  let orderBy: 'created_at' | 'updated_at' | 'name' = 'name'
  let orderDirection: 'asc' | 'desc' = 'desc'
  if (order) {
    const isDesc = order.startsWith('-')
    const field = isDesc ? order.slice(1) : order
    const mapped = contentTypeOrderMap[field]
    if (mapped) { orderBy = mapped; orderDirection = isDesc ? 'desc' : 'asc' }
  }
  return { orderBy, orderDirection }
}

const contentTypeOrderMap: Record<string, string> = {
  'sys.createdAt': 'created_at', 'sys.updatedAt': 'updated_at', name: 'name'
}

// fixtures/src/routes/webhooks.ts
// BAD — same pattern, different name
function parseWebhookOrder(order: string | undefined): {
  orderBy: 'created_at' | 'updated_at' | 'name'; orderDirection: 'asc' | 'desc'
} {
  let orderBy: 'created_at' | 'updated_at' | 'name' = 'created_at'
  let orderDirection: 'asc' | 'desc' = 'desc'
  if (order) {
    const isDesc = order.startsWith('-')
    const field = isDesc ? order.slice(1) : order
    const mapped = webhookOrderMap[field]
    if (mapped) { orderBy = mapped; orderDirection = isDesc ? 'desc' : 'asc' }
  }
  return { orderBy, orderDirection }
}

const webhookOrderMap: Record<string, string> = {
  'sys.createdAt': 'created_at', 'sys.updatedAt': 'updated_at', name: 'name'
}

// fixtures/src/routes/users.ts
// GOOD — uses shared utility, no per-resource parser
import { parseOrder } from '../utils/parse-order'

const userOrderMap = { 'sys.createdAt': 'created_at' as const }

export function listUsers() {
  const { orderBy, orderDirection } = parseOrder(undefined, userOrderMap, {
    orderBy: 'created_at', orderDirection: 'desc'
  })
}
```

**What to build:**
1. Load fixtures with ts-morph `Project`
2. Find all `FunctionDeclaration` nodes across the project
3. Filter by name regex `/^parse\w+Order$/`
4. Also filter by folder `src/routes/**`
5. Assert: the matched set is non-empty (violations exist in bad fixtures), empty after "fixing"

**ts-archunit rule this validates:**
```typescript
functions(p)
  .that().haveNameMatching(/^parse\w+Order$/)
  .and().resideInFolder('src/routes/**')
  .should().notExist()
  .because('use the shared parseOrder() from @cmless/server-common')
  .check()
```

**Success criteria:** ts-morph can find `FunctionDeclaration` by name regex, filter by file path glob, and return the set. `notExist()` is trivial (empty set = pass). Also verify: does this catch `const parseWebhookOrder = (order: string) => { ... }` (arrow function assigned to const)? cmless uses both patterns.

## Probe 2: Body Analysis — "repositories must use extractCount, typed errors, no raw URLSearchParams"

**0212 context:** Four different inline count-parsing patterns exist when `this.extractCount()` exists in the base class. Also: `throw new Error()` instead of `throw new NotFoundError()`, and manual `new URLSearchParams()` in SDK wrappers.

**Risk:** Can ts-morph reliably match `call('parseInt')`, `call('this.extractCount')`, `newExpr('Error')`, `newExpr('URLSearchParams')` inside method bodies?

**Fixtures:**
```typescript
// fixtures/src/repositories/base.repository.ts
export abstract class BaseRepository {
  protected extractCount(result: { count: string | number }): number {
    return typeof result.count === 'string' ? parseInt(result.count, 10) : result.count
  }
}

// fixtures/src/repositories/webhook.repository.ts — BAD (3 violations)
import { BaseRepository } from './base.repository'

export class WebhookRepository extends BaseRepository {
  async query() {
    const countResult = await this.db.count('* as count').first()
    // Violation 1: inline parseInt instead of this.extractCount()
    const total = typeof countResult.count === 'string'
      ? parseInt(countResult.count, 10) : countResult.count
    return { total, items: [] }
  }

  async findById(id: string) {
    const result = await this.db.where({ id }).first()
    if (!result) {
      // Violation 2: generic Error instead of NotFoundError
      throw new Error(`Webhook '${id}' not found`)
    }
    return result
  }
}

// fixtures/src/repositories/role.repository.ts — GOOD
import { BaseRepository } from './base.repository'
import { NotFoundError } from '../exceptions/not-found-error'

export class RoleRepository extends BaseRepository {
  async query() {
    const result = await this.db.count('* as count').first()
    const total = this.extractCount(result)  // GOOD — uses shared helper
    return { total, items: [] }
  }

  async findById(id: string) {
    const result = await this.db.where({ id }).first()
    if (!result) {
      throw new NotFoundError('Role', id)  // GOOD — typed domain error
    }
    return result
  }
}

// fixtures/src/repositories/edge-cases.repository.ts — edge cases
import { BaseRepository } from './base.repository'

export class EdgeCaseRepository extends BaseRepository {
  // Optional chaining — should call('this.extractCount') match this?
  optionalChain() { return this?.extractCount(result) }

  // Destructured — should NOT match call('this.extractCount') in Phase 1
  destructured() {
    const { extractCount } = this
    return extractCount(result)
  }

  // Nested call — parseInt inside Math.max
  nested() { return Math.max(0, parseInt(val, 10)) }

  // Chained method — this.db.query().count()
  chained() { return this.db.query().count() }
}

// fixtures/src/wrappers/space.ts — BAD (URLSearchParams)
export class Space {
  async getWebhooks(query?: { skip?: number; limit?: number; order?: string }) {
    // Violation: manual URLSearchParams instead of buildQueryString()
    const params = new URLSearchParams()
    if (query?.skip) params.append('skip', String(query.skip))
    if (query?.limit) params.append('limit', String(query.limit))
    return this.http.get(`/webhooks?${params}`)
  }
}

// fixtures/src/wrappers/environment.ts — GOOD
import { buildQueryString } from '../utils/build-query-string'

export class Environment {
  async getEntries(query?: Record<string, unknown>) {
    const qs = buildQueryString(query ?? {})  // GOOD — uses shared utility
    return this.http.get(`/entries${qs}`)
  }
}
```

**What to build:**
1. Load fixtures with ts-morph
2. For each class extending `BaseRepository`, walk all method bodies
3. Find `CallExpression` nodes, match: `parseInt` (identifier), `this.extractCount` (property access chain)
4. Find `NewExpression` nodes, match: `Error`, `URLSearchParams`
5. Log: which matches succeed, which fail, AST structure for edge cases

**ts-archunit rules this validates:**
```typescript
// Rule 3: use extractCount instead of parseInt
classes(p)
  .that().extend('BaseRepository')
  .should().useInsteadOf(call('parseInt'), call('this.extractCount'))
  .because('use this.extractCount() from BaseRepository')
  .check()

// Rule 5: use typed domain errors
classes(p)
  .that().extend('BaseRepository')
  .should().notContain(newExpr('Error'))
  .because('use NotFoundError/ValidationError')
  .check()

// Rule 6: no manual URLSearchParams in SDK wrappers
functions(p)
  .that().resideInFolder('src/wrappers/**')
  .should().notContain(newExpr('URLSearchParams'))
  .because('use buildQueryString() utility')
  .check()
```

**Success criteria:**
- `call('parseInt')` matches in `WebhookRepository.query()` — both direct and nested inside `Math.max()`
- `call('this.extractCount')` matches in `RoleRepository.query()` and `EdgeCaseRepository.optionalChain()`
- `call('this.extractCount')` does NOT match in `EdgeCaseRepository.destructured()` (known Phase 1 limitation — document it)
- `newExpr('Error')` matches in `WebhookRepository.findById()`
- `newExpr('Error')` does NOT match `NotFoundError` (different constructor name)
- `newExpr('URLSearchParams')` matches in `Space.getWebhooks()`

## Probe 3: Type Checker — "orderBy must be typed union, not bare string"

**0212 context:** `RoleQueryOptions` has `orderBy?: string` (SQL injection surface) while `WebhookQueryOptions` has `orderBy?: 'created_at' | 'updated_at' | 'name'` (safe). Need to catch the bare `string` and allow unions.

**Risk:** Can the TypeScript type checker (via ts-morph) reliably distinguish `string` from `'a' | 'b'` when the property is optional (`string | undefined` vs `'a' | 'b' | undefined`)?

**Fixtures:**
```typescript
// fixtures/src/types/bad-options.ts
// FAIL — bare string (matches real cmless RoleQueryOptions)
export interface RoleQueryOptions {
  skip?: number
  limit?: number
  orderBy?: string          // SQL injection surface
  orderDirection?: 'asc' | 'desc'
}

// fixtures/src/types/good-options.ts
// PASS — typed union (matches real cmless WebhookQueryOptions)
export interface WebhookQueryOptions {
  skip?: number
  limit?: number
  orderBy?: 'created_at' | 'updated_at' | 'name'
  orderDirection?: 'asc' | 'desc'
}

// fixtures/src/types/aliased-options.ts
// PASS — union via type alias (common pattern)
export type ContentTypeOrderByColumn = 'created_at' | 'updated_at' | 'name' | 'cmless_id'

export interface ContentTypeQueryOptions {
  skip?: number
  limit?: number
  orderBy?: ContentTypeOrderByColumn
  orderDirection?: 'asc' | 'desc'
}

// fixtures/src/types/edge-cases.ts
// Edge cases for type checker
interface FullOptions {
  orderBy: 'created_at' | 'updated_at'   // non-optional
}
type PartialOptions = Partial<FullOptions>   // becomes orderBy?: 'created_at' | 'updated_at' | undefined

type PickedOptions = Pick<WebhookQueryOptions, 'orderBy'>  // should resolve through Pick

interface SingleLiteralOptions {
  orderBy?: 'created_at'                   // single string literal, not union — should PASS
}

interface NoOrderBy {
  skip?: number
  limit?: number
  // No orderBy property — should not be matched by haveProperty('orderBy')
}
```

**What to build:**
1. Load fixtures with ts-morph
2. Find all `InterfaceDeclaration` and `TypeAliasDeclaration` nodes whose name matches `/QueryOptions$/` or are in the test set
3. For each, get the `orderBy` property via `interface.getProperty('orderBy')`
4. Get the property's type via `property.getType()`
5. Test: `type.isString()`, `type.isUnion()`, `type.isStringLiteral()`, `type.getUnionTypes().map(t => t.isStringLiteral())`
6. Handle optionality: `orderBy?:` means the type is `string | undefined` or `'a' | 'b' | undefined` — need to strip `undefined` before checking

**Key question:** When we have `orderBy?: string`, the type checker sees `string | undefined`. Does `type.isString()` return `true` or `false`? We need to:
- Get the non-nullable type (strip `undefined`)
- Check if the remaining type is `string` (bad) or a union of string literals (good)

```typescript
// Pseudocode for the check
const prop = iface.getProperty('orderBy')
const type = prop.getType()
const nonNullable = type.getNonNullableType()  // strip undefined
const isBareString = nonNullable.isString()    // true for string, false for 'a' | 'b'
```

**ts-archunit rule this validates:**
```typescript
types(p)
  .that().haveNameMatching(/QueryOptions$/)
  .and().haveProperty('orderBy')
  .should().havePropertyType('orderBy', not(isString()))
  .because('bare string orderBy passed to .orderBy() is a SQL injection surface')
  .check()
```

**Success criteria:**
- `RoleQueryOptions.orderBy` (bare `string`) → detected as violation
- `WebhookQueryOptions.orderBy` (union `'created_at' | 'updated_at' | 'name'`) → passes
- `ContentTypeQueryOptions.orderBy` (via type alias `ContentTypeOrderByColumn`) → passes (type checker resolves alias)
- `PartialOptions.orderBy` (via `Partial<>`) → passes (type checker resolves Partial)
- `PickedOptions.orderBy` (via `Pick<>`) → passes (type checker resolves Pick)
- `SingleLiteralOptions.orderBy` (single string literal) → passes (it's a literal, not bare `string`)
- `NoOrderBy` → not matched by `.haveProperty('orderBy')` predicate (correctly excluded)

## Probe 4: Performance Baseline

**Risk:** ts-morph is known to be slow on large projects. The spec claims <3s for 500 files / 50 rules. Need a baseline.

**What to build:**
1. Generate a fixture project with ~500 small TypeScript files:
   - 40 classes extending `BaseRepository` (with methods containing various call patterns)
   - 40 `*QueryOptions` interfaces (mix of typed/untyped orderBy)
   - 30 route files with functions (some matching `parse*Order` pattern)
   - 390 filler files (realistic imports, classes, functions)
2. Measure: `new Project({ tsConfigFilePath })` loading time (cold)
3. Measure: scanning all classes for `extend('BaseRepository')` predicate
4. Measure: body analysis on all methods of matched classes
5. Measure: type checker query on all interfaces with `orderBy` property
6. Compare: eager loading all files vs lazy loading (parse on first access)

**Success criteria:** Loading + rules 1,3,4,5 combined completes in <5s. If it doesn't, identify the bottleneck (parsing? type checking? walking?) and document mitigation strategies for plan 0002.

## Probe 5: API Ergonomics

**Risk:** The fluent DSL reads well in the spec but may feel awkward when typing real rules.

**What to build:**
Write a `poc.test.ts` file with rules against the fixtures from Probes 1-3. Use vitest. These are the **actual rules** that would go in a cmless `arch.test.ts`:

```typescript
import { describe, it } from 'vitest'

// Minimal hand-wired versions of the DSL — just enough to test the chain feel
const p = project('fixtures/tsconfig.json')

describe('Repository Standards (from 0212 audit)', () => {
  const repositories = classes(p).that().extend('BaseRepository')

  it('must use extractCount() instead of parseInt', () => {
    repositories
      .should().useInsteadOf(call('parseInt'), call('this.extractCount'))
      .because('use this.extractCount() from BaseRepository')
      .check()
  })

  it('must use typed domain errors', () => {
    repositories
      .should().notContain(newExpr('Error'))
      .because('use NotFoundError/ValidationError from exceptions package')
      .check()
  })
})

describe('Type Safety (from 0212 audit)', () => {
  it('QueryOptions.orderBy must be a typed union, not bare string', () => {
    types(p)
      .that().haveNameMatching(/QueryOptions$/)
      .and().haveProperty('orderBy')
      .should().havePropertyType('orderBy', not(isString()))
      .because('bare string orderBy passed to .orderBy() is a SQL injection surface')
      .check()
  })
})

describe('Route Consistency (from 0212 audit)', () => {
  it('no per-resource order parsers', () => {
    functions(p)
      .that().haveNameMatching(/^parse\w+Order$/)
      .and().resideInFolder('src/routes/**')
      .should().notExist()
      .because('use the shared parseOrder() from @cmless/server-common')
      .check()
  })
})

describe('SDK Wrapper Standards (from 0212 audit)', () => {
  it('must not use raw URLSearchParams', () => {
    functions(p)
      .that().resideInFolder('src/wrappers/**')
      .should().notContain(newExpr('URLSearchParams'))
      .because('use buildQueryString() utility')
      .check()
  })
})

// Phase 2 rule (not validated in PoC, but included to test the chain feel)
// describe('Route Handler Standards (from 0212 audit)', () => {
//   const listRoutes = calls(p)
//     .that().onObject('app')
//     .and().withMethod(/^(get)$/)
//
//   it('must use normalizePagination()', () => {
//     within(listRoutes)
//       .functions().should().contain(call('normalizePagination'))
//       .because('no manual Number()/|| 100/Math.min')
//       .check()
//   })
// })
```

**Success criteria:**
- The rules read naturally — they describe the 0212 pain points in a way someone familiar with the codebase would immediately understand
- Named selections (`const repositories = classes(p).that()...`) feel right for reuse
- `.because()` messages map cleanly to the rationale from 0212
- No awkward gaps in the chain
- If something feels off, document the alternative and feed it back into the spec

## Fixture Project Structure

```
poc/
├── fixtures/
│   ├── tsconfig.json
│   ├── src/
│   │   ├── domain/
│   │   │   └── user.ts                        # interface User, no repo imports
│   │   ├── exceptions/
│   │   │   └── not-found-error.ts             # class NotFoundError extends Error
│   │   ├── repositories/
│   │   │   ├── base.repository.ts             # abstract class with extractCount()
│   │   │   ├── webhook.repository.ts          # BAD: parseInt, throw new Error
│   │   │   ├── role.repository.ts             # GOOD: this.extractCount, NotFoundError
│   │   │   └── edge-cases.repository.ts       # optional chaining, destructured, nested
│   │   ├── types/
│   │   │   ├── bad-options.ts                 # RoleQueryOptions: orderBy?: string
│   │   │   ├── good-options.ts                # WebhookQueryOptions: orderBy?: 'a' | 'b'
│   │   │   ├── aliased-options.ts             # via type alias, Partial<>, Pick<>
│   │   │   └── edge-cases.ts                  # single literal, no orderBy
│   │   ├── routes/
│   │   │   ├── content-types.ts               # BAD: parseContentTypeOrder()
│   │   │   ├── webhooks.ts                    # BAD: parseWebhookOrder()
│   │   │   ├── users.ts                       # GOOD: uses shared parseOrder()
│   │   │   └── bad-route.ts                   # imports from repositories (layer violation)
│   │   ├── wrappers/
│   │   │   ├── space.ts                       # BAD: new URLSearchParams()
│   │   │   └── environment.ts                 # GOOD: uses buildQueryString()
│   │   └── utils/
│   │       ├── parse-order.ts                 # shared parseOrder() utility
│   │       ├── pagination.ts                  # normalizePagination()
│   │       └── build-query-string.ts          # buildQueryString()
├── probes/
│   ├── probe1-function-existence.ts           # find functions by name regex + folder
│   ├── probe2-body-analysis.ts                # call(), newExpr() matching in method bodies
│   ├── probe3-type-checker.ts                 # havePropertyType with isString() / unions
│   ├── probe4-performance.ts                  # 500-file generated project
│   └── probe5-api-ergonomics.test.ts          # vitest file with real 0212 rules
└── findings.md                                # Results doc — go/no-go + API design feedback
```

## Deliverables

1. **Fixture project** — models real cmless code patterns from plan 0212
2. **Probe scripts** — standalone ts scripts for probes 1-4, vitest file for probe 5
3. **`findings.md`** — results document with:
   - Per-probe results: what works, what doesn't, edge case behavior
   - Performance numbers: loading time, per-rule time, type checker overhead
   - API ergonomics: does the fluent chain feel right for 0212-style rules?
   - Edge case inventory: optional chaining, destructured calls, arrow functions, const functions
   - Go/no-go recommendation for the current plan set
   - Specific adjustments to plans 0001-0013 if needed

## What This Is NOT

- Not production code. The PoC is thrown away after findings are extracted.
- Not a complete implementation. Only the minimal ts-morph code needed to answer the five probes.
- Not a benchmark suite. Performance numbers are ballpark, not rigorous.

## Out of Scope

- `calls()` entry point / `within()` — Phase 2, validates pain point #2 (normalizePagination in route handlers). Not needed for PoC because the other 5 pain points cover all the risky ts-morph operations.
- Slice/cycle detection — well-understood algorithm (Tarjan's SCC), no ts-morph risk
- GraphQL extension — Phase 3, separate parser, no interaction with core
- CLI runner — trivial, no risk
- Custom predicates API — pure interface design, no ts-morph risk
- Violation formatting / code frames — string manipulation, no risk
- Smell detectors — built on same body analysis primitives validated in Probe 2
