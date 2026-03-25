# Plan 0004: Condition Engine & Structural Conditions

## Status

- **State:** Complete
- **Priority:** P0 — Foundation layer, required by plan 0005 (Rule Builder)
- **Effort:** 1-2 days
- **Created:** 2026-03-25
- **Depends on:** 0003 (Predicate Engine & Identity Predicates)

## Purpose

Implement the `Condition<T>` interface, the `ArchViolation` model, and structural conditions shared across all entry points. After this plan, the system can evaluate filtered elements and produce structured violation objects — the missing link between "filter elements" (plan 0003) and "assert rules" (plan 0005).

Conditions are the inverse of predicates: predicates select elements that match, conditions assert that selected elements satisfy a requirement and produce violations for those that don't.

Spec references: Sections 6.1, 6.7, 6.8, 6.9, 12.1.

---

## Phase 1: ArchViolation Model

The violation model represents a single architecture rule violation. This is the basic structure — `codeFrame` and `suggestion` fields are deferred to plan 0006 (Violation Reporting).

### `src/core/violation.ts`

```typescript
import type { Node } from 'ts-morph'

/**
 * A single architecture rule violation.
 *
 * Represents one element that failed to satisfy a condition.
 * Basic structure — extended with codeFrame and suggestion in plan 0006.
 */
export interface ArchViolation {
  /** Human-readable rule description (from the fluent chain) */
  rule: string
  /** Element identifier, e.g. "OrderService.getTotal()" or "parseConfig" */
  element: string
  /** Absolute file path where the violation occurs */
  file: string
  /** Line number where the violating element starts */
  line: number
  /** Human-readable description of what went wrong */
  message: string
  /** Optional rationale provided via .because() */
  because?: string
}

/**
 * Extract a human-readable name from a ts-morph Node.
 *
 * Handles classes, functions, interfaces, type aliases, variable declarations,
 * and methods. Falls back to the node's kind name for unknown node types.
 */
export function getElementName(node: Node): string {
  // Node types with a getName() method
  if ('getName' in node && typeof (node as Record<string, unknown>).getName === 'function') {
    const name = (node as { getName(): string | undefined }).getName()
    if (name !== undefined) return name
  }
  // Fallback: use the node's kind name (e.g. "VariableDeclaration")
  return node.getKindName()
}

/**
 * Get the absolute file path for a ts-morph Node.
 */
export function getElementFile(node: Node): string {
  return node.getSourceFile().getFilePath()
}

/**
 * Get the start line number for a ts-morph Node.
 */
export function getElementLine(node: Node): number {
  return node.getStartLineNumber()
}

/**
 * Create an ArchViolation from a ts-morph Node and context.
 *
 * Convenience function used by all condition implementations to produce
 * consistent violation objects.
 */
export function createViolation(
  node: Node,
  message: string,
  context: { rule: string; because?: string },
): ArchViolation {
  return {
    rule: context.rule,
    element: getElementName(node),
    file: getElementFile(node),
    line: getElementLine(node),
    message,
    because: context.because,
  }
}
```

**Notes:**

- `getElementName` uses duck typing rather than exhaustive type checks — ts-morph node types that have `getName()` include `ClassDeclaration`, `FunctionDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, `MethodDeclaration`, `PropertyDeclaration`, `VariableDeclaration`, and `EnumDeclaration`.
- `createViolation` is the single factory for all violations, ensuring consistent structure.

---

## Phase 2: Condition Interface

The `Condition<T>` interface is the counterpart to `Predicate<T>` from plan 0003. Predicates filter elements (include/exclude), conditions evaluate filtered elements and produce violations.

### `src/core/condition.ts`

```typescript
import type { Node } from 'ts-morph'
import type { ArchViolation } from './violation.js'

/**
 * Context passed to conditions during evaluation.
 *
 * Provides the rule description and optional rationale so that
 * violations can include meaningful error messages.
 */
export interface ConditionContext {
  /** Human-readable rule description assembled from the fluent chain */
  rule: string
  /** Optional rationale provided via .because() */
  because?: string
}

