# Plan 0015: Named Selections, `within()` & Scoped Rules

## Status

- **State:** Not Started
- **Priority:** P2 — Enables context-scoped enforcement; key for framework-specific rules
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0014 (Call Entry Point), 0005 (Rule Builder — fork-on-should), 0009 (Function Entry Point / ArchFunction)

## Purpose

Add `within(selection)` — a scoping mechanism that restricts the search space of a rule to elements found inside the callbacks of matched call expressions. This turns framework-specific pattern enforcement from "scan every function in the project" to "scan only the callback functions inside matched route handlers."

Named selections already work today. The `RuleBuilder.should()` method forks the builder (plan 0005), so saving a predicate chain and calling `.should()` multiple times produces independent rules that share the same filter:

```typescript
const repositories = classes(p).that().extend('BaseRepository')
repositories.should().notContain(call('parseInt')).check()   // rule 1
repositories.should().notContain(newExpr('Error')).check()    // rule 2 (independent)
```

What does NOT work is scoping — "within these matched call sites, apply rules to the callback functions." That is what this plan adds.

### The Problem `within()` Solves

Consider Express/Fastify route handlers:

```typescript
app.get('/users', authenticate, async (req, res) => {
  const { skip, limit } = normalizePagination(req.query)
  // ...
})

app.post('/orders', authenticate, async (req, res) => {
  const skip = Number(req.query.skip) || 0   // BAD: should use normalizePagination
  // ...
})
```

Without `within()`, the rule "route handler callbacks must call `normalizePagination`" requires scanning every function in the project and somehow filtering to only those that are route handler callbacks. There is no predicate that can express "this function is a callback argument to an `app.get()` call."

With `within()`, the user writes:

```typescript
const routes = calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete|patch)$/)

within(routes).functions().should().contain(call('normalizePagination')).check()
```

`within(routes)` restricts the search space: instead of scanning all source files, the `functions()` entry point only looks at callback arguments inside the matched call expressions.

### Design Decision: `within()` Returns a Scoped Project Proxy

`within()` does not return a new `RuleBuilder`. It returns a **scoped context** that provides entry point functions (`functions()`, `classes()`, etc.) which operate on a restricted set of AST nodes — specifically, the callback arguments of the matched call expressions.

Why not a builder method? Because `within()` changes the *element source*, not the predicate or condition. It logically precedes the entry point, not the `.that()` chain. The grammar is:

```
within(selection)     -> ScopedContext    (restrict search space)
  .functions()        -> FunctionRuleBuilder (scoped)
  .classes()          -> ClassRuleBuilder    (scoped, rare but valid)
```

This keeps the builder chain clean and makes the scoping explicit.

### Design Decision: Callback Extraction Strategy

A call expression like `app.get('/users', authenticate, handler)` can have multiple arguments that are functions. The callback extraction must handle:

1. **Inline arrow functions:** `app.get('/users', (req, res) => { ... })`
2. **Inline function expressions:** `app.get('/users', function(req, res) { ... })`
3. **Reference arguments (stretch):** `app.get('/users', myHandler)` — resolving the reference to its declaration is expensive and deferred to a future enhancement.

For v1, `within()` extracts inline function arguments only (arrow functions and function expressions). This covers the dominant pattern in Express, Fastify, Hapi, and Koa. Reference resolution is out of scope.

### Design Decision: Scoped Builders Reuse Existing RuleBuilders

A `ScopedFunctionRuleBuilder` is just a `FunctionRuleBuilder` with a custom `getElements()` that returns `ArchFunction` wrappers from extracted callbacks instead of scanning all source files. This is achieved by subclassing and overriding `getElements()`, not by modifying the base class.

This means all existing predicates and conditions work unchanged inside `within()` — no new condition types, no special handling. The scoping is invisible to the predicate/condition layer.

## Phase 1: Callback Extraction

### `src/helpers/callback-extractor.ts`

Extract inline function arguments from call expressions.

