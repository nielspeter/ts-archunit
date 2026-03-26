# Plan 0014: Call Entry Point & Call Predicates

## Status

- **State:** Not Started
- **Priority:** P2 --- Framework-agnostic route/handler matching
- **Effort:** 2-3 days
- **Created:** 2026-03-26
- **Depends on:** 0002 (Project Loader), 0003 (Predicate Engine), 0004 (Condition Engine), 0005 (Rule Builder), 0011 (Body Analysis)

## Purpose

Implement the `calls(p)` entry point that returns a `CallRuleBuilder` operating on ts-morph `CallExpression` nodes. This is critical for any framework that registers behavior via function calls rather than decorators --- which includes most of the TypeScript ecosystem:

- Express: `router.get('/users', handler)`
- Fastify: `app.get('/users', handler)`
- Hono: `app.route('/api', router)`
- tRPC: `router({ users: ... })`
- Elysia: `app.get('/users', handler)`
- Database: `db.query('SELECT ...')`
- Middleware: `app.use(cors())`

Without this entry point, users cannot write rules like "all route handlers must call `handleError()`" or "no route may call `db.query()` directly." The existing `functions()` entry point operates on function declarations, not on call-site registrations.

### Design Decision: ArchCall Wrapper (same pattern as ArchFunction)

`CallExpression` is a ts-morph Node, so unlike `ArchFunction` we could operate on it directly. However, wrapping it in `ArchCall` provides:

1. **Consistent API** --- same pattern as `ArchFunction` from plan 0009. Predicates and conditions use the same interfaces.
2. **Precomputed fields** --- object name, method name, and file location are extracted once during collection, not re-parsed in every predicate.
3. **Named/Located compliance** --- `ArchCall` satisfies the identity predicate interfaces, so `resideInFile()` and `resideInFolder()` work out of the box.
4. **No `areExported()`** --- call expressions cannot be exported. The spec (section 5.1) explicitly excludes Call from export predicates.

### Design Decision: Condition Scope

`CallRuleBuilder` conditions operate on the call expression itself and its arguments. The key condition is `haveCallbackContaining(predicate)`, which searches the callback argument's body for matches using the same `ExpressionMatcher` infrastructure from plan 0011. This reuses `findMatchesInBody` from `src/helpers/body-traversal.ts`.

### Design Decision: Collecting Call Expressions

Call expressions are collected by walking all source files and extracting `CallExpression` descendants. Unlike classes or functions (which are top-level declarations), call expressions can be nested at any depth. The collection phase uses `getDescendantsOfKind(SyntaxKind.CallExpression)` on each source file, which is efficient because ts-morph uses a kind-based index.

## Phase 1: ArchCall Model

### `src/models/arch-call.ts`