/**
 * A condition that evaluates filtered elements and returns violations.
 *
 * Conditions receive the elements that passed predicate filtering.
 * They return violations for elements that DON'T satisfy the condition.
 *
 * Most conditions check each element individually. Some (like notExist)
 * check the entire set.
 */
export interface Condition<T> {
  /** Human-readable description of what this condition checks */
  readonly description: string

  /**
   * Evaluate elements against this condition.
   *
   * @param elements - The filtered elements (after predicates)
   * @param context - Rule description and rationale
   * @returns Violations for elements that don't satisfy the condition
   */
  evaluate(elements: T[], context: ConditionContext): ArchViolation[]
}
```

**Key design decisions:**

- `T` is unconstrained — this allows conditions to be tested with mock objects. Structural conditions that need ts-morph `Node` metadata constrain `T extends Node` at the function level (e.g., `elementCondition<T extends Node>`), not at the interface level.
- `evaluate` receives the full array, not individual elements. This allows set-level conditions like `notExist()` which check "are there any elements at all?"
- The interface is simple and implementation-agnostic. Structural conditions, dependency conditions, and body analysis conditions all implement the same interface.

---

## Phase 3: Element-Level Condition Helper

Most conditions follow the same pattern: check each element individually, produce a violation for each failure. Extract this into a helper to avoid repetition.

### `src/conditions/helpers.ts`

```typescript
import type { Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * Create a condition that checks each element individually.
 *
 * The predicate function returns true if the element satisfies the condition.
 * Elements that return false produce a violation using the message function.
 *
 * @param description - Human-readable condition description
 * @param predicate - Returns true if element satisfies the condition
 * @param messageFn - Produces a violation message for a failing element
 */
export function elementCondition<T extends Node>(
  description: string,
  predicate: (element: T) => boolean,
  messageFn: (element: T) => string,
): Condition<T> {
  return {
    description,
    evaluate(elements: T[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        if (!predicate(element)) {
          violations.push(createViolation(element, messageFn(element), context))
        }
      }
      return violations
    },
  }
}
```

---

## Phase 4: Structural Conditions

Structural conditions are shared across all entry points (modules, classes, functions, types). They mirror the identity predicates from plan 0003 but inverted: predicates filter, conditions assert.

### `src/conditions/structural.ts`

```typescript
import type { Node } from 'ts-morph'
import { SyntaxKind } from 'ts-morph'
import picomatch from 'picomatch'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementFile, getElementName } from '../core/violation.js'
import { elementCondition } from './helpers.js'

/**
 * Elements must reside in a file matching the glob pattern.
 *
 * Uses picomatch for glob matching against the absolute file path.
 *
 * @example
 * // Assert all matched elements are in repository files
 * .should(resideInFile('**/repositories/*.ts'))
 */
export function resideInFile<T extends Node>(glob: string): Condition<T> {
  const isMatch = picomatch(glob)
  return elementCondition<T>(
    `reside in file matching '${glob}'`,
    (element) => isMatch(getElementFile(element)),
    (element) =>
      `${getElementName(element)} resides in '${getElementFile(element)}' which does not match '${glob}'`,
  )
}

/**
 * Elements must reside in a folder matching the glob pattern.
 *
 * Matches against the directory portion of the file path (everything
 * before the last path separator).
 *
 * @example
 * // Assert all matched elements are in the services folder
 * .should(resideInFolder('**/services'))
 */
export function resideInFolder<T extends Node>(glob: string): Condition<T> {
  const isMatch = picomatch(glob)
  return elementCondition<T>(
    `reside in folder matching '${glob}'`,
    (element) => {
      const filePath = getElementFile(element)
      const folder = filePath.substring(0, filePath.lastIndexOf('/'))
      return isMatch(folder)
    },
    (element) => {
      const filePath = getElementFile(element)
      const folder = filePath.substring(0, filePath.lastIndexOf('/'))
      return `${getElementName(element)} resides in folder '${folder}' which does not match '${glob}'`
    },
  )
}

/**
 * Elements must have a name matching the regex pattern.
 *
 * @example
 * // Assert all matched elements follow the naming convention
 * .should(haveNameMatching(/Service$/))
 */