```typescript
import { type CallExpression, type Node, SyntaxKind } from 'ts-morph'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Represents a callback function extracted from a call expression argument.
 * Wraps the arrow function or function expression as an ArchFunction.
 */
export interface ExtractedCallback {
  /** The ArchFunction wrapping the callback. */
  fn: ArchFunction
  /** The call expression this callback was extracted from. */
  callSite: CallExpression
  /** Argument index within the call expression (0-based). */
  argIndex: number
}

/**
 * Extract all inline function arguments from a call expression.
 *
 * Handles:
 * - Arrow functions: `app.get('/path', (req, res) => { ... })`
 * - Function expressions: `app.get('/path', function(req, res) { ... })`
 *
 * Does NOT resolve named references (e.g., `app.get('/path', myHandler)`).
 * Reference resolution requires type-checker lookups and is deferred.
 *
 * @returns Array of extracted callbacks with their source metadata
 */
export function extractCallbacks(callExpr: CallExpression): ExtractedCallback[] {
  const callbacks: ExtractedCallback[] = []
  const args = callExpr.getArguments()

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const fn = extractInlineFunction(arg, callExpr, i)
    if (fn) {
      callbacks.push(fn)
    }
  }

  return callbacks
}

/**
 * Try to extract an ArchFunction from a single argument node.
 */
function extractInlineFunction(
  arg: Node,
  callSite: CallExpression,
  argIndex: number,
): ExtractedCallback | null {
  // Arrow function: (req, res) => { ... }
  if (arg.getKind() === SyntaxKind.ArrowFunction) {
    return {
      fn: fromArrowExpression(arg),
      callSite,
      argIndex,
    }
  }

  // Function expression: function(req, res) { ... }
  if (arg.getKind() === SyntaxKind.FunctionExpression) {
    return {
      fn: fromFunctionExpression(arg),
      callSite,
      argIndex,
    }
  }

  return null
}

/**
 * Wrap an arrow function argument as an ArchFunction.
 * Unlike fromArrowVariableDeclaration (plan 0009), this has no variable name.
 * The name is synthesized from the call site: `app.get callback[1]`.
 */
function fromArrowExpression(node: Node): ArchFunction {
  const arrow = node.asKindOrThrow(SyntaxKind.ArrowFunction)
  return {
    getName: () => undefined, // anonymous — name derived from context
    getSourceFile: () => arrow.getSourceFile(),
    isExported: () => false,  // callbacks are never exported
    isAsync: () => arrow.isAsync(),
    getParameters: () => arrow.getParameters(),
    getReturnType: () => arrow.getReturnType(),
    getBody: () => arrow.getBody(),
    getNode: () => arrow,
    getStartLineNumber: () => arrow.getStartLineNumber(),
  }
}

/**
 * Wrap a function expression argument as an ArchFunction.
 */
function fromFunctionExpression(node: Node): ArchFunction {
  const funcExpr = node.asKindOrThrow(SyntaxKind.FunctionExpression)
  return {
    getName: () => funcExpr.getName(), // may have a name: `function handler() {}`
    getSourceFile: () => funcExpr.getSourceFile(),
    isExported: () => false,
    isAsync: () => funcExpr.isAsync(),
    getParameters: () => funcExpr.getParameters(),
    getReturnType: () => funcExpr.getReturnType(),
    getBody: () => funcExpr.getBody(),
    getNode: () => funcExpr,
    getStartLineNumber: () => funcExpr.getStartLineNumber(),
  }
}
```

## Phase 2: `ScopedContext` and `within()`

### `src/helpers/within.ts`

The `within()` function accepts a `CallRuleBuilder` (from plan 0014), evaluates its predicates to get matching call expressions, extracts callbacks, and returns a `ScopedContext` that provides scoped entry points.

