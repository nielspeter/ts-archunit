# Plan 0011: Body Analysis — call(), access(), newExpr(), expression()

## Status

- **State:** Complete
- **Priority:** P0 — Differentiating feature; no other TS architecture tool does body analysis
- **Effort:** 2-3 days
- **Created:** 2026-03-26
- **Depends on:** 0008 (ClassRuleBuilder), 0009 (FunctionRuleBuilder / ArchFunction)

## Purpose

Implement body analysis — the ability to inspect what happens _inside_ function and method bodies. This is the feature that sets ts-archunit apart from every other TypeScript architecture tool. After this plan, users can write rules like:

```typescript
// Services extending BaseService must not call parseInt directly
classes(p)
  .that()
  .extend('BaseService')
  .should()
  .notContain(call('parseInt'))
  .because('use this.normalizeCount() instead')
  .check()

// Services must throw DomainError, not generic Error
classes(p)
  .that()
  .extend('BaseService')
  .should()
  .notContain(newExpr('Error'))
  .because('use DomainError for domain-specific errors')
  .check()

// Enforce use of DomainError instead of Error (combined check)
classes(p)
  .that()
  .extend('BaseService')
  .should()
  .useInsteadOf(newExpr('Error'), newExpr('DomainError'))
  .check()

// Functions must not access process.env directly
functions(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notContain(access('process.env'))
  .because('use Config injection instead')
  .check()

// Escape hatch: match any expression by text
functions(p).should().notContain(expression('eval')).check()
```

### Design Decision: Matcher Objects (Not AST Visitors)

Body analysis uses a two-layer design:

1. **Matcher layer** — helper functions (`call()`, `access()`, `newExpr()`, `expression()`) return `ExpressionMatcher` objects. Each matcher knows which `SyntaxKind` it targets and how to test a single node.
2. **Condition layer** — `contain()`, `notContain()`, and `useInsteadOf()` are condition factories. They receive matchers, walk the body AST using `getDescendantsOfKind()`, and test each node.

This separation means matchers are reusable, testable in isolation, and composable. Conditions handle the "for each element, check all methods/body" traversal logic.

### Design Decision: Class Body = All Methods Combined

For `ClassDeclaration`, "the body" means all method bodies in the class aggregated:

- `contain(matcher)` — at least one method in the class has a matching node (class passes)
- `notContain(matcher)` — no method in the class has a matching node (class passes); if ANY method has it, the class fails

This matches the intuition: "classes extending BaseService should not contain `call('parseInt')`" means no method in any such class should call parseInt.

### Design Decision: Optional Chaining Normalization

The PoC (probe 2) confirmed that `CallExpression.getExpression().getText()` returns `this?.normalizeCount` for optional chaining calls. To avoid forcing users to match both `this.foo` and `this?.foo`, all matchers normalize optional chaining by replacing `?.` with `.` before matching. The user writes `call('this.normalizeCount')` and it matches both `this.normalizeCount(x)` and `this?.normalizeCount(x)`.

### Design Decision: ArchFunction Body Access

`ArchFunction.getBody()` (from plan 0009) returns `Node | undefined`. For arrow functions with expression bodies (`() => expr`), the body is the expression itself — `getDescendantsOfKind` still works because it walks the full subtree. The condition layer handles `undefined` bodies by treating them as empty (no matches, no violations for `notContain`, violation for `contain`).

## Phase 1: ExpressionMatcher Interface & Helpers

### `src/helpers/matchers.ts` (new)