export function haveNameMatching<T extends Node>(regex: RegExp): Condition<T> {
  return elementCondition<T>(
    `have name matching ${regex}`,
    (element) => regex.test(getElementName(element)),
    (element) =>
      `${getElementName(element)} does not have a name matching ${regex}`,
  )
}

/**
 * Elements must be exported from their module.
 *
 * Checks for the `export` keyword on the node. For variable declarations,
 * checks the parent variable statement.
 *
 * @example
 * // Assert all matched services are exported
 * .should(beExported())
 */
export function beExported<T extends Node>(): Condition<T> {
  return elementCondition<T>(
    'be exported',
    (element) => {
      // ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, etc.
      if ('isExported' in element && typeof (element as Record<string, unknown>).isExported === 'function') {
        return (element as { isExported(): boolean }).isExported()
      }
      // VariableDeclaration — check parent VariableStatement
      if (element.getKind() === SyntaxKind.VariableDeclaration) {
        const varStatement = element.getParent()?.getParent()
        if (varStatement && 'isExported' in varStatement) {
          return (varStatement as { isExported(): boolean }).isExported()
        }
      }
      return false
    },
    (element) => `${getElementName(element)} is not exported`,
  )
}

/**
 * The predicate set must be empty — no elements should match.
 *
 * This is a set-level condition, not an element-level condition.
 * If ANY elements exist after predicate filtering, each one becomes
 * a violation with the message "X should not exist".
 *
 * @example
 * // Assert no parse*Order functions exist
 * functions(project)
 *   .that(haveNameMatching(/^parse\w+Order$/))
 *   .should(notExist())
 *   .because('use shared parseOrder() utility instead')
 */
export function notExist<T extends Node>(): Condition<T> {
  return {
    description: 'not exist',
    evaluate(elements: T[], context: ConditionContext): ArchViolation[] {
      return elements.map((element) =>
        createViolation(element, `${getElementName(element)} should not exist`, context),
      )
    },
  }
}
```

**Notes:**

- `resideInFile` and `resideInFolder` use picomatch, consistent with the predicates in plan 0003.
- `beExported()` uses duck typing for `isExported()` — this method exists on `ClassDeclaration`, `FunctionDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, `EnumDeclaration`, and `VariableStatement`. For `VariableDeclaration`, the export lives on the grandparent `VariableStatement`.
- `notExist()` is the only set-level condition. It maps every element to a violation rather than checking each element against a predicate.

---

## Phase 5: Public API Exports

### `src/index.ts` additions

```typescript
// Core interfaces
export type { Condition, ConditionContext } from './core/condition.js'
export type { ArchViolation } from './core/violation.js'
export { createViolation, getElementName, getElementFile, getElementLine } from './core/violation.js'

// Structural conditions
export { resideInFile, resideInFolder, haveNameMatching, beExported, notExist } from './conditions/structural.js'
```

**Note:** `Condition`, `ConditionContext`, and `ArchViolation` are exported as types only (they are interfaces). The factory functions and structural conditions are value exports.

---

## Files Changed

| File | Change |
| --- | --- |
| `src/core/violation.ts` | **New** — `ArchViolation` interface, `getElementName`, `getElementFile`, `getElementLine`, `createViolation` |
| `src/core/condition.ts` | **New** — `Condition<T>` interface, `ConditionContext` interface |
| `src/conditions/helpers.ts` | **New** — `elementCondition` factory for per-element conditions |
| `src/conditions/structural.ts` | **New** — `resideInFile`, `resideInFolder`, `haveNameMatching`, `beExported`, `notExist` |
| `src/index.ts` | **Modified** — add public API exports for conditions and violations |
| `tests/conditions/structural.test.ts` | **New** — tests for all structural conditions |

---

## Test Inventory

All tests use ts-morph in-memory file system or the existing PoC fixtures at `tests/fixtures/poc/`.

### `tests/conditions/structural.test.ts`

#### ArchViolation structure

1. **createViolation produces correct fields** — call `createViolation` with a ts-morph node, verify all fields (`rule`, `element`, `file`, `line`, `message`, `because`) are populated correctly.