```typescript
import type { CallRuleBuilder } from '../builders/call-rule-builder.js'
import type { ArchFunction } from '../models/arch-function.js'
import { ScopedFunctionRuleBuilder } from '../builders/scoped-function-rule-builder.js'
import { extractCallbacks } from './callback-extractor.js'
import type { CallExpression } from 'ts-morph'

/**
 * A scoped context that restricts entry points to elements found
 * inside the callback arguments of matched call expressions.
 *
 * Created by `within()`. Provides the same entry point functions
 * as the top-level API, but scoped to the matched callbacks.
 */
export interface ScopedContext {
  /**
   * Function-level rules scoped to callbacks of the matched calls.
   * Only examines functions that appear as inline arguments.
   */
  functions(): ScopedFunctionRuleBuilder
}

/**
 * Scope rules to a call selection context.
 *
 * `within(selection)` restricts the search space to callback arguments
 * of the matched call expressions. Instead of scanning all source files,
 * scoped entry points only examine functions that are inline arguments
 * to the matched calls.
 *
 * @param selection - A CallRuleBuilder with predicates already applied.
 *   The predicates are evaluated lazily when a terminal method is called.
 *
 * @example
 * ```typescript
 * const routes = calls(p)
 *   .that()
 *   .onObject('app')
 *   .and()
 *   .withMethod(/^(get|post|put|delete|patch)$/)
 *
 * // Only check functions inside route handler callbacks
 * within(routes).functions().should().contain(call('normalizePagination')).check()
 * ```
 */
export function within(selection: CallRuleBuilder): ScopedContext {
  return {
    functions(): ScopedFunctionRuleBuilder {
      return new ScopedFunctionRuleBuilder(selection)
    },
  }
}
```

## Phase 3: Scoped Rule Builders

### `src/builders/scoped-function-rule-builder.ts`

Extends `FunctionRuleBuilder` with a scoped `getElements()` that only returns callbacks from matched call expressions.

```typescript
import { FunctionRuleBuilder } from './function-rule-builder.js'
import type { CallRuleBuilder } from './call-rule-builder.js'
import type { ArchFunction } from '../models/arch-function.js'
import { extractCallbacks } from '../helpers/callback-extractor.js'

/**
 * A FunctionRuleBuilder that only examines callback functions
 * inside matched call expressions.
 *
 * Created by `within(selection).functions()`. Inherits all predicates,
 * conditions, and chain methods from FunctionRuleBuilder — the only
 * difference is the element source.
 */
export class ScopedFunctionRuleBuilder extends FunctionRuleBuilder {
  private readonly callSelection: CallRuleBuilder

  constructor(callSelection: CallRuleBuilder) {
    super(callSelection.getProject())
    this.callSelection = callSelection
  }

  /**
   * Override: instead of scanning all source files, extract callbacks
   * from the matched call expressions.
   */
  protected override getElements(): ArchFunction[] {
    const matchedCalls = this.callSelection.getMatchedCalls()
    return matchedCalls.flatMap((callExpr) =>
      extractCallbacks(callExpr).map((ec) => ec.fn),
    )
  }

  /**
   * Override fork to preserve the call selection context.
   * Without this, `.should()` would create a FunctionRuleBuilder fork
   * that loses the scoped element source.
   */
  protected override fork(): this {
    const forked = new ScopedFunctionRuleBuilder(this.callSelection)
    forked._predicates = [...this._predicates]
    forked._conditions = []
    forked._reason = undefined
    return forked as this
  }
}
```

### Required addition to `CallRuleBuilder` (plan 0014)

Plan 0014 defines `CallRuleBuilder`. This plan requires two public methods that 0014 must expose:

```typescript
// In call-rule-builder.ts (plan 0014 scope, listed here for interface contract)

export class CallRuleBuilder extends RuleBuilder<ArchCall> {
  /**
   * Get the project instance. Used by within() to construct scoped builders.
   */
  getProject(): ArchProject {
    return this.project
  }

  /**
   * Evaluate predicates and return the matched CallExpressions.
   * Used by within() to extract callbacks from matched call sites.
   *
   * This runs the predicate pipeline lazily — no work is done until called.
   */
  getMatchedCalls(): CallExpression[] {
    const allCalls = this.getElements()
    return allCalls
      .filter((archCall) =>
        this._predicates.every((predicate) => predicate.test(archCall)),
      )
      .map((archCall) => archCall.getNode() as CallExpression)
  }
}
```