```typescript
import {
  type CallExpression,
  type SourceFile,
  type Node,
  Node as NodeUtils,
  SyntaxKind,
} from 'ts-morph'

/**
 * Unified representation of a call expression in the project.
 *
 * Wraps a ts-morph CallExpression with precomputed fields for
 * efficient predicate evaluation.
 *
 * Satisfies Named and Located interfaces from identity predicates.
 * Does NOT satisfy Exportable --- call expressions cannot be exported.
 */
export interface ArchCall {
  /** Full expression text, e.g. "app.get", "router.post", "db.query" */
  getName(): string | undefined

  /** Source file containing this call expression. */
  getSourceFile(): SourceFile

  /** The object the method is called on, or undefined for bare calls. */
  getObjectName(): string | undefined

  /** The method name, or the function name for bare calls. */
  getMethodName(): string | undefined

  /** The arguments to the call expression. */
  getArguments(): Node[]

  /** Underlying ts-morph CallExpression node. */
  getNode(): CallExpression

  /** Start line number in the source file. */
  getStartLineNumber(): number
}

/**
 * Create an ArchCall from a CallExpression.
 *
 * Precomputes object name and method name from the call expression.
 * For `app.get(...)`, objectName is "app" and methodName is "get".
 * For `handleError(...)`, objectName is undefined and methodName is "handleError".
 */
export function fromCallExpression(expr: CallExpression): ArchCall {
  const callExpr = expr.getExpression()

  let objectName: string | undefined
  let methodName: string | undefined

  if (NodeUtils.isPropertyAccessExpression(callExpr)) {
    // app.get(...) => object="app", method="get"
    // router.route.get(...) => object="router.route", method="get"
    methodName = callExpr.getName()
    objectName = callExpr.getExpression().getText()
  } else if (NodeUtils.isIdentifier(callExpr)) {
    // handleError(...) => object=undefined, method="handleError"
    methodName = callExpr.getText()
  } else {
    // Computed or other expression, e.g. getHandler()()
    methodName = callExpr.getText()
  }

  const fullName =
    objectName !== undefined ? `${objectName}.${methodName}` : methodName

  return {
    getName: () => fullName,
    getSourceFile: () => expr.getSourceFile(),
    getObjectName: () => objectName,
    getMethodName: () => methodName,
    getArguments: () => expr.getArguments(),
    getNode: () => expr,
    getStartLineNumber: () => expr.getStartLineNumber(),
  }
}

/**
 * Scan a source file for all call expressions.
 *
 * Walks all descendants of kind CallExpression. This includes
 * nested calls (e.g., calls inside callbacks), which is intentional ---
 * users filter with predicates to select the calls they care about.
 */
export function collectCalls(sourceFile: SourceFile): ArchCall[] {
  const calls: ArchCall[] = []
  for (const callExpr of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    calls.push(fromCallExpression(callExpr))
  }
  return calls
}
```

Key implementation notes:

- `fromCallExpression` precomputes `objectName` and `methodName` once. Predicates like `onObject('app')` become a simple string comparison.
- `getObjectName()` uses `callExpr.getExpression().getText()` on the `PropertyAccessExpression`, which returns the full chain (e.g., `router.route` for `router.route.get()`). This handles chained calls correctly.
- `getName()` returns the full dotted expression (e.g., `app.get`), matching what identity predicates like `haveNameMatching` expect.
- Optional chaining (`app?.get()`) is handled by the predicate layer, which normalizes `?.` to `.` (same approach as the existing `call()` matcher in `src/helpers/matchers.ts`).

## Phase 2: Call Predicates

### `src/predicates/call.ts`

