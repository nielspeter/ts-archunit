# Plan 0028: Metric-Based Standard Rules

## Status

- **State:** Done
- **Priority:** P3 — Reduces "I still need SonarQube" objection; not blocking adoption
- **Effort:** 1 day
- **Created:** 2026-03-26
- **Depends on:** 0008 (Class Entry Point), 0009 (Function Entry Point), 0024 (Standard Rules Library)

## Problem

Architects using SonarQube expect metric-based rules out of the box: "methods with complexity > 15 must not exist", "classes with > 500 lines should be split." ts-archunit has the extension API (`definePredicate`) to build these, but forcing every adopter to write their own complexity calculator is a friction point.

The gap isn't capability — it's convenience. Shipping `ts-archunit/rules/metrics` closes the most common "but SonarQube also does..." objection without duplicating SonarQube's full metrics engine.

## Design Decisions

### Predicates, not conditions

Metrics are filters: "find classes with complexity > N." The natural API is:

```typescript
// Predicate: select, then assert they shouldn't exist
classes(p)
  .that()
  .satisfy(haveCyclomaticComplexity({ greaterThan: 15 }))
  .should()
  .notExist()
  .check()

// Or use as a condition directly when the threshold IS the rule
classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()
```

**Ship both forms.** Predicates (`haveCyclomaticComplexity`) for filtering + composition. Conditions (`maxCyclomaticComplexity`) for one-liner rules. The conditions internally use the predicate logic.

### Cyclomatic complexity calculation

Cyclomatic complexity = 1 + number of decision points. ts-morph gives us `SyntaxKind` for each, so counting is straightforward:

Decision points (each adds 1):

- `IfStatement`
- `ConditionalExpression` (ternary `? :`)
- `ForStatement`, `ForInStatement`, `ForOfStatement`
- `WhileStatement`, `DoStatement`
- `CatchClause`
- `CaseClause` (each case in a switch)
- `BinaryExpression` with `&&` or `||` operators (short-circuit branching)
- `NullishCoalescing` expression (`??`)

This matches SonarQube's cyclomatic complexity definition and is the industry-standard McCabe metric.

### Cognitive complexity — out of scope for v1

SonarQube distinguishes cyclomatic (McCabe) from cognitive complexity (penalizes nesting). Cognitive complexity is harder to compute correctly (nesting depth tracking, different weights for different constructs). Defer to a future plan. Cyclomatic alone covers 80% of the metric-rule use cases.

**Note for docs:** SonarQube's default quality gate uses _cognitive_ complexity (threshold 15), not cyclomatic. The "Common Thresholds" table should clarify this distinction so users migrating from SonarQube set appropriate thresholds.

### Scope: class-level and function-level

Both `Condition<ClassDeclaration>` (checks all methods, constructors, getters, setters) and `Condition<ArchFunction>` (checks individual functions). This follows the existing standard rules pattern — plan 0024 noted "Function-level rules... can be added later as demand emerges." Metrics are the natural demand.

### `ArchFunction` type compatibility

`ArchFunction.getNode()` returns `Node` (the generic ts-morph base type). For arrow functions, it returns a `VariableDeclaration`, not the `ArrowFunction`. The complexity calculator must therefore accept a body `Node` directly, not a `FunctionLike` union. Function-level conditions use `fn.getBody()` (returns `Node | undefined`) for complexity/LOC, and `fn.getParameters()` (returns `ParameterDeclaration[]`) for parameter counting — both are safe methods on the `ArchFunction` interface.

### Lines of code — line-number based, not text parsing

Rather than parsing raw text for comment filtering (which misses block comments, JSDoc opening lines, etc.), use ts-morph's `getStartLineNumber()` and `getEndLineNumber()` for a simple, accurate "span lines" count. This counts all lines in the element's span — blank lines and comments included — which is consistent with how most editors report "lines in this function." Document this as "span lines" rather than "logical lines" to set correct expectations vs SonarQube's NCLOC (non-comment lines of code).

## Phase 1: Complexity Calculator

### `src/helpers/complexity.ts`

Pure function — no rule logic, just the calculation. Reusable by both predicates and conditions.