**Note:** `getProject()` accesses the `protected project` field from `RuleBuilder`. Since `CallRuleBuilder` extends `RuleBuilder`, this is a simple accessor. `getMatchedCalls()` mirrors the predicate filtering logic in `RuleBuilder.evaluate()`, returning the raw `CallExpression` nodes rather than violations.

## Phase 4: Public API Export

### `src/index.ts` (modification)

```typescript
// Scoped rules — within()
export { within } from './helpers/within.js'
export type { ScopedContext } from './helpers/within.js'
export { ScopedFunctionRuleBuilder } from './builders/scoped-function-rule-builder.js'
```

## Phase 5: Tests

### `tests/helpers/callback-extractor.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { extractCallbacks } from '../../src/helpers/callback-extractor.js'
import { SyntaxKind } from 'ts-morph'

function getCallExpressions(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('test.ts', code)
  return sf.getDescendantsOfKind(SyntaxKind.CallExpression)
}

describe('extractCallbacks', () => {
  it('extracts arrow function callbacks', () => {
    const calls = getCallExpressions(`
      app.get('/users', (req, res) => {
        res.json([])
      })
    `)
    const callbacks = extractCallbacks(calls[0]!)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.argIndex).toBe(1)
    expect(callbacks[0]!.fn.isAsync()).toBe(false)
    expect(callbacks[0]!.fn.getParameters()).toHaveLength(2)
  })

  it('extracts async arrow function callbacks', () => {
    const calls = getCallExpressions(`
      app.post('/orders', async (req, res) => {
        await createOrder(req.body)
      })
    `)
    const callbacks = extractCallbacks(calls[0]!)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.fn.isAsync()).toBe(true)
  })

  it('extracts function expression callbacks', () => {
    const calls = getCallExpressions(`
      app.get('/items', function handler(req, res) {
        res.json([])
      })
    `)
    const callbacks = extractCallbacks(calls[0]!)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.fn.getName()).toBe('handler')
  })

  it('extracts multiple callbacks from a single call', () => {
    const calls = getCallExpressions(`
      app.get('/users', (req, res, next) => { next() }, (req, res) => {
        res.json([])
      })
    `)
    const callbacks = extractCallbacks(calls[0]!)
    expect(callbacks).toHaveLength(2)
    expect(callbacks[0]!.argIndex).toBe(1)
    expect(callbacks[1]!.argIndex).toBe(2)
  })

  it('ignores non-function arguments', () => {
    const calls = getCallExpressions(`
      app.get('/users', authenticate, (req, res) => { res.json([]) })
    `)
    const callbacks = extractCallbacks(calls[0]!)
    // 'authenticate' is an identifier, not an inline function — skipped
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]!.argIndex).toBe(2)
  })

  it('returns empty array for calls with no function arguments', () => {
    const calls = getCallExpressions(`
      console.log('hello', 42, true)
    `)
    const callbacks = extractCallbacks(calls[0]!)
    expect(callbacks).toHaveLength(0)
  })

  it('extracts body for body analysis', () => {
    const calls = getCallExpressions(`
      app.get('/users', async (req, res) => {
        const data = normalizePagination(req.query)
        res.json(data)
      })
    `)
    const callbacks = extractCallbacks(calls[0]!)
    const body = callbacks[0]!.fn.getBody()
    expect(body).toBeDefined()
    // Body should contain the normalizePagination call
    const bodyText = body!.getText()
    expect(bodyText).toContain('normalizePagination')
  })
})
```

### `tests/helpers/within.test.ts`

Integration tests that verify the full `within()` pipeline end-to-end. These tests require the `CallRuleBuilder` from plan 0014, so they serve as the integration contract between plans 0014 and 0015.

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { within } from '../../src/helpers/within.js'
import { calls } from '../../src/builders/call-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { project } from '../../src/core/project.js'
import { ArchRuleError } from '../../src/core/errors.js'

/**
 * Helper: create an in-memory project with route-like source files.
 */
function createRouteProject() {
  // Uses ts-morph in-memory project, wrapped via project() or a test helper
  // that produces an ArchProject from in-memory source files.
  // Implementation depends on plan 0014's test infrastructure.
}

describe('within()', () => {
  it('scopes functions() to callbacks of matched calls', () => {
    const p = createRouteProject()

    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post|put|delete|patch)$/)

    // This should only examine the inline callbacks, not all functions in the project
    within(routes)
      .functions()
      .should()
      .contain(call('normalizePagination'))
      .check()
  })

  it('reports violations for callbacks missing required calls', () => {
    const p = createRouteProject()
    // Project has one route with normalizePagination and one without

    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post)$/)

    expect(() => {
      within(routes)
        .functions()
        .should()
        .contain(call('normalizePagination'))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('supports named selections with multiple rules', () => {
    const p = createRouteProject()

    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post|put|delete|patch)$/)

    // Named selection: define scope once, reuse for multiple rules
    const scopedFunctions = within(routes).functions()

    // Rule 1: must call handleError
    scopedFunctions.should().contain(call('handleError')).check()

    // Rule 2: must call normalizePagination (independent rule via fork-on-should)
    scopedFunctions.should().contain(call('normalizePagination')).check()
  })

  it('supports predicates on scoped functions', () => {
    const p = createRouteProject()

    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')

    // Filter to only async callbacks, then check
    within(routes)
      .functions()
      .that()
      .areAsync()
      .should()
      .contain(call('normalizePagination'))
      .check()
  })

  it('returns no elements when no calls match the selection', () => {
    const p = createRouteProject()

    const noRoutes = calls(p)
      .that()
      .onObject('nonexistent')

    // No matched calls → no callbacks → no violations (empty set passes)
    expect(() => {
      within(noRoutes)
        .functions()
        .should()
        .contain(call('anything'))
        .check()
    }).not.toThrow()
  })

  it('preserves .because() reason in scoped rule violations', () => {
    const p = createRouteProject()

    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('post')

    try {
      within(routes)
        .functions()
        .should()
        .contain(call('validateInput'))
        .because('all POST handlers must validate input')
        .check()
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('all POST handlers must validate input')
    }
  })

  it('handles calls with multiple inline callbacks', () => {
    // Express middleware pattern: app.get('/path', middleware, handler)
    // Both middleware and handler are inline arrow functions
    const p = createRouteProject()

    const routes = calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod('get')

    // within() extracts ALL inline function arguments, not just the last one
    const scopedFns = within(routes).functions()

    // The total scoped function count should include both middleware and handler
    // (This verifies multi-callback extraction works end-to-end)
    scopedFns.should().contain(call('next')).check()
  })
})
```