```typescript
import picomatch from 'picomatch'
import type { Predicate } from '../core/predicate.js'
import type { ArchCall } from '../models/arch-call.js'

/**
 * Normalize text for matching: replace optional chaining `?.` with `.`
 * so users don't need to account for both forms.
 *
 * Same normalization as src/helpers/matchers.ts.
 */
function normalizeText(text: string): string {
  return text.replace(/\?\./g, '.')
}

/**
 * Matches calls on an object with the given name.
 *
 * For `app.get(...)`, onObject('app') matches.
 * For `router.route.get(...)`, onObject('router.route') matches.
 *
 * @param name - Exact object name (after optional-chaining normalization)
 */
export function onObject(name: string): Predicate<ArchCall> {
  return {
    description: `on object '${name}'`,
    test: (call) => {
      const obj = call.getObjectName()
      return obj !== undefined && normalizeText(obj) === name
    },
  }
}

/**
 * Matches calls whose method name matches the given pattern.
 *
 * For `app.get(...)`, withMethod('get') matches.
 * For `app.get(...)`, withMethod(/^(get|post)$/) matches.
 * For `handleError(...)` (bare call), withMethod('handleError') matches.
 *
 * @param nameOrRegex - Exact method name or regex pattern
 */
export function withMethod(nameOrRegex: string | RegExp): Predicate<ArchCall> {
  if (typeof nameOrRegex === 'string') {
    return {
      description: `with method '${nameOrRegex}'`,
      test: (call) => {
        const method = call.getMethodName()
        return method !== undefined && normalizeText(method) === nameOrRegex
      },
    }
  }
  return {
    description: `with method matching ${String(nameOrRegex)}`,
    test: (call) => {
      const method = call.getMethodName()
      return method !== undefined && nameOrRegex.test(normalizeText(method))
    },
  }
}

/**
 * Matches calls where the argument at the given index matches a pattern.
 *
 * The pattern is matched against the argument's getText() output.
 * Use for flexible argument matching (e.g., variable references, expressions).
 *
 * @param index - Zero-based argument position
 * @param pattern - Regex or exact string to match against argument text
 */
export function withArgMatching(
  index: number,
  pattern: string | RegExp,
): Predicate<ArchCall> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    description: `with argument ${String(index)} matching ${String(regex)}`,
    test: (call) => {
      const args = call.getArguments()
      if (index >= args.length) return false
      const argText = args[index]!.getText()
      return regex.test(argText)
    },
  }
}

/**
 * Matches calls where the argument at the given index is a string literal
 * matching the given glob pattern.
 *
 * Only matches when the argument is an actual string literal (quoted).
 * The glob is matched against the string content (without quotes).
 *
 * @param index - Zero-based argument position
 * @param glob - Glob pattern matched against the string literal value
 *
 * @example
 * // Match: router.get('/api/users', handler)
 * // Match: router.get('/api/users/:id', handler)
 * // No match: router.get(pathVariable, handler)
 * withStringArg(0, '/api/users/**')
 */
export function withStringArg(
  index: number,
  glob: string,
): Predicate<ArchCall> {
  const isMatch = picomatch(glob)
  return {
    description: `with string argument ${String(index)} matching '${glob}'`,
    test: (call) => {
      const args = call.getArguments()
      if (index >= args.length) return false
      const arg = args[index]!
      // Check if the argument is a string literal
      if (!('getLiteralValue' in arg)) return false
      // StringLiteral, NoSubstitutionTemplateLiteral
      const text = (arg as { getLiteralValue(): unknown }).getLiteralValue()
      if (typeof text !== 'string') return false
      return isMatch(text)
    },
  }
}

/**
 * Matches calls where at least one argument is a function (arrow, function
 * expression, or function reference) whose body contains a node matching
 * the given ExpressionMatcher.
 *
 * This is the bridge between call-level rules and body analysis: it
 * lets you assert what happens INSIDE a callback registered at a call site.
 *
 * @param matcher - ExpressionMatcher from the body analysis helpers
 *                  (call(), access(), newExpr(), expression())
 *
 * @example
 * // All route handlers must call handleError()
 * calls(p)
 *   .that().onObject('app').and().withMethod(/^(get|post|put|delete|patch)$/)
 *   .should().haveCallbackContaining(call('handleError'))
 *   .check()
 */
export function haveCallbackContaining(
  matcher: import('../helpers/matchers.js').ExpressionMatcher,
): import('../core/condition.js').Condition<ArchCall> {
  return {
    description: `have callback containing ${matcher.description}`,
    evaluate(
      elements: ArchCall[],
      context: import('../core/condition.js').ConditionContext,
    ): import('../core/violation.js').ArchViolation[] {
      const violations: import('../core/violation.js').ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        let found = false

        for (const arg of args) {
          // Check if this argument is a function-like node
          const body = getFunctionBody(arg)
          if (!body) continue

          // Search the body using the same infrastructure as plan 0011
          const matches = findMatchesInNode(body, matcher)
          if (matches.length > 0) {
            found = true
            break
          }
        }

        if (!found) {
          violations.push({
            rule: context.rule,
            element: archCall.getName() ?? '<call>',
            file: archCall.getSourceFile().getFilePath(),
            line: archCall.getStartLineNumber(),
            message: `${archCall.getName() ?? '<call>'} does not have a callback containing ${matcher.description}`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}
```

Note: `haveCallbackContaining` is a **condition**, not a predicate. It lives in `src/conditions/call.ts` in the final implementation (see Phase 3). It is shown here alongside the predicates for narrative clarity. The actual file split is described in the Files Changed section.

### Helper functions for callback body extraction

These are added to `src/helpers/body-traversal.ts`:

```typescript
import { Node, SyntaxKind } from 'ts-morph'
import type { ExpressionMatcher } from './matchers.js'

/**
 * Extract the body from a function-like argument node.
 *
 * Handles:
 * - ArrowFunction: () => { ... } or () => expr
 * - FunctionExpression: function() { ... }
 *
 * Returns undefined if the node is not a function-like expression.
 */
export function getFunctionBody(node: Node): Node | undefined {
  if (Node.isArrowFunction(node)) {
    return node.getBody()
  }
  if (Node.isFunctionExpression(node)) {
    return node.getBody()
  }
  return undefined
}

/**
 * Find all nodes in a subtree that match the given matcher.
 *
 * Reuses the same kind-based traversal logic as the existing
 * findMatchesInBody (but accepts any Node, not just a body).
 */
export function findMatchesInNode(
  node: Node,
  matcher: ExpressionMatcher,
): Node[] {
  const matches: Node[] = []
  if (matcher.syntaxKinds && matcher.syntaxKinds.length > 0) {
    for (const kind of matcher.syntaxKinds) {
      for (const descendant of node.getDescendantsOfKind(kind)) {
        if (matcher.matches(descendant)) {
          matches.push(descendant)
        }
      }
    }
  } else {
    for (const descendant of node.getDescendants()) {
      if (matcher.matches(descendant)) {
        matches.push(descendant)
      }
    }
  }
  return matches
}
```

Key implementation notes:

- `onObject` and `withMethod` both normalize optional chaining. `app?.get()` matches `onObject('app').withMethod('get')`.
- `withStringArg` only matches actual string literals, not string variables or template literals with substitutions. This is intentional --- if the route path is dynamic, it cannot be glob-matched reliably.
- `haveCallbackContaining` searches ALL function-like arguments, not just the last one. This handles both `app.get('/path', handler)` and `app.get('/path', middleware, handler)` patterns.
- `findMatchesInNode` is a generalized version of the existing `findMatchesInBody`. The existing function delegates to this one (or they share the private helper). No duplication.

## Phase 3: CallRuleBuilder

### `src/builders/call-rule-builder.ts`