```typescript
import { Node, SyntaxKind } from 'ts-morph'

/**
 * A matcher that tests whether a ts-morph AST node matches a specific pattern.
 *
 * Matchers are created by helper functions (call, access, newExpr, expression)
 * and consumed by body analysis conditions (contain, notContain, useInsteadOf).
 */
export interface ExpressionMatcher {
  /** Human-readable description for violation messages */
  readonly description: string

  /**
   * The SyntaxKind(s) this matcher targets.
   * Used to narrow the AST traversal — only nodes of these kinds are tested.
   * If undefined, all descendant nodes are tested (used by expression()).
   */
  readonly syntaxKinds?: SyntaxKind[]

  /**
   * Test whether a single AST node matches this pattern.
   *
   * Precondition: the node's kind is one of `syntaxKinds` (if specified).
   * The condition layer enforces this — matchers can assume the kind is correct.
   */
  matches(node: Node): boolean
}

/**
 * Normalize expression text for matching.
 * Replaces optional chaining `?.` with `.` so users don't need to
 * account for both forms.
 *
 * PoC finding: `this?.normalizeCount` getText() includes the `?`.
 */
function normalizeText(text: string): string {
  return text.replace(/\?\./g, '.')
}

/**
 * Match a CallExpression by function/method name.
 *
 * Matches against `CallExpression.getExpression().getText()` after
 * normalizing optional chaining.
 *
 * @param nameOrRegex - Exact name (e.g. 'parseInt', 'this.normalizeCount')
 *                      or regex for flexible matching.
 *
 * @example
 * call('parseInt')                    // matches parseInt(x)
 * call('this.normalizeCount')         // matches this.normalizeCount(x) AND this?.normalizeCount(x)
 * call(/^console\./)                  // matches console.log, console.warn, etc.
 */
export function call(nameOrRegex: string | RegExp): ExpressionMatcher {
  if (typeof nameOrRegex === 'string') {
    return {
      description: `call to '${nameOrRegex}'`,
      syntaxKinds: [SyntaxKind.CallExpression],
      matches(node: Node): boolean {
        if (!Node.isCallExpression(node)) return false
        const text = normalizeText(node.getExpression().getText())
        return text === nameOrRegex
      },
    }
  }
  return {
    description: `call matching ${String(nameOrRegex)}`,
    syntaxKinds: [SyntaxKind.CallExpression],
    matches(node: Node): boolean {
      if (!Node.isCallExpression(node)) return false
      const text = normalizeText(node.getExpression().getText())
      return nameOrRegex.test(text)
    },
  }
}

/**
 * Match a PropertyAccessExpression by the dotted chain.
 *
 * Matches against `PropertyAccessExpression.getText()` after normalizing
 * optional chaining. Useful for detecting direct property access patterns
 * like `process.env`, `this.db`, `window.location`.
 *
 * @param chain - Exact dotted chain (e.g. 'process.env') or regex.
 *
 * @example
 * access('process.env')               // matches process.env.FOO (the inner access)
 * access(/^this\.db/)                 // matches this.db, this.db.query, etc.
 */
export function access(chain: string | RegExp): ExpressionMatcher {
  if (typeof chain === 'string') {
    return {
      description: `access to '${chain}'`,
      syntaxKinds: [SyntaxKind.PropertyAccessExpression],
      matches(node: Node): boolean {
        if (!Node.isPropertyAccessExpression(node)) return false
        const text = normalizeText(node.getText())
        return text === chain
      },
    }
  }
  return {
    description: `access matching ${String(chain)}`,
    syntaxKinds: [SyntaxKind.PropertyAccessExpression],
    matches(node: Node): boolean {
      if (!Node.isPropertyAccessExpression(node)) return false
      const text = normalizeText(node.getText())
      return chain.test(text)
    },
  }
}

/**
 * Match a NewExpression by constructor name.
 *
 * Matches against `NewExpression.getExpression().getText()`.
 * The PoC confirmed this correctly distinguishes 'Error' from 'DomainError'.
 *
 * @param nameOrRegex - Exact constructor name or regex.
 *
 * @example
 * newExpr('Error')                    // matches new Error(...) but NOT new DomainError(...)
 * newExpr('DomainError')              // matches new DomainError(...)
 * newExpr(/Error$/)                   // matches new Error, new DomainError, new TypeError, etc.
 */
export function newExpr(nameOrRegex: string | RegExp): ExpressionMatcher {
  if (typeof nameOrRegex === 'string') {
    return {
      description: `new '${nameOrRegex}'`,
      syntaxKinds: [SyntaxKind.NewExpression],
      matches(node: Node): boolean {
        if (!Node.isNewExpression(node)) return false
        const text = node.getExpression().getText()
        return text === nameOrRegex
      },
    }
  }
  return {
    description: `new matching ${String(nameOrRegex)}`,
    syntaxKinds: [SyntaxKind.NewExpression],
    matches(node: Node): boolean {
      if (!Node.isNewExpression(node)) return false
      const text = node.getExpression().getText()
      return nameOrRegex.test(text)
    },
  }
}

/**
 * Escape hatch: match any node whose getText() contains or matches the given pattern.
 *
 * This is intentionally broad and should be used sparingly. It walks ALL
 * descendant nodes and checks getText() against the pattern. A runtime
 * console.warn is emitted the first time expression() is used, encouraging
 * users to prefer call/access/newExpr where possible.
 *
 * @param textOrRegex - Substring to search for (string) or regex pattern.
 *
 * @example
 * expression('eval')                  // matches any node containing 'eval'
 * expression(/document\.write/)       // matches document.write calls
 */
export function expression(textOrRegex: string | RegExp): ExpressionMatcher {
  let warned = false
  if (typeof textOrRegex === 'string') {
    return {
      description: `expression containing '${textOrRegex}'`,
      // No syntaxKinds — walks all descendants
      matches(node: Node): boolean {
        if (!warned) {
          console.warn(
            `[ts-archunit] expression('${textOrRegex}') is a broad matcher. ` +
              `Prefer call(), access(), or newExpr() for precise matching.`,
          )
          warned = true
        }
        return node.getText().includes(textOrRegex)
      },
    }
  }
  return {
    description: `expression matching ${String(textOrRegex)}`,
    // No syntaxKinds — walks all descendants
    matches(node: Node): boolean {
      if (!warned) {
        console.warn(
          `[ts-archunit] expression(${String(textOrRegex)}) is a broad matcher. ` +
            `Prefer call(), access(), or newExpr() for precise matching.`,
        )
        warned = true
      }
      return textOrRegex.test(node.getText())
    },
  }
}
```