```typescript
import { SyntaxKind, Node } from 'ts-morph'

/** Decision-point SyntaxKinds that increment cyclomatic complexity */
const DECISION_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.CaseClause,
])

/** Logical operator tokens that add branching */
const LOGICAL_OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken, // &&
  SyntaxKind.BarBarToken, // ||
  SyntaxKind.QuestionQuestionToken, // ??
])

/**
 * Calculate cyclomatic complexity (McCabe) for a function body.
 *
 * Accepts the body Node directly (from ArchFunction.getBody(), MethodDeclaration.getBody(), etc.).
 * Complexity = 1 + number of decision points.
 * Returns 1 for an undefined/empty body (one path through).
 */
export function cyclomaticComplexity(body: Node | undefined): number {
  if (!body) return 1

  let complexity = 1

  for (const descendant of body.getDescendants()) {
    if (DECISION_KINDS.has(descendant.getKind())) {
      complexity++
    }

    // Count logical operators in binary expressions
    if (Node.isBinaryExpression(descendant)) {
      const opKind = descendant.getOperatorToken().getKind()
      if (LOGICAL_OPERATORS.has(opKind)) {
        complexity++
      }
    }
  }

  return complexity
}

/**
 * Count lines spanned by a node (from first line to last line, inclusive).
 *
 * This is a "span lines" count — it includes blank lines and comments
 * within the node's range. This is consistent with how editors report
 * function/class length, and avoids the fragility of text-based
 * comment stripping.
 *
 * For "non-comment lines of code" (NCLOC), use a custom condition
 * with ts-morph's comment range APIs.
 */
export function linesOfCode(node: Node): number {
  return node.getEndLineNumber() - node.getStartLineNumber() + 1
}

/**
 * Count the number of methods on a class.
 */
export function methodCount(cls: ClassDeclaration): number {
  return cls.getMethods().length
}
```

Note: The previous `propertyCount` helper has been removed — no predicate, condition, or test uses it. Add when a `maxProperties` rule is needed.

## Phase 2: Metric Predicates

### `src/predicates/metrics.ts`

Predicates for use in `.that().satisfy()` chains. These filter elements by metric threshold.

The `Predicate<T>` interface (from `src/core/predicate.ts`) uses `test(element: T): boolean`.

```typescript
import type { ClassDeclaration } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import type { ArchFunction } from '../models/arch-function.js'
import { cyclomaticComplexity, linesOfCode, methodCount } from '../helpers/complexity.js'

/**
 * Predicate: class has a method (or constructor/getter/setter) with
 * cyclomatic complexity above threshold.
 */
export function haveCyclomaticComplexity(opts: {
  greaterThan: number
}): Predicate<ClassDeclaration> {
  return {
    description: `have a method with cyclomatic complexity > ${String(opts.greaterThan)}`,
    test(cls: ClassDeclaration): boolean {
      const bodies = [
        ...cls.getMethods().map((m) => m.getBody()),
        ...cls.getConstructors().map((c) => c.getBody()),
        ...cls.getGetAccessors().map((g) => g.getBody()),
        ...cls.getSetAccessors().map((s) => s.getBody()),
      ]
      return bodies.some((body) => cyclomaticComplexity(body) > opts.greaterThan)
    },
  }
}

/**
 * Predicate: function has cyclomatic complexity above threshold.
 * Uses ArchFunction.getBody() — works for all function kinds
 * (declarations, arrow functions, methods).
 */
export function haveComplexity(opts: { greaterThan: number }): Predicate<ArchFunction> {
  return {
    description: `have cyclomatic complexity > ${String(opts.greaterThan)}`,
    test(fn: ArchFunction): boolean {
      return cyclomaticComplexity(fn.getBody()) > opts.greaterThan
    },
  }
}

/**
 * Predicate: class has more than N lines of code.
 */
export function haveMoreLinesThan(threshold: number): Predicate<ClassDeclaration> {
  return {
    description: `have more than ${String(threshold)} lines`,
    test(cls: ClassDeclaration): boolean {
      return linesOfCode(cls) > threshold
    },
  }
}

/**
 * Predicate: function has more than N lines of code.
 * Uses ArchFunction.getNode() for the full span.
 */
export function haveMoreFunctionLinesThan(threshold: number): Predicate<ArchFunction> {
  return {
    description: `have more than ${String(threshold)} lines`,
    test(fn: ArchFunction): boolean {
      return linesOfCode(fn.getNode()) > threshold
    },
  }
}

/**
 * Predicate: class has more than N methods.
 */
export function haveMoreMethodsThan(threshold: number): Predicate<ClassDeclaration> {
  return {
    description: `have more than ${String(threshold)} methods`,
    test(cls: ClassDeclaration): boolean {
      return methodCount(cls) > threshold
    },
  }
}
```