```typescript
import type { ArchProject } from '../core/project.js'
import { RuleBuilder } from '../core/rule-builder.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchCall } from '../models/arch-call.js'
import { collectCalls } from '../models/arch-call.js'
import {
  haveNameMatching as identityHaveNameMatching,
  haveNameStartingWith as identityHaveNameStartingWith,
  haveNameEndingWith as identityHaveNameEndingWith,
  resideInFile as identityResideInFile,
  resideInFolder as identityResideInFolder,
} from '../predicates/identity.js'
import {
  onObject as callOnObject,
  withMethod as callWithMethod,
  withArgMatching as callWithArgMatching,
  withStringArg as callWithStringArg,
} from '../predicates/call.js'
import {
  haveCallbackContaining as conditionHaveCallbackContaining,
  notExist as callNotExist,
} from '../conditions/call.js'

/**
 * Rule builder for call-expression-level architecture rules.
 *
 * Operates on CallExpression nodes across all source files,
 * wrapped in the ArchCall model for uniform predicate access.
 *
 * @example
 * ```typescript
 * // All Express route handlers must call handleError()
 * calls(project)
 *   .that().onObject('app')
 *   .and().withMethod(/^(get|post|put|delete|patch)$/)
 *   .should().haveCallbackContaining(call('handleError'))
 *   .because('unhandled errors crash the server')
 *   .check()
 *
 * // No route may call db.query() directly
 * calls(project)
 *   .that().onObject('app')
 *   .and().withMethod(/^(get|post|put|delete|patch)$/)
 *   .should().notHaveCallbackContaining(call('db.query'))
 *   .because('use repository methods instead')
 *   .check()
 *
 * // Select specific routes by path pattern
 * calls(project)
 *   .that().onObject('router')
 *   .and().withMethod('get')
 *   .and().withStringArg(0, '/api/users/**')
 *   .should().haveCallbackContaining(call('authenticate'))
 *   .check()
 * ```
 */
export class CallRuleBuilder extends RuleBuilder<ArchCall> {
  protected getElements(): ArchCall[] {
    return this.project.getSourceFiles().flatMap(collectCalls)
  }

  // --- Identity predicates (subset: no areExported/areNotExported) ---

  haveNameMatching(pattern: RegExp | string): this {
    return this.addPredicate(identityHaveNameMatching<ArchCall>(pattern))
  }

  haveNameStartingWith(prefix: string): this {
    return this.addPredicate(identityHaveNameStartingWith<ArchCall>(prefix))
  }

  haveNameEndingWith(suffix: string): this {
    return this.addPredicate(identityHaveNameEndingWith<ArchCall>(suffix))
  }

  resideInFile(glob: string): this {
    return this.addPredicate(identityResideInFile<ArchCall>(glob))
  }

  resideInFolder(glob: string): this {
    return this.addPredicate(identityResideInFolder<ArchCall>(glob))
  }

  // Note: areExported() and areNotExported() are intentionally omitted.
  // Call expressions cannot be exported. See spec section 5.1.

  // --- Call-specific predicates ---

  onObject(name: string): this {
    return this.addPredicate(callOnObject(name))
  }

  withMethod(nameOrRegex: string | RegExp): this {
    return this.addPredicate(callWithMethod(nameOrRegex))
  }

  withArgMatching(index: number, pattern: string | RegExp): this {
    return this.addPredicate(callWithArgMatching(index, pattern))
  }

  withStringArg(index: number, glob: string): this {
    return this.addPredicate(callWithStringArg(index, glob))
  }

  // --- Condition methods ---

  /**
   * Assert that the call's callback argument(s) contain a match.
   */
  haveCallbackContaining(matcher: ExpressionMatcher): this {
    return this.addCondition(conditionHaveCallbackContaining(matcher))
  }

  /**
   * Assert that the call's callback argument(s) do NOT contain a match.
   */
  notHaveCallbackContaining(matcher: ExpressionMatcher): this {
    return this.addCondition(conditionNotHaveCallbackContaining(matcher))
  }

  /**
   * The filtered call set must be empty.
   */
  notExist(): this {
    return this.addCondition(callNotExist())
  }
}

/**
 * Entry point for call-expression architecture rules.
 *
 * Scans all source files in the project for CallExpression nodes
 * and wraps them in ArchCall for predicate/condition evaluation.
 *
 * @example
 * ```typescript
 * import { project, calls, call } from 'ts-archunit'
 *
 * const p = project('tsconfig.json')
 *
 * calls(p)
 *   .that().onObject('app').and().withMethod('get')
 *   .should().haveCallbackContaining(call('authenticate'))
 *   .check()
 * ```
 */
export function calls(p: ArchProject): CallRuleBuilder {
  return new CallRuleBuilder(p)
}
```

Key implementation notes:

- **No `areExported()`/`areNotExported()`.** Call expressions are not declarations and cannot be exported. The spec (section 5.1) explicitly excludes Call from export predicates.
- **`getElements()` uses `flatMap(collectCalls)`.** Every `CallExpression` in every source file is collected. Predicates narrow this set down to the calls the user cares about.
- **`fork()` is not overridden.** `CallRuleBuilder` has no additional constructor args beyond `project`, so the base `fork()` from `RuleBuilder` works correctly.
- **`notHaveCallbackContaining`** is the negation of `haveCallbackContaining`. It produces a violation for each call whose callback DOES contain a match. Useful for "route handlers must not call `db.query()` directly."

## Phase 4: Call Conditions

### `src/conditions/call.ts`