Key implementation notes:

- `normalizeText()` is a module-private helper. Only `call()` and `access()` use it — `newExpr()` does not because constructor names never use optional chaining.
- `expression()` emits a warning on first use via a closure-scoped `warned` flag. The warning fires once per matcher instance, not once per node tested.
- Each matcher's `syntaxKinds` array tells the condition layer which `getDescendantsOfKind()` to use. When `syntaxKinds` is undefined (expression()), the condition falls back to `getDescendants()` (all nodes).
- String matchers use exact equality (`===`). Regex matchers use `.test()`. Users who want substring matching use regex: `call(/parseInt/)`.

## Phase 2: Body Traversal Utility

### `src/helpers/body-traversal.ts` (new)

```typescript
import { type Node, type ClassDeclaration, SyntaxKind } from 'ts-morph'
import type { ExpressionMatcher } from './matchers.js'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Result of searching a body for matcher hits.
 */
export interface MatchResult {
  /** Whether at least one match was found */
  found: boolean
  /** The matching nodes (for violation reporting: file, line, text) */
  matchingNodes: Node[]
}

/**
 * Find all nodes in a body that match the given matcher.
 *
 * Uses getDescendantsOfKind when the matcher specifies syntaxKinds
 * (efficient — only walks nodes of that kind). Falls back to
 * getDescendants() for matchers without syntaxKinds (expression()).
 */
function findMatchesInBody(body: Node, matcher: ExpressionMatcher): Node[] {
  const matches: Node[] = []

  if (matcher.syntaxKinds && matcher.syntaxKinds.length > 0) {
    // Targeted traversal: only check nodes of the specified kinds
    for (const kind of matcher.syntaxKinds) {
      for (const node of body.getDescendantsOfKind(kind)) {
        if (matcher.matches(node)) {
          matches.push(node)
        }
      }
    }
  } else {
    // Broad traversal: check every descendant node
    for (const node of body.getDescendants()) {
      if (matcher.matches(node)) {
        matches.push(node)
      }
    }
  }

  return matches
}

/**
 * Search all method bodies in a class for matches.
 *
 * Iterates over every method (instance and static), gets the body,
 * and tests each body against the matcher. Returns aggregated results.
 */
export function searchClassBody(cls: ClassDeclaration, matcher: ExpressionMatcher): MatchResult {
  const matchingNodes: Node[] = []

  for (const method of cls.getMethods()) {
    const body = method.getBody()
    if (!body) continue
    matchingNodes.push(...findMatchesInBody(body, matcher))
  }

  // Also check constructor body
  const ctor = cls.getConstructors()[0]
  if (ctor) {
    const body = ctor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInBody(body, matcher))
    }
  }

  // Also check getters and setters
  for (const accessor of cls.getGetAccessors()) {
    const body = accessor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInBody(body, matcher))
    }
  }
  for (const accessor of cls.getSetAccessors()) {
    const body = accessor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInBody(body, matcher))
    }
  }

  return {
    found: matchingNodes.length > 0,
    matchingNodes,
  }
}

/**
 * Search a function body for matches.
 *
 * Uses ArchFunction.getBody() which returns the function/arrow body.
 * For expression-bodied arrows (`() => expr`), getDescendantsOfKind
 * still works — it walks the expression subtree.
 */
export function searchFunctionBody(fn: ArchFunction, matcher: ExpressionMatcher): MatchResult {
  const body = fn.getBody()
  if (!body) {
    return { found: false, matchingNodes: [] }
  }

  const matchingNodes = findMatchesInBody(body, matcher)
  return {
    found: matchingNodes.length > 0,
    matchingNodes,
  }
}
```

Key implementation notes:

- `searchClassBody` checks methods, constructors, getters, and setters. It does NOT check property initializers (e.g. `private x = parseInt('5')`) — this is a deliberate scope limitation for Phase 1. Can be added later.
- `findMatchesInBody` is the core traversal. When `syntaxKinds` is specified, it makes one `getDescendantsOfKind()` call per kind — this is efficient because ts-morph uses the TypeScript compiler's built-in tree walker.
- The PoC (probe 2) confirmed that `getDescendantsOfKind` finds nested calls (e.g. `parseInt` inside `Math.max`). No special recursion is needed.

## Phase 3: Body Analysis Conditions

### `src/conditions/body-analysis.ts` (new)