## Phase 3: Metric Conditions (Standard Rules)

### `src/rules/metrics.ts`

Condition factory functions for the `ts-archunit/rules/metrics` sub-path export. These are the one-liner rules users import directly.

**Key change from earlier draft:** Class-level conditions iterate methods + constructors + getters + setters, matching the `searchClassBody` pattern in `src/helpers/body-traversal.ts`.

```typescript
import type {
  ClassDeclaration,
  MethodDeclaration,
  ConstructorDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
} from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import { cyclomaticComplexity, linesOfCode } from '../helpers/complexity.js'

/** All callable members of a class: methods, constructors, getters, setters */
type ClassMember =
  | MethodDeclaration
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

function getClassMembers(cls: ClassDeclaration): ClassMember[] {
  return [
    ...cls.getMethods(),
    ...cls.getConstructors(),
    ...cls.getGetAccessors(),
    ...cls.getSetAccessors(),
  ]
}

function getMemberName(cls: ClassDeclaration, member: ClassMember): string {
  const clsName = cls.getName() ?? '<anonymous>'
  if ('getName' in member) {
    return `${clsName}.${member.getName()}`
  }
  return `${clsName}.constructor`
}

/**
 * No method/constructor/getter/setter in the class may exceed the given
 * cyclomatic complexity.
 *
 * @example
 * import { maxCyclomaticComplexity } from 'ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()
 *
 * // Scoped to services, warn-only
 * classes(p).that().haveNameEndingWith('Service')
 *   .should().satisfy(maxCyclomaticComplexity(20))
 *   .because('complex methods are hard to test')
 *   .warn()
 */
export function maxCyclomaticComplexity(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no method with cyclomatic complexity > ${String(threshold)}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const member of getClassMembers(cls)) {
          const cc = cyclomaticComplexity(member.getBody())
          if (cc > threshold) {
            violations.push(
              createViolation(
                member,
                `${getMemberName(cls, member)} has cyclomatic complexity ${String(cc)} (max: ${String(threshold)}) — split into smaller methods`,
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
 * No class may exceed the given number of lines.
 *
 * Uses span lines (start line to end line, inclusive).
 *
 * @example
 * import { maxClassLines } from 'ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxClassLines(300)).warn()
 */
export function maxClassLines(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no more than ${String(threshold)} lines`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const loc = linesOfCode(cls)
        if (loc > threshold) {
          violations.push(
            createViolation(
              cls,
              `${cls.getName() ?? '<anonymous>'} has ${String(loc)} lines (max: ${String(threshold)}) — consider splitting into focused classes`,
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
 * No method/constructor/getter/setter may exceed the given number of lines.
 *
 * @example
 * import { maxMethodLines } from 'ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxMethodLines(50)).warn()
 */
export function maxMethodLines(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no method longer than ${String(threshold)} lines`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const member of getClassMembers(cls)) {
          const loc = linesOfCode(member)
          if (loc > threshold) {
            violations.push(
              createViolation(
                member,
                `${getMemberName(cls, member)} has ${String(loc)} lines (max: ${String(threshold)})`,
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
 * No class may have more than the given number of methods.
 *
 * Counts methods only (not constructors/getters/setters) — these are
 * the signatures that indicate class scope.
 *
 * @example
 * import { maxMethods } from 'ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxMethods(15)).warn()
 */
export function maxMethods(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no more than ${String(threshold)} methods`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const count = cls.getMethods().length
        if (count > threshold) {
          violations.push(
            createViolation(
              cls,
              `${cls.getName() ?? '<anonymous>'} has ${String(count)} methods (max: ${String(threshold)}) — consider splitting into focused classes`,
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
 * No method/constructor may have more than the given number of parameters.
 *
 * @example
 * import { maxParameters } from 'ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxParameters(4))
 *   .because('use an options object for >4 parameters')
 *   .check()
 */
export function maxParameters(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no method with more than ${String(threshold)} parameters`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const member of getClassMembers(cls)) {
          const params = member.getParameters().length
          if (params > threshold) {
            violations.push(
              createViolation(
                member,
                `${getMemberName(cls, member)} has ${String(params)} parameters (max: ${String(threshold)}) — use an options object`,
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
```

## Phase 4: Function-Level Metric Conditions

### `src/rules/metrics-function.ts`

Same rules but operating on `ArchFunction` for use with `functions(p)`. Uses `ArchFunction` interface methods directly — `getBody()`, `getParameters()`, `getNode()`, `getName()` — avoiding the `getNode()` type mismatch.

```typescript
import type { ArchFunction } from '../models/arch-function.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import { cyclomaticComplexity, linesOfCode } from '../helpers/complexity.js'

/**
 * Function must not exceed the given cyclomatic complexity.
 *
 * Uses fn.getBody() which returns the body Node for all function
 * kinds (declarations, arrow functions, methods).
 *
 * @example
 * import { maxFunctionComplexity } from 'ts-archunit/rules/metrics'
 *
 * functions(p).that().resideInFolder('src/**')
 *   .should().satisfy(maxFunctionComplexity(15))
 *   .check()
 */
export function maxFunctionComplexity(threshold: number): Condition<ArchFunction> {
  return {
    description: `have cyclomatic complexity <= ${String(threshold)}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const cc = cyclomaticComplexity(fn.getBody())
        if (cc > threshold) {
          violations.push(
            createViolation(
              fn.getNode(),
              `${fn.getName() ?? '<anonymous>'} has cyclomatic complexity ${String(cc)} (max: ${String(threshold)})`,
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
 * Function must not exceed the given number of lines.
 *
 * Uses fn.getNode() for span calculation — this gives the full
 * function declaration/expression span including signature.
 *
 * @example
 * import { maxFunctionLines } from 'ts-archunit/rules/metrics'
 *
 * functions(p).should().satisfy(maxFunctionLines(40)).warn()
 */
export function maxFunctionLines(threshold: number): Condition<ArchFunction> {
  return {
    description: `have no more than ${String(threshold)} lines`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const loc = linesOfCode(fn.getNode())
        if (loc > threshold) {
          violations.push(
            createViolation(
              fn.getNode(),
              `${fn.getName() ?? '<anonymous>'} has ${String(loc)} lines (max: ${String(threshold)})`,
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
 * Function must not have more than the given number of parameters.
 *
 * Uses fn.getParameters() which is defined on the ArchFunction
 * interface and works for all function kinds.
 *
 * @example
 * import { maxFunctionParameters } from 'ts-archunit/rules/metrics'
 *
 * functions(p).that().areExported()
 *   .should().satisfy(maxFunctionParameters(4))
 *   .check()
 */
export function maxFunctionParameters(threshold: number): Condition<ArchFunction> {
  return {
    description: `have no more than ${String(threshold)} parameters`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const params = fn.getParameters().length
        if (params > threshold) {
          violations.push(
            createViolation(
              fn.getNode(),
              `${fn.getName() ?? '<anonymous>'} has ${String(params)} parameters (max: ${String(threshold)}) — use an options object`,
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

## Phase 5: Package Exports & Re-exports

### `package.json` — add sub-path export

```json
"./rules/metrics": {
  "types": "./dist/rules/metrics.d.ts",
  "import": "./dist/rules/metrics.js"
}
```

### `src/rules/metrics.ts` — re-export function-level rules

The user imports everything from one path:

```typescript
// Re-export function-level metric conditions
export {
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from './metrics-function.js'
```

### `src/index.ts` — export predicates and helpers

```typescript
// Metric predicates (for .that().satisfy() usage)
export {
  haveCyclomaticComplexity,
  haveMoreLinesThan,
  haveMoreMethodsThan,
  haveComplexity,
  haveMoreFunctionLinesThan,
} from './predicates/metrics.js'

// Complexity calculator (for custom rules)
export { cyclomaticComplexity, linesOfCode } from './helpers/complexity.js'
```

Exporting the raw `cyclomaticComplexity` function lets users build custom metric rules without reimplementing the calculation.

## Phase 6: Documentation

### `docs/metrics.md`

New doc page. Content:

```markdown
# Metrics

Built-in metric rules for complexity, size, and method count thresholds.

## Class-Level Rules

| Rule                         | What it checks                                           |
| ---------------------------- | -------------------------------------------------------- |
| `maxCyclomaticComplexity(n)` | No method/constructor/getter/setter exceeds complexity N |
| `maxClassLines(n)`           | Class spans no more than N lines                         |
| `maxMethodLines(n)`          | No method/constructor/getter/setter exceeds N lines      |
| `maxMethods(n)`              | Class has no more than N methods                         |
| `maxParameters(n)`           | No method/constructor has more than N parameters         |

## Function-Level Rules

| Rule                       | What it checks                         |
| -------------------------- | -------------------------------------- |
| `maxFunctionComplexity(n)` | Function complexity does not exceed N  |
| `maxFunctionLines(n)`      | Function spans no more than N lines    |
| `maxFunctionParameters(n)` | Function has no more than N parameters |

## How Lines Are Counted

ts-archunit counts **span lines** — from the element's first line to its last line, inclusive. This includes blank lines and comments within the element. This matches how editors report "function length" and avoids fragile text-based comment stripping.

If you need SonarQube-style NCLOC (non-comment lines of code), write a custom condition using ts-morph's `getLeadingCommentRanges()` API.

## Common Thresholds

| Metric                | Typical threshold | SonarQube default | Notes                                                                                                     |
| --------------------- | ----------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| Cyclomatic complexity | 10-20             | 15 (cognitive\*)  | \*SonarQube defaults to cognitive complexity, not cyclomatic. Cyclomatic thresholds are typically higher. |
| Class lines           | 300-500           | 500               |                                                                                                           |
| Method/function lines | 30-60             | 60                |                                                                                                           |
| Method count          | 10-20             | 20                |                                                                                                           |
| Parameters            | 3-5               | 7                 |                                                                                                           |
```

### Update `docs/standard-rules.md`

Add a Metrics section referencing the new sub-path.

### Update `docs/what-to-check.md`

Add a "Complexity & Size" category with examples.

## Phase 7: Tests

### Fixtures

```
tests/fixtures/metrics/
├── tsconfig.json
└── src/
    ├── complex-class.ts      # class with high-complexity method (nested ifs, loops, ternaries)
    │                           # document expected complexity per method in inline comments
    ├── simple-class.ts       # class with trivial methods (complexity 1-2)
    ├── large-class.ts        # class with 30+ methods, 500+ lines
    ├── small-class.ts        # class with 3 methods
    ├── many-params.ts        # method with 8 parameters, constructor with 6 parameters
    ├── complex-function.ts   # standalone function AND arrow function with high complexity
    ├── simple-function.ts    # standalone function with complexity 1
    └── constructor-getter.ts # class with complex constructor and getter (tests member coverage)
```

### `tests/helpers/complexity.test.ts`

Unit tests for the raw calculator:

1. **Empty function body returns complexity 1** — baseline
2. **Single if returns complexity 2** — one decision point
3. **if/else-if/else returns complexity 3** — two decision points (if + else-if)
4. **for loop returns complexity 2** — one decision point
5. **while loop returns complexity 2** — one decision point
6. **switch with 3 cases returns complexity 4** — 1 + 3 case clauses
7. **Ternary operator returns complexity 2** — ConditionalExpression
8. **Logical AND/OR add complexity** — `a && b || c` = complexity 3
9. **Nullish coalescing adds complexity** — `a ?? b` = complexity 2
10. **Nested if in for returns complexity 3** — compounding decision points
11. **try/catch adds complexity** — CatchClause counted
12. **undefined body returns complexity 1** — `cyclomaticComplexity(undefined)` = 1
13. **linesOfCode counts span lines** — 20-line function reports 20
14. **linesOfCode works on class nodes** — class spanning lines 5-25 reports 21
15. **methodCount returns correct count** — class with 5 methods

### `tests/rules/metrics.test.ts`

Standard rule condition tests:

16. **maxCyclomaticComplexity passes for simple class** — all members < threshold
17. **maxCyclomaticComplexity fails for complex method** — violation with correct complexity number
18. **maxCyclomaticComplexity checks constructors** — complex constructor flagged
19. **maxCyclomaticComplexity checks getters** — complex getter flagged
20. **maxCyclomaticComplexity threshold is configurable** — threshold 5 vs 25 give different results
21. **maxClassLines passes for small class** — under threshold
22. **maxClassLines fails for large class** — violation with line count
23. **maxMethodLines passes for short methods** — under threshold
24. **maxMethodLines fails for long method** — violation with line count
25. **maxMethodLines checks constructors** — long constructor flagged
26. **maxMethods passes for small class** — under threshold
27. **maxMethods fails for class with many methods** — violation with count
28. **maxParameters passes for few-param methods** — under threshold
29. **maxParameters fails for many-param method** — violation with count
30. **maxParameters checks constructors** — constructor with many params flagged

### `tests/rules/metrics-function.test.ts`

Function-level condition tests:

31. **maxFunctionComplexity passes for simple function** — complexity under threshold
32. **maxFunctionComplexity fails for complex function** — violation includes complexity
33. **maxFunctionComplexity works for arrow functions** — arrow with high complexity flagged
34. **maxFunctionLines passes for short function** — under threshold
35. **maxFunctionLines fails for long function** — violation with count
36. **maxFunctionParameters passes for few params** — under threshold
37. **maxFunctionParameters fails for many params** — violation with count

### `tests/predicates/metrics.test.ts`

Predicate tests (used in `.that().satisfy()`):

38. **haveCyclomaticComplexity filters classes with complex methods** — only complex classes returned
39. **haveCyclomaticComplexity catches complex constructors** — class with complex constructor returned
40. **haveMoreLinesThan filters large classes** — only large classes returned
41. **haveMoreMethodsThan filters large classes** — only classes with many methods returned
42. **haveComplexity filters complex functions** — only complex functions returned
43. **haveComplexity works on arrow functions** — arrow with high complexity returned
44. **haveMoreFunctionLinesThan filters long functions** — only long functions returned

## Files Changed

| File                                   | Change                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/helpers/complexity.ts`            | New — `cyclomaticComplexity()`, `linesOfCode()`, `methodCount()`                                                |
| `src/predicates/metrics.ts`            | New — metric predicates for classes and functions                                                               |
| `src/rules/metrics.ts`                 | New — `maxCyclomaticComplexity`, `maxClassLines`, `maxMethodLines`, `maxMethods`, `maxParameters`, + re-exports |
| `src/rules/metrics-function.ts`        | New — `maxFunctionComplexity`, `maxFunctionLines`, `maxFunctionParameters`                                      |
| `src/index.ts`                         | Modified — export predicates and `cyclomaticComplexity` helper                                                  |
| `package.json`                         | Modified — add `./rules/metrics` sub-path export                                                                |
| `docs/metrics.md`                      | New — metrics documentation page                                                                                |
| `docs/standard-rules.md`               | Modified — add metrics section                                                                                  |
| `docs/what-to-check.md`                | Modified — add complexity/size category                                                                         |
| `tests/fixtures/metrics/`              | New — fixture files with documented expected complexity values                                                  |
| `tests/helpers/complexity.test.ts`     | New — 15 unit tests                                                                                             |
| `tests/rules/metrics.test.ts`          | New — 15 condition tests                                                                                        |
| `tests/rules/metrics-function.test.ts` | New — 7 function-level tests                                                                                    |
| `tests/predicates/metrics.test.ts`     | New — 7 predicate tests                                                                                         |

## Out of Scope

- **Cognitive complexity** — SonarQube's cognitive complexity metric uses nesting-depth weighting and different rules for different constructs. Significantly more complex to implement correctly. Defer to a future plan if users request it.
- **Halstead metrics** — academic complexity metrics (volume, difficulty, effort). Rarely used in practice outside research.
- **Maintainability index** — composite metric combining complexity, LOC, and Halstead. Too opinionated for a library; better as a user-defined composite.
- **File-level metrics** — `modules(p)` operating on `SourceFile` doesn't have metrics conditions yet. Add when there's demand for "file must not exceed N lines" distinct from class/function metrics.
- **Dashboard/reporting** — metric values are in violation messages. No built-in charting, trending, or aggregation. Use JSON output for external dashboards.
- **SonarQube parity** — this covers the 5 most-used metrics. SonarQube has 60+ metrics. We don't need parity — we need the ones architects actually set thresholds on.
- **`FunctionExpression` support** — The complexity calculator accepts any body `Node`, so `FunctionExpression` works if the caller extracts its body. However, `ArchFunction` does not currently wrap `FunctionExpression` nodes (only declarations, arrow variables, and methods). If demand emerges, extend `ArchFunction` in a separate plan.