```typescript
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchCall } from '../models/arch-call.js'
import { getFunctionBody, findMatchesInNode } from '../helpers/body-traversal.js'

/**
 * Helper to create a violation from an ArchCall.
 */
function createCallViolation(
  archCall: ArchCall,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: archCall.getName() ?? '<call>',
    file: archCall.getSourceFile().getFilePath(),
    line: archCall.getStartLineNumber(),
    message,
    because: context.because,
  }
}

/**
 * The filtered call set must be empty --- no calls should match the predicates.
 */
export function notExist(): Condition<ArchCall> {
  return {
    description: 'not exist',
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      return elements.map((archCall) =>
        createCallViolation(
          archCall,
          `${archCall.getName() ?? '<call>'} should not exist`,
          context,
        ),
      )
    },
  }
}

/**
 * Assert that at least one callback argument contains a match.
 *
 * Searches all function-like arguments (ArrowFunction, FunctionExpression)
 * for a node matching the given ExpressionMatcher.
 */
export function haveCallbackContaining(
  matcher: ExpressionMatcher,
): Condition<ArchCall> {
  return {
    description: `have callback containing ${matcher.description}`,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const found = searchCallbacksFor(archCall, matcher)
        if (!found) {
          violations.push(
            createCallViolation(
              archCall,
              `${archCall.getName() ?? '<call>'} does not have a callback containing ${matcher.description}`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}

/**
 * Assert that NO callback argument contains a match.
 *
 * Produces one violation per matching node found in any callback.
 */
export function notHaveCallbackContaining(
  matcher: ExpressionMatcher,
): Condition<ArchCall> {
  return {
    description: `not have callback containing ${matcher.description}`,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        for (const arg of args) {
          const body = getFunctionBody(arg)
          if (!body) continue
          const matches = findMatchesInNode(body, matcher)
          for (const match of matches) {
            violations.push(
              createCallViolation(
                archCall,
                `${archCall.getName() ?? '<call>'} has callback containing ${matcher.description} at line ${String(match.getStartLineNumber())}`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * Search all callback arguments of a call for a matcher hit.
 */
function searchCallbacksFor(
  archCall: ArchCall,
  matcher: ExpressionMatcher,
): boolean {
  const args = archCall.getArguments()
  for (const arg of args) {
    const body = getFunctionBody(arg)
    if (!body) continue
    const matches = findMatchesInNode(body, matcher)
    if (matches.length > 0) return true
  }
  return false
}
```

## Phase 5: Public API Export

### `src/index.ts` (additions)

```typescript
// Call entry point (plan 0014)
export { calls, CallRuleBuilder } from './builders/call-rule-builder.js'
export type { ArchCall } from './models/arch-call.js'
export { collectCalls, fromCallExpression } from './models/arch-call.js'

// Call predicates (standalone)
export {
  onObject,
  withMethod,
  withArgMatching,
  withStringArg,
} from './predicates/call.js'

// Call conditions (standalone)
export {
  haveCallbackContaining as callHaveCallbackContaining,
  notHaveCallbackContaining as callNotHaveCallbackContaining,
  notExist as callNotExist,
} from './conditions/call.js'
```

Note: Call-specific conditions are re-exported with `call` prefix to avoid name collisions with structural conditions (`notExist`) and function conditions (`functionNotExist`). This follows the established naming pattern.

## Phase 6: Refactor body-traversal.ts

The existing `findMatchesInBody` in `src/helpers/body-traversal.ts` duplicates the logic that `findMatchesInNode` generalizes. Refactor:

1. Extract `findMatchesInNode(node, matcher)` as the shared primitive.
2. Rewrite existing `searchClassBody` and `searchFunctionBody` to delegate to `findMatchesInNode`.
3. Export `getFunctionBody` and `findMatchesInNode` for use by `src/conditions/call.ts`.

This is a non-breaking refactor --- the public API of `body-traversal.ts` does not change. Internal callers get the same behavior.

```typescript
// Before (private function):
function findMatchesInBody(body: Node, matcher: ExpressionMatcher): Node[] { ... }

// After (exported, renamed):
export function findMatchesInNode(node: Node, matcher: ExpressionMatcher): Node[] { ... }

// searchFunctionBody delegates:
export function searchFunctionBody(fn: ArchFunction, matcher: ExpressionMatcher): MatchResult {
  const body = fn.getBody()
  if (!body) return { found: false, matchingNodes: [] }
  const matchingNodes = findMatchesInNode(body, matcher)
  return { found: matchingNodes.length > 0, matchingNodes }
}
```