```typescript
import type { ClassDeclaration, Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementName } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import { searchClassBody } from '../helpers/body-traversal.js'

// ─── Class body conditions ──────────────────────────────────────────

/**
 * Class body must contain at least one node matching the matcher.
 *
 * Violation if NO method in the class contains a match.
 */
export function classContain(matcher: ExpressionMatcher): Condition<ClassDeclaration> {
  return {
    description: `contain ${matcher.description}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const result = searchClassBody(cls, matcher)
        if (!result.found) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} does not contain ${matcher.description}`,
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
 * Class body must NOT contain any node matching the matcher.
 *
 * Violation for EACH matching node found in any method.
 * Reports the specific line where the violation occurs.
 */
export function classNotContain(matcher: ExpressionMatcher): Condition<ClassDeclaration> {
  return {
    description: `not contain ${matcher.description}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const result = searchClassBody(cls, matcher)
        for (const node of result.matchingNodes) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} contains ${matcher.description} at line ${String(node.getStartLineNumber())}`,
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
 * Class body must use the 'good' pattern instead of the 'bad' pattern.
 *
 * Combines notContain(bad) and contain(good) into a single condition
 * with better violation messages.
 *
 * Two types of violations:
 * 1. Class contains the 'bad' pattern — "use X instead of Y at line N"
 * 2. Class does not contain the 'good' pattern — "expected X but not found"
 */
export function classUseInsteadOf(
  bad: ExpressionMatcher,
  good: ExpressionMatcher,
): Condition<ClassDeclaration> {
  return {
    description: `use ${good.description} instead of ${bad.description}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const badResult = searchClassBody(cls, bad)
        const goodResult = searchClassBody(cls, good)

        // Report each occurrence of the bad pattern
        for (const node of badResult.matchingNodes) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} contains ${bad.description} at line ${String(node.getStartLineNumber())} — use ${good.description} instead`,
              context,
            ),
          )
        }

        // If the good pattern is missing entirely, report that too
        if (!goodResult.found) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} does not contain ${good.description}`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}
```

### `src/conditions/body-analysis-function.ts` (new)

The function variants are separate because `ArchFunction` is not a `Node` — the condition must use `fn.getNode()` for `createViolation` and `fn.getBody()` for traversal.

```typescript
import type { Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchFunction } from '../models/arch-function.js'
import { searchFunctionBody } from '../helpers/body-traversal.js'

/**
 * Create an ArchViolation from an ArchFunction (not a Node).
 *
 * ArchFunction is not a Node, so we can't use createViolation directly.
 * This helper bridges the gap.
 */
function createFunctionViolation(
  fn: ArchFunction,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: fn.getName() ?? '<anonymous>',
    file: fn.getSourceFile().getFilePath(),
    line: fn.getStartLineNumber(),
    message,
    because: context.because,
  }
}

/**
 * Function body must contain at least one node matching the matcher.
 */