2. **createViolation omits because when undefined** — verify `because` is `undefined` when not provided in context.

#### Element metadata helpers

3. **getElementName returns class name** — load a `ClassDeclaration`, verify `getElementName` returns the class name.

4. **getElementName returns function name** — load a `FunctionDeclaration`, verify name extraction.

5. **getElementName returns variable name** — load a `VariableDeclaration` (const arrow function), verify name extraction.

6. **getElementName falls back to kind name** — load a node without `getName()`, verify it returns the kind name.

7. **getElementFile returns absolute path** — verify `getElementFile` returns the full path from `getSourceFile().getFilePath()`.

8. **getElementLine returns start line** — verify `getElementLine` returns the correct line number.

#### resideInFile()

9. **passes when element is in matching file** — create a node in `src/services/order.ts`, assert `resideInFile('**/services/*.ts')` returns no violations.

10. **produces violation when element is in non-matching file** — create a node in `src/routes/order.ts`, assert `resideInFile('**/services/*.ts')` returns one violation with correct message.

11. **violation message includes file path and glob** — verify the violation message contains both the actual file path and the expected glob.

#### resideInFolder()

12. **passes when element is in matching folder** — node in `src/services/order.ts`, assert `resideInFolder('**/services')` returns no violations.

13. **produces violation for wrong folder** — node in `src/routes/order.ts`, assert `resideInFolder('**/services')` returns one violation.

14. **handles deeply nested folders** — node in `src/api/v2/services/order.ts`, assert `resideInFolder('**/services')` passes.

#### haveNameMatching()

15. **passes for matching name** — class `OrderService`, assert `haveNameMatching(/Service$/)` returns no violations.

16. **produces violation for non-matching name** — class `OrderHelper`, assert `haveNameMatching(/Service$/)` returns one violation.

17. **works with complex regex** — test `haveNameMatching(/^(get|set|find)\w+$/)` against multiple functions.

#### beExported()

18. **passes for exported class** — `export class Foo {}`, assert `beExported()` returns no violations.

19. **produces violation for non-exported class** — `class Foo {}`, assert `beExported()` returns one violation.

20. **passes for exported function** — `export function foo() {}`, no violations.

21. **produces violation for non-exported function** — `function foo() {}`, one violation.

22. **passes for exported const** — `export const foo = () => {}`, no violations.

23. **produces violation for non-exported const** — `const foo = () => {}`, one violation.

#### notExist()

24. **returns no violations when element set is empty** — pass empty array, assert no violations.

25. **returns violation for each existing element** — pass 3 elements, assert 3 violations.

26. **violation message says "should not exist"** — verify each violation message contains "should not exist".

27. **includes because in violations when provided** — pass context with `because: 'use shared utility'`, verify all violations include it.

#### Against PoC fixtures

28. **resideInFile matches PoC service files** — load `tests/fixtures/poc/`, get classes, assert `resideInFile('**/*-service.ts')` returns violations for classes not in service files.

29. **beExported detects non-exported fixture classes** — load `tests/fixtures/poc/`, verify `StrictOptions` (not exported) is flagged by `beExported()`.

30. **notExist with PoC routes** — load `tests/fixtures/poc/`, find `parseFooOrder` and `parseBarOrder`, assert `notExist()` produces violations for each one.

---

## Out of Scope

- **Condition combinators** (`.andShould()`, `.orShould()`) — plan 0005 (Rule Builder) composes conditions at the builder level, not the condition level.
- **Quantifier conditions** (`allMatch`, `noneMatch`, `atLeastOne`) — deferred to the plan that needs them; not required for the core pipeline.
- **Code frames and suggestions** in violations — plan 0006 (Violation Reporting).
- **Violation formatting** (terminal output, colors, grouping) — plan 0006.
- **Dependency conditions** (`onlyImportFrom`, `notImportFrom`) — plan 0007.
- **Class-specific conditions** (`extend`, `implement`) — plan 0008.
- **Body analysis conditions** (`contain(call())`) — plan 0011.
- **Custom condition API** (`defineCondition`) — plan 0013.