## Files Changed

| File                                | Change     | Description                                     |
| ----------------------------------- | ---------- | ----------------------------------------------- |
| `src/models/arch-call.ts`           | **New**    | ArchCall interface + fromCallExpression + collectCalls |
| `src/predicates/call.ts`            | **New**    | onObject, withMethod, withArgMatching, withStringArg |
| `src/conditions/call.ts`            | **New**    | haveCallbackContaining, notHaveCallbackContaining, notExist |
| `src/builders/call-rule-builder.ts` | **New**    | CallRuleBuilder class + calls() entry point     |
| `src/helpers/body-traversal.ts`     | **Modify** | Extract findMatchesInNode, export getFunctionBody |
| `src/index.ts`                      | **Modify** | Add call entry point + predicate/condition exports |
| `tests/models/arch-call.test.ts`    | **New**    | ArchCall model unit tests                       |
| `tests/predicates/call.test.ts`     | **New**    | Call predicate unit tests                       |
| `tests/conditions/call.test.ts`     | **New**    | Call condition unit tests (haveCallbackContaining) |
| `tests/builders/call-rule-builder.test.ts` | **New** | CallRuleBuilder integration tests          |
| `tests/integration/call-entry-point.test.ts` | **New** | End-to-end tests with real framework patterns |
| `tests/fixtures/calls/`             | **New**    | Test fixture TypeScript files                   |

## Test Inventory

### Test Fixtures (`tests/fixtures/calls/`)

```
tests/fixtures/calls/
├── tsconfig.json
├── express-routes.ts      # Express-style route registrations
├── fastify-routes.ts      # Fastify-style route registrations
├── bare-calls.ts          # Non-method calls: handleError(), db.query()
├── chained-calls.ts       # Chained: router.route('/path').get(handler)
├── optional-chaining.ts   # app?.get('/path', handler)
└── nested-callbacks.ts    # Callbacks with various patterns
```

**`express-routes.ts` fixture:**

```typescript
import { Router } from 'express'
const app = Router()

app.get('/api/users', (req, res) => {
  handleError(req, res)
  const data = fetchUsers()
  res.json(data)
})

app.post('/api/users', (req, res) => {
  // Missing handleError --- should be caught by rules
  const user = createUser(req.body)
  res.json(user)
})

app.get('/api/admin/settings', (req, res) => {
  authenticate(req)
  handleError(req, res)
  res.json(getSettings())
})

app.use(cors())
app.use('/api', apiRouter)
```

### Unit Tests: ArchCall Model (`tests/models/arch-call.test.ts`)

```
describe('ArchCall model')
  describe('fromCallExpression')
    - getName() returns "app.get" for property access calls
    - getName() returns "handleError" for bare function calls
    - getObjectName() returns "app" for app.get()
    - getObjectName() returns undefined for bare calls
    - getMethodName() returns "get" for app.get()
    - getMethodName() returns "handleError" for bare calls
    - getSourceFile() returns the containing source file
    - getStartLineNumber() returns correct line number
    - getArguments() returns all call arguments
    - handles chained property access: router.route.get()
    - handles optional chaining: app?.get()

  describe('collectCalls')
    - collects all call expressions from a source file
    - includes nested calls inside callbacks
    - returns empty array for files with no calls
```

### Unit Tests: Call Predicates (`tests/predicates/call.test.ts`)

```
describe('call predicates')
  describe('onObject')
    - matches calls on the specified object
    - does not match calls on a different object
    - does not match bare function calls (no object)
    - normalizes optional chaining: app?.get matches onObject('app')
    - handles chained objects: router.route matches onObject('router.route')

  describe('withMethod')
    - string: matches exact method name
    - string: does not match different method name
    - regex: matches method name against pattern
    - regex: /^(get|post)$/ matches get and post, not getAll
    - matches bare function name when no object

  describe('withArgMatching')
    - matches argument text at given index against regex
    - does not match when index is out of bounds
    - matches string literal arguments
    - matches variable reference arguments

  describe('withStringArg')
    - matches string literal at given index against glob
    - glob '/api/users/**' matches '/api/users/123'
    - does not match non-string-literal arguments
    - does not match when index is out of bounds
    - does not match template literals with substitutions

  describe('combined predicates')
    - onObject('app').withMethod('get') narrows correctly
    - onObject('app').withMethod('get').withStringArg(0, '/api/**') triple filter
```