export function functionContain(matcher: ExpressionMatcher): Condition<ArchFunction> {
  return {
    description: `contain ${matcher.description}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const result = searchFunctionBody(fn, matcher)
        if (!result.found) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} does not contain ${matcher.description}`,
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
 * Function body must NOT contain any node matching the matcher.
 */
export function functionNotContain(matcher: ExpressionMatcher): Condition<ArchFunction> {
  return {
    description: `not contain ${matcher.description}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const result = searchFunctionBody(fn, matcher)
        for (const node of result.matchingNodes) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} contains ${matcher.description} at line ${String(node.getStartLineNumber())}`,
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
 * Function body must use the 'good' pattern instead of the 'bad' pattern.
 */
export function functionUseInsteadOf(
  bad: ExpressionMatcher,
  good: ExpressionMatcher,
): Condition<ArchFunction> {
  return {
    description: `use ${good.description} instead of ${bad.description}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const badResult = searchFunctionBody(fn, bad)
        const goodResult = searchFunctionBody(fn, good)

        for (const node of badResult.matchingNodes) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} contains ${bad.description} at line ${String(node.getStartLineNumber())} — use ${good.description} instead`,
              context,
            ),
          )
        }

        if (!goodResult.found) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} does not contain ${good.description}`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}
```

## Phase 4: Wire into Builders

### Update `src/builders/class-rule-builder.ts`

Add body analysis condition methods to `ClassRuleBuilder`:

```typescript
import type { ExpressionMatcher } from '../helpers/matchers.js'
import {
  classContain,
  classNotContain,
  classUseInsteadOf,
} from '../conditions/body-analysis.js'

// ... inside ClassRuleBuilder class:

  // --- Body analysis condition methods (plan 0011) ---

  /**
   * Assert that the class body contains at least one match.
   * "Body" = all method bodies, constructor, getters, setters combined.
   */
  contain(matcher: ExpressionMatcher): this {
    return this.addCondition(classContain(matcher))
  }

  /**
   * Assert that the class body does NOT contain any match.
   * Produces one violation per matching node found.
   */
  notContain(matcher: ExpressionMatcher): this {
    return this.addCondition(classNotContain(matcher))
  }

  /**
   * Assert: must NOT contain 'bad' AND must contain 'good'.
   * Better violation messages than combining notContain + contain separately.
   */
  useInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher): this {
    return this.addCondition(classUseInsteadOf(bad, good))
  }
```

### Update `src/builders/function-rule-builder.ts`

Add body analysis condition methods to `FunctionRuleBuilder`:

```typescript
import type { ExpressionMatcher } from '../helpers/matchers.js'
import {
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
} from '../conditions/body-analysis-function.js'

// ... inside FunctionRuleBuilder class:

  // --- Body analysis condition methods (plan 0011) ---

  contain(matcher: ExpressionMatcher): this {
    return this.addCondition(functionContain(matcher))
  }

  notContain(matcher: ExpressionMatcher): this {
    return this.addCondition(functionNotContain(matcher))
  }

  useInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher): this {
    return this.addCondition(functionUseInsteadOf(bad, good))
  }
```

### Update `src/index.ts`

Export the public API surface:

```typescript
// Body analysis helpers
export { call, access, newExpr, expression } from './helpers/matchers.js'
export type { ExpressionMatcher } from './helpers/matchers.js'

// Body analysis conditions (for advanced composition)
export { classContain, classNotContain, classUseInsteadOf } from './conditions/body-analysis.js'
export {
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
} from './conditions/body-analysis-function.js'
```

## Phase 5: Tests

Tests use the existing PoC fixtures extensively — `BaseService`, `ProductService` (bad), `OrderService` (good), `EdgeCaseService` (edge cases). These fixtures were designed specifically for body analysis testing.

### `tests/helpers/matchers.test.ts` (new)

```typescript
import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import { call, access, newExpr, expression } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('ExpressionMatcher helpers', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  // Get a known CallExpression node for testing
  function getCallNode(className: string, methodName: string, callText: string) {
    const cls = project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === className)!
    const method = cls.getMethod(methodName)!
    return method
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => c.getExpression().getText() === callText)!
  }

  function getNewExprNode(className: string, methodName: string, ctorText: string) {
    const cls = project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === className)!
    const method = cls.getMethod(methodName)!
    return method
      .getDescendantsOfKind(SyntaxKind.NewExpression)
      .find((n) => n.getExpression().getText() === ctorText)!
  }

  describe('call()', () => {
    it('matches parseInt CallExpression with exact string', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(call('parseInt').matches(node)).toBe(true)
    })

    it('rejects non-matching call name', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(call('parseFloat').matches(node)).toBe(false)
    })

    it('matches this.normalizeCount with exact string', () => {
      const node = getCallNode('OrderService', 'getTotal', 'this.normalizeCount')
      expect(call('this.normalizeCount').matches(node)).toBe(true)
    })

    it('normalizes optional chaining: this?.normalizeCount matches this.normalizeCount', () => {
      // EdgeCaseService.withOptionalChain calls this?.normalizeCount
      const cls = project
        .getSourceFiles()
        .flatMap((sf) => sf.getClasses())
        .find((c) => c.getName() === 'EdgeCaseService')!
      const method = cls.getMethod('withOptionalChain')!
      const calls = method.getDescendantsOfKind(SyntaxKind.CallExpression)
      const optionalCall = calls.find((c) =>
        c.getExpression().getText().includes('normalizeCount'),
      )!
      // User writes 'this.normalizeCount' — should match optional chaining too
      expect(call('this.normalizeCount').matches(optionalCall)).toBe(true)
    })

    it('matches with regex', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(call(/^parse/).matches(node)).toBe(true)
    })

    it('regex does not match unrelated call', () => {
      const node = getCallNode('OrderService', 'getTotal', 'this.normalizeCount')
      expect(call(/^parse/).matches(node)).toBe(false)
    })

    it('does not match NewExpression nodes', () => {
      const node = getNewExprNode('ProductService', 'findById', 'Error')
      expect(call('Error').matches(node)).toBe(false)
    })

    it('has syntaxKinds for CallExpression', () => {
      expect(call('foo').syntaxKinds).toEqual([SyntaxKind.CallExpression])
    })

    it('has meaningful description for string', () => {
      expect(call('parseInt').description).toBe("call to 'parseInt'")
    })

    it('has meaningful description for regex', () => {
      expect(call(/^parse/).description).toBe('call matching /^parse/')
    })
  })

  describe('newExpr()', () => {
    it('matches new Error with exact string', () => {
      const node = getNewExprNode('ProductService', 'findById', 'Error')
      expect(newExpr('Error').matches(node)).toBe(true)
    })

    it('distinguishes Error from DomainError', () => {
      const node = getNewExprNode('OrderService', 'findById', 'DomainError')
      expect(newExpr('Error').matches(node)).toBe(false)
      expect(newExpr('DomainError').matches(node)).toBe(true)
    })

    it('matches with regex', () => {
      const node = getNewExprNode('OrderService', 'findById', 'DomainError')
      expect(newExpr(/Error$/).matches(node)).toBe(true)
    })

    it('does not match CallExpression nodes', () => {
      const node = getCallNode('ProductService', 'getTotal', 'parseInt')
      expect(newExpr('parseInt').matches(node)).toBe(false)
    })

    it('has syntaxKinds for NewExpression', () => {
      expect(newExpr('Error').syntaxKinds).toEqual([SyntaxKind.NewExpression])
    })
  })

  describe('access()', () => {
    it('has syntaxKinds for PropertyAccessExpression', () => {
      expect(access('process.env').syntaxKinds).toEqual([SyntaxKind.PropertyAccessExpression])
    })

    it('has meaningful description', () => {
      expect(access('process.env').description).toBe("access to 'process.env'")
    })
  })

  describe('expression()', () => {
    it('has no syntaxKinds (walks all nodes)', () => {
      expect(expression('eval').syntaxKinds).toBeUndefined()
    })

    it('has meaningful description for string', () => {
      expect(expression('eval').description).toBe("expression containing 'eval'")
    })

    it('has meaningful description for regex', () => {
      expect(expression(/eval/).description).toBe('expression matching /eval/')
    })
  })
})
```

### `tests/helpers/body-traversal.test.ts` (new)

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { searchClassBody } from '../../src/helpers/body-traversal.js'
import { call, newExpr } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Body traversal', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  function findClass(name: string) {
    return project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === name)!
  }

  describe('searchClassBody()', () => {
    it('finds parseInt in ProductService (bad service)', () => {
      const result = searchClassBody(findClass('ProductService'), call('parseInt'))
      expect(result.found).toBe(true)
      expect(result.matchingNodes.length).toBeGreaterThan(0)
    })

    it('does NOT find parseInt in OrderService (good service)', () => {
      const result = searchClassBody(findClass('OrderService'), call('parseInt'))
      expect(result.found).toBe(false)
      expect(result.matchingNodes).toHaveLength(0)
    })

    it('finds new Error in ProductService', () => {
      const result = searchClassBody(findClass('ProductService'), newExpr('Error'))
      expect(result.found).toBe(true)
    })

    it('does NOT find new Error in OrderService (uses DomainError)', () => {
      const result = searchClassBody(findClass('OrderService'), newExpr('Error'))
      expect(result.found).toBe(false)
    })

    it('finds new DomainError in OrderService', () => {
      const result = searchClassBody(findClass('OrderService'), newExpr('DomainError'))
      expect(result.found).toBe(true)
    })

    it('finds nested parseInt in EdgeCaseService.withNesting', () => {
      const result = searchClassBody(findClass('EdgeCaseService'), call('parseInt'))
      expect(result.found).toBe(true)
    })

    it('finds multiple violations in EdgeCaseService', () => {
      const parseResult = searchClassBody(findClass('EdgeCaseService'), call('parseInt'))
      const errorResult = searchClassBody(findClass('EdgeCaseService'), newExpr('Error'))
      expect(parseResult.found).toBe(true)
      expect(errorResult.found).toBe(true)
    })

    it('returns matching nodes with correct line numbers', () => {
      const result = searchClassBody(findClass('ProductService'), call('parseInt'))
      expect(result.matchingNodes.length).toBeGreaterThan(0)
      for (const node of result.matchingNodes) {
        expect(node.getStartLineNumber()).toBeGreaterThan(0)
      }
    })
  })
})
```

### `tests/conditions/body-analysis.test.ts` (new)

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  classContain,
  classNotContain,
  classUseInsteadOf,
} from '../../src/conditions/body-analysis.js'
import { call, newExpr } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Body analysis conditions (class)', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  function findClass(name: string) {
    return project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === name)!
  }

  const context = { rule: 'test rule' }

  describe('classContain()', () => {
    it('passes when class contains the call', () => {
      const condition = classContain(call('parseInt'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails when class does NOT contain the call', () => {
      const condition = classContain(call('parseInt'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not contain')
      expect(violations[0]!.message).toContain('parseInt')
    })

    it('has correct description', () => {
      expect(classContain(call('parseInt')).description).toBe("contain call to 'parseInt'")
    })
  })

  describe('classNotContain()', () => {
    it('passes when class does NOT contain the call', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails when class contains the call', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]!.message).toContain('contains')
      expect(violations[0]!.message).toContain('parseInt')
    })

    it('reports one violation per matching node', () => {
      // EdgeCaseService.withNesting and .withMultiple both have parseInt
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('EdgeCaseService')], context)
      expect(violations.length).toBeGreaterThanOrEqual(2)
    })

    it('violation includes line number', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations[0]!.message).toMatch(/line \d+/)
    })

    it('passes for new Error on OrderService (uses DomainError)', () => {
      const condition = classNotContain(newExpr('Error'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(0)
    })

    it('fails for new Error on ProductService', () => {
      const condition = classNotContain(newExpr('Error'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  describe('classUseInsteadOf()', () => {
    it('no violations when class uses good and avoids bad', () => {
      const condition = classUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
      const violations = condition.evaluate([findClass('OrderService')], context)
      expect(violations).toHaveLength(0)
    })

    it('reports bad usage AND missing good', () => {
      const condition = classUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
      const violations = condition.evaluate([findClass('ProductService')], context)
      // ProductService has new Error (bad) and no new DomainError (missing good)
      expect(violations.length).toBeGreaterThanOrEqual(2)
      const messages = violations.map((v) => v.message)
      expect(messages.some((m) => m.includes('instead'))).toBe(true)
      expect(messages.some((m) => m.includes('does not contain'))).toBe(true)
    })

    it('has correct description', () => {
      const condition = classUseInsteadOf(newExpr('Error'), newExpr('DomainError'))
      expect(condition.description).toBe("use new 'DomainError' instead of new 'Error'")
    })
  })

  describe('multiple elements', () => {
    it('checks each class independently', () => {
      const condition = classNotContain(call('parseInt'))
      const violations = condition.evaluate(
        [findClass('OrderService'), findClass('ProductService')],
        context,
      )
      // OrderService passes (no parseInt), ProductService fails
      const violatingElements = violations.map((v) => v.element)
      expect(violatingElements).not.toContain('OrderService')
      expect(violatingElements).toContain('ProductService')
    })
  })
})
```