### `tests/builders/scoped-function-rule-builder.test.ts`

Unit tests for the scoped builder's fork behavior and element sourcing.

```typescript
import { describe, it, expect } from 'vitest'
import { ScopedFunctionRuleBuilder } from '../../src/builders/scoped-function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'

describe('ScopedFunctionRuleBuilder', () => {
  it('fork preserves call selection context', () => {
    // After .should() the builder forks. The forked builder must
    // still use the scoped getElements(), not the global one.
    // This test ensures the override of fork() works correctly.

    // Setup: create a ScopedFunctionRuleBuilder with a mock CallRuleBuilder
    // that returns known call expressions.
    // After .should(), verify the forked builder still scopes correctly.
  })

  it('inherits all FunctionRuleBuilder predicates and conditions', () => {
    // Verify that .areAsync(), .haveParameterCount(), .contain(), .notContain()
    // all work on the scoped builder — they are inherited, not reimplemented.
  })

  it('getElements returns empty when call selection matches no calls', () => {
    // Verify that an empty call selection → empty elements → no violations.
  })
})
```

## Phase 6: Future Extensions (Out of Scope)

### Reference Resolution (`within()` stretch goal)

Named references in call arguments (`app.get('/users', myHandler)`) require resolving `myHandler` to its declaration. This involves:

1. Getting the symbol of the identifier via the type checker
2. Following the symbol to its value declaration
3. Wrapping the declaration as an ArchFunction

This is feasible with ts-morph but adds complexity and performance cost. It is deferred to a future enhancement once the inline-only version proves its value.

### `within().classes()`

Scoping classes to call expression contexts is an unusual pattern (defining a class inside a callback) but technically valid. The `ScopedContext` interface reserves the method signature. A `ScopedClassRuleBuilder` would follow the same pattern as `ScopedFunctionRuleBuilder` — override `getElements()` to extract class declarations from callback bodies.

### Nested `within()`

```typescript
within(outerCalls).within(innerCalls).functions().should()...
```

Nested scoping is not supported in v1. Each `within()` operates on a `CallRuleBuilder` against the full project. Composing scopes would require `within()` to accept a `ScopedContext` and chain the extraction, which adds complexity with unclear real-world value.

## Files Changed

| File | Change |
| ---- | ------ |
| `src/helpers/callback-extractor.ts` | New — extract inline function arguments from call expressions |
| `src/helpers/within.ts` | New — `within()` function and `ScopedContext` interface |
| `src/builders/scoped-function-rule-builder.ts` | New — `FunctionRuleBuilder` subclass with scoped `getElements()` |
| `src/builders/call-rule-builder.ts` | Modified (plan 0014) — add `getProject()` and `getMatchedCalls()` |
| `src/index.ts` | Modified — export `within`, `ScopedContext`, `ScopedFunctionRuleBuilder` |
| `tests/helpers/callback-extractor.test.ts` | New — 7 tests for callback extraction |
| `tests/helpers/within.test.ts` | New — 7 integration tests for scoped rules |
| `tests/builders/scoped-function-rule-builder.test.ts` | New — 3 tests for fork behavior and element sourcing |

## Test Inventory

| # | Test | What it validates |
| --- | --- | --- |
| 1 | Extract arrow function callbacks | Arrow functions detected as arguments |
| 2 | Extract async arrow function callbacks | `isAsync()` correct on extracted callback |
| 3 | Extract function expression callbacks | Named function expressions detected |
| 4 | Extract multiple callbacks from single call | Multi-middleware pattern (Express) |
| 5 | Ignore non-function arguments | Identifier references skipped |
| 6 | Empty for calls with no function arguments | `console.log(42)` returns nothing |
| 7 | Body available for body analysis | Extracted callback body works with `contain()` |
| 8 | Scopes `functions()` to matched call callbacks | End-to-end: `within(routes).functions()` |
| 9 | Reports violations for missing calls in callbacks | Violation path works in scoped context |
| 10 | Named selections work with `within()` | `.should()` fork-on-should produces independent scoped rules |
| 11 | Predicates work on scoped functions | `.that().areAsync()` filters within scope |
| 12 | Empty selection produces no violations | No matched calls = no elements = pass |
| 13 | `.because()` reason preserved in scoped rules | Reason flows through to violations |
| 14 | Multiple inline callbacks all extracted | Middleware + handler both in scope |
| 15 | Fork preserves call selection context | `.should()` on scoped builder stays scoped |
| 16 | Inherits all `FunctionRuleBuilder` methods | No methods lost in subclass |
| 17 | Empty call selection yields empty elements | Scoped `getElements()` returns `[]` |

## Out of Scope

- **Reference resolution** — resolving named function references in call arguments (e.g., `app.get('/path', myHandler)`) to their declarations. Deferred until inline-only proves insufficient.
- **`within().classes()`** — scoped class rules for classes defined inside callbacks. Uncommon pattern; reserved in the interface but not implemented.
- **Nested `within()`** — composing scoped contexts. No clear real-world use case yet.
- **`within()` for non-call selections** — scoping based on class or module selections. This plan is specific to call expressions from plan 0014.
- **Argument position filtering** — "only the last argument" or "only arguments after index N." Users can filter via predicates on the extracted functions if needed.