### Unit Tests: Call Conditions (`tests/conditions/call.test.ts`)

```
describe('call conditions')
  describe('notExist')
    - returns a violation for each matching call
    - returns empty array when no calls match

  describe('haveCallbackContaining')
    - passes when callback contains the specified call
    - fails when callback does not contain the specified call
    - searches all function-like arguments (not just last)
    - handles arrow function callbacks: (req, res) => { ... }
    - handles function expression callbacks: function(req, res) { ... }
    - ignores non-function arguments (strings, objects)
    - works with call() matcher
    - works with access() matcher
    - works with newExpr() matcher

  describe('notHaveCallbackContaining')
    - passes when callback does NOT contain the specified call
    - fails with violation for each matching node in callbacks
    - reports correct line numbers for violations
```

### Integration Tests: CallRuleBuilder (`tests/builders/call-rule-builder.test.ts`)

```
describe('CallRuleBuilder')
  describe('predicate chaining')
    - .that().onObject('app') filters to object calls
    - .that().onObject('app').and().withMethod('get') combines predicates
    - .that().withStringArg(0, '/api/**') filters by route path
    - .that().resideInFile('**/routes.ts') uses identity predicates
    - .that().haveNameMatching(/^app\./) uses name matching

  describe('condition evaluation')
    - .should().haveCallbackContaining(call('handleError')).check() passes
    - .should().haveCallbackContaining(call('handleError')).check() throws on violation
    - .should().notExist().check() passes when no calls match
    - .should().notExist().check() throws when calls match
    - .warn() logs but does not throw

  describe('named selections (reusable queries)')
    - predicate chain can be saved and reused across rules
    - .should() forks correctly for multiple conditions
```

### End-to-End Tests (`tests/integration/call-entry-point.test.ts`)

```
describe('calls() entry point — end-to-end')
  describe('Express route patterns')
    - detects route handlers missing handleError()
    - all routes with /api/admin/** must call authenticate()
    - app.use() calls are selectable separately from routes

  describe('framework-agnostic patterns')
    - works with Fastify-style registrations
    - works with bare function calls (not method calls)
    - optional chaining does not break matching

  describe('real-world rule patterns from spec')
    - routes.should().haveCallbackContaining(call('handleError'))
    - routes.should().haveCallbackContaining(call('normalizePagination'))
    - calls(p).that().onObject('db').should().notExist() in route files

  describe('custom predicates via .satisfy()')
    - definePredicate<ArchCall> works with CallRuleBuilder
```

## Out of Scope

The following are explicitly deferred to later plans:

- **`within()` scoped rules** --- plan 0015. Depends on `calls()` being available but is a separate concept (restricting the search space of other entry points to callbacks of matched calls).
- **Argument-level matching: `call('foo').withArgument(access('x.y'))`** --- Phase 2 extension per spec section 6.3.5. The current plan provides `withArgMatching(index, pattern)` which covers the common case.
- **Symbol-aware matching: `symbolOf()`, `resolvesTo()`** --- Phase 2 per spec section 6.3.1. Name-based matching covers the majority of real-world cases.
- **`definePattern` / `followPattern`** --- plan 0017.
- **Code frames on call violations** --- `createCallViolation` does not generate code frames in the initial implementation. This can be added by delegating to `generateCodeFrame` from the CallExpression's source text and line number. Low priority since the file + line number is already actionable.
- **Performance optimization: pre-indexing call expressions** --- the query engine (spec section 13.1) mentions pre-indexing. For the initial implementation, `collectCalls` walks source files on each `getElements()` call. Memoization can be added to `ArchProject` later if profiling shows it matters.