### `tests/integration/body-analysis.test.ts` (new)

End-to-end tests using the full fluent API chain:

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'

// These imports match the public API surface
// import { classes, call, newExpr, access } from '../../src/index.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Integration: body analysis via fluent API', () => {
  // NOTE: These tests use the full builder chain.
  // They serve as the acceptance tests for the body analysis feature.
  // The exact import paths depend on plans 0007/0008 being implemented.

  it('classes extending BaseService should not contain call to parseInt', () => {
    // classes(p).that().extend('BaseService')
    //   .should().notContain(call('parseInt'))
    //   .because('use this.normalizeCount() instead')
    //   .check()
    //
    // Expected: ProductService and EdgeCaseService fail, OrderService passes
  })

  it('classes extending BaseService should not contain new Error', () => {
    // classes(p).that().extend('BaseService')
    //   .should().notContain(newExpr('Error'))
    //   .because('use DomainError for domain-specific errors')
    //   .check()
    //
    // Expected: ProductService fails (new Error), OrderService passes (new DomainError)
  })

  it('useInsteadOf combines both checks', () => {
    // classes(p).that().extend('BaseService')
    //   .should().useInsteadOf(newExpr('Error'), newExpr('DomainError'))
    //   .check()
    //
    // Expected: ProductService fails on both counts
  })

  it('andShould chains multiple body conditions', () => {
    // classes(p).that().extend('BaseService')
    //   .should().notContain(call('parseInt'))
    //   .andShould().notContain(newExpr('Error'))
    //   .check()
    //
    // Expected: ProductService fails both, EdgeCaseService fails parseInt only
  })

  it('regex matchers work through the builder', () => {
    // classes(p).that().extend('BaseService')
    //   .should().notContain(call(/^parse/))
    //   .check()
    //
    // Expected: ProductService and EdgeCaseService fail
  })
})
```

Note: The integration tests are sketched as comments because they depend on plans 0007/0008 being implemented first. They should be uncommented and completed when wiring is done.

## Files Changed

| File                                       | Change                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/helpers/matchers.ts`                  | New -- `ExpressionMatcher` interface, `call()`, `access()`, `newExpr()`, `expression()` helpers |
| `src/helpers/body-traversal.ts`            | New -- `searchClassBody()`, `searchFunctionBody()`, `findMatchesInBody()`                       |
| `src/conditions/body-analysis.ts`          | New -- `classContain()`, `classNotContain()`, `classUseInsteadOf()`                             |
| `src/conditions/body-analysis-function.ts` | New -- `functionContain()`, `functionNotContain()`, `functionUseInsteadOf()`                    |
| `src/builders/class-rule-builder.ts`       | Modified -- add `contain()`, `notContain()`, `useInsteadOf()` methods                           |
| `src/builders/function-rule-builder.ts`    | Modified -- add `contain()`, `notContain()`, `useInsteadOf()` methods                           |
| `src/index.ts`                             | Modified -- export matchers, ExpressionMatcher type, body analysis conditions                   |
| `tests/helpers/matchers.test.ts`           | New -- 20 tests for matcher helpers                                                             |
| `tests/helpers/body-traversal.test.ts`     | New -- 8 tests for body traversal                                                               |
| `tests/conditions/body-analysis.test.ts`   | New -- 12 tests for class body conditions                                                       |
| `tests/integration/body-analysis.test.ts`  | New -- 5 integration tests (stubbed until builders are wired)                                   |

## Test Inventory

| #   | Test                                                    | File                | What it validates                                     |
| --- | ------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| 1   | call() matches parseInt with exact string               | matchers.test       | PoC finding: getExpression().getText() === 'parseInt' |
| 2   | call() rejects non-matching name                        | matchers.test       | Exact match semantics                                 |
| 3   | call() matches this.normalizeCount                      | matchers.test       | Dotted chain matching                                 |
| 4   | call() normalizes optional chaining                     | matchers.test       | PoC finding: `this?.foo` -> `this.foo`                |
| 5   | call() matches with regex                               | matchers.test       | Regex variant                                         |
| 6   | call() regex rejects non-matching                       | matchers.test       | Regex negative case                                   |
| 7   | call() does not match NewExpression                     | matchers.test       | Type safety: SyntaxKind filtering                     |
| 8   | call() has correct syntaxKinds                          | matchers.test       | Targeted traversal setup                              |
| 9   | call() string description                               | matchers.test       | Violation message readability                         |
| 10  | call() regex description                                | matchers.test       | Violation message readability                         |
| 11  | newExpr() matches new Error                             | matchers.test       | PoC finding: getExpression().getText() === 'Error'    |
| 12  | newExpr() distinguishes Error from DomainError          | matchers.test       | PoC finding: exact match, not substring               |
| 13  | newExpr() matches with regex                            | matchers.test       | Regex variant                                         |
| 14  | newExpr() does not match CallExpression                 | matchers.test       | Type safety                                           |
| 15  | newExpr() has correct syntaxKinds                       | matchers.test       | Targeted traversal setup                              |
| 16  | access() has correct syntaxKinds                        | matchers.test       | PropertyAccessExpression targeting                    |
| 17  | access() has meaningful description                     | matchers.test       | Violation message readability                         |
| 18  | expression() has no syntaxKinds                         | matchers.test       | Broad traversal (all nodes)                           |
| 19  | expression() string description                         | matchers.test       | Violation message readability                         |
| 20  | expression() regex description                          | matchers.test       | Violation message readability                         |
| 21  | searchClassBody finds parseInt in ProductService        | body-traversal.test | PoC parity: bad service detection                     |
| 22  | searchClassBody does NOT find parseInt in OrderService  | body-traversal.test | PoC parity: good service passes                       |
| 23  | searchClassBody finds new Error in ProductService       | body-traversal.test | NewExpression traversal                               |
| 24  | searchClassBody does NOT find new Error in OrderService | body-traversal.test | DomainError != Error                                  |
| 25  | searchClassBody finds new DomainError in OrderService   | body-traversal.test | Positive NewExpression match                          |
| 26  | searchClassBody finds nested parseInt                   | body-traversal.test | PoC finding: getDescendantsOfKind walks subtree       |
| 27  | searchClassBody finds multiple violations               | body-traversal.test | EdgeCaseService.withMultiple                          |
| 28  | searchClassBody returns nodes with line numbers         | body-traversal.test | Violation reporting data                              |
| 29  | classContain passes when present                        | body-analysis.test  | Positive contain semantics                            |
| 30  | classContain fails when absent                          | body-analysis.test  | Negative contain semantics                            |
| 31  | classContain has correct description                    | body-analysis.test  | Description composition                               |
| 32  | classNotContain passes when absent                      | body-analysis.test  | Positive notContain semantics                         |
| 33  | classNotContain fails when present                      | body-analysis.test  | Negative notContain semantics                         |
| 34  | classNotContain reports per-node violations             | body-analysis.test  | Multiple violations from one class                    |
| 35  | classNotContain violation includes line number          | body-analysis.test  | Precise location reporting                            |
| 36  | classNotContain passes for DomainError class            | body-analysis.test  | Error vs DomainError specificity                      |
| 37  | classNotContain fails for Error class                   | body-analysis.test  | NewExpression condition                               |
| 38  | classUseInsteadOf no violations for good class          | body-analysis.test  | OrderService passes both checks                       |
| 39  | classUseInsteadOf reports bad and missing good          | body-analysis.test  | ProductService: has bad, missing good                 |
| 40  | classUseInsteadOf has correct description               | body-analysis.test  | Description composition                               |
| 41  | multiple elements checked independently                 | body-analysis.test  | OrderService passes, ProductService fails             |
| 42  | E2E: notContain(call) via builder chain                 | integration.test    | Full fluent API                                       |
| 43  | E2E: notContain(newExpr) via builder chain              | integration.test    | Full fluent API                                       |
| 44  | E2E: useInsteadOf via builder chain                     | integration.test    | Combined condition                                    |
| 45  | E2E: andShould chains body conditions                   | integration.test    | Multiple conditions                                   |
| 46  | E2E: regex matchers via builder                         | integration.test    | Regex through full chain                              |

## Out of Scope

- **`call(name).withArgument(access('x.y'))` argument-level matching** -- Phase 2 feature. The `call()` helper returns a plain `ExpressionMatcher` for now, not a chainable object. Argument matching requires a `CallMatcher` sub-type with `.withArgument()` method. Deferred to a future plan.
- **Property initializer analysis** -- `searchClassBody` checks methods, constructors, getters, setters. It does NOT check class property initializers like `private x = parseInt('5')`. Rare enough to defer.
- **Static analysis of control flow** -- `notContain` does not distinguish dead code paths. If `parseInt` is in an `if (false)` branch, it still triggers a violation. This is correct for architecture rules (the code shouldn't be there at all).
- **Cross-file analysis** -- body analysis is local to a single class or function. It does not follow calls into other files. This is by design — architecture rules operate on structure, not runtime behavior.
- **Performance optimization** -- No caching of `getDescendantsOfKind` results between multiple conditions on the same element. If profiling shows this matters, the traversal utility can be extended with memoization.
- **`expression()` filtering by parent kind** -- the escape hatch is intentionally broad. Users who need precision should use `call()`, `access()`, or `newExpr()`.
