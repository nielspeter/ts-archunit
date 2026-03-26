# Plan 0017: Pattern Templates & `definePattern` / `followPattern`

## Status

- **State:** Not Started
- **Priority:** P3 — Sugar over `defineCondition`; build when users ask for it
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0013 (Custom Predicates/Conditions), 0009 (Function Entry Point), 0010 (Type Entry Point)

## Purpose

Encode reusable team conventions as named **patterns** that describe the expected shape of a return type. `definePattern()` creates a pattern object; `.followPattern()` is a condition that checks whether functions/methods return a type matching that shape.

This is syntactic sugar. Users can already achieve the same result with `defineCondition()` and ts-morph's `Type.getProperty()`. Patterns make the common case — "all list endpoints must return `{ total, skip, limit, items }` " — declarative instead of imperative.

Spec reference: Section 7.3.

## Design Decisions

**Why `returnShape` only (for now):** The spec example focuses exclusively on return type shape. Parameter shapes, decorator requirements, and naming patterns are already covered by existing predicates (`haveReturnType`, `haveParameterCount`, `haveDecorator`, `haveNameMatching`). Starting narrow avoids a second-system effect; more pattern facets can be added later via optional fields.

**Type resolution strategy:** Property types in `returnShape` are matched as strings against `Type.getText()` after `getNonNullableType()`, consistent with how `havePropertyType` + `matching()` work in `src/conditions/type-level.ts` and `src/helpers/type-matchers.ts`. The special token `T[]` matches any array type (delegates to `Type.isArray()`).

**ADR compliance:**

- ADR-002 — all type inspection through ts-morph
- ADR-003 — `.followPattern()` integrates as a fluent condition
- ADR-005 — no `any`, no `as` assertions; structural narrowing only

## Phase 1: Pattern Type & `definePattern()`

### `src/core/pattern.ts`

````typescript
import type { TypeMatcher } from '../helpers/type-matchers.js'

/**
 * A shape constraint for a single property in a return type.
 *
 * - `string` — matched as regex against `Type.getText()` (e.g. `'number'`, `'string'`)
 * - `'T[]'` — matches any array type regardless of element type
 * - `TypeMatcher` — full programmatic control (reuse existing matchers)
 */
export type PropertyConstraint = string | TypeMatcher

/**
 * A named architectural pattern that describes expected return type shape.
 */
export interface ArchPattern {
  /** Human-readable pattern name, e.g. 'paginated-collection' */
  readonly name: string
  /** Required properties and their type constraints on the return type */
  readonly returnShape: Record<string, PropertyConstraint>
}

/**
 * Define a reusable architectural pattern.
 *
 * @example
 * ```ts
 * const paginatedCollection = definePattern('paginated-collection', {
 *   returnShape: {
 *     total: 'number',
 *     skip: 'number',
 *     limit: 'number',
 *     items: 'T[]',
 *   },
 * })
 * ```
 */
export function definePattern(
  name: string,
  options: { returnShape: Record<string, PropertyConstraint> },
): ArchPattern {
  return {
    name,
    returnShape: options.returnShape,
  }
}
````

Deliberately minimal: a named bag of property constraints. No class, no inheritance — just data (consistent with how `definePredicate` and `defineCondition` return plain interface objects in `src/core/define.ts`).

## Phase 2: `followPattern()` Condition

### `src/conditions/pattern.ts`

````typescript
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchPattern, PropertyConstraint } from '../core/pattern.js'
import type { ArchFunction } from '../models/arch-function.js'
import type { Type } from 'ts-morph'

/**
 * Condition: functions must return a type matching the pattern's returnShape.
 *
 * For each property in `pattern.returnShape`:
 * 1. The return type must have a property with that name.
 * 2. The property's type must satisfy the constraint.
 *
 * @example
 * ```ts
 * functions(p)
 *   .that().resideInFolder('src/routes/**')
 *   .should().followPattern(paginatedCollection)
 *   .check()
 * ```
 */
export function followPattern(pattern: ArchPattern): Condition<ArchFunction> {
  return {
    description: `follow pattern "${pattern.name}"`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []

      for (const fn of elements) {
        const returnType = fn.getReturnType()
        // Unwrap Promise<T> to inspect the resolved type
        const resolvedType = unwrapPromise(returnType)
        const missing = getMissingProperties(resolvedType, pattern)

        if (missing.length > 0) {
          const fnName = fn.getName() ?? '<anonymous>'
          const node = fn.getNode()
          violations.push({
            rule: context.rule,
            element: fnName,
            file: node.getSourceFile().getFilePath(),
            line: fn.getStartLineNumber(),
            message: `"${fnName}" does not follow pattern "${pattern.name}": ${missing.join('; ')}`,
            because: context.because,
          })
        }
      }

      return violations
    },
  }
}

/**
 * Unwrap Promise<T> → T so async functions can be checked against
 * the same pattern as sync ones.
 */
function unwrapPromise(type: Type): Type {
  const typeText = type.getText()
  if (typeText.startsWith('Promise<')) {
    const typeArgs = type.getTypeArguments()
    if (typeArgs.length === 1 && typeArgs[0] !== undefined) {
      return typeArgs[0]
    }
  }
  return type
}

/**
 * Check each property constraint in the pattern against the resolved type.
 * Returns human-readable descriptions of missing/mismatched properties.
 */
function getMissingProperties(type: Type, pattern: ArchPattern): string[] {
  const problems: string[] = []

  for (const [propName, constraint] of Object.entries(pattern.returnShape)) {
    const prop = type.getProperty(propName)

    if (prop === undefined) {
      problems.push(`missing property "${propName}"`)
      continue
    }

    const propType = prop.getTypeAtLocation(
      type.getSymbol()?.getDeclarations()[0] ?? prop.getDeclarations()[0]!,
    )
    if (!matchesConstraint(propType, constraint)) {
      const actual = propType.getNonNullableType().getText()
      const expected = typeof constraint === 'string' ? constraint : '<custom matcher>'
      problems.push(`property "${propName}" has type '${actual}', expected '${expected}'`)
    }
  }

  return problems
}

/**
 * Test whether a resolved property type satisfies a PropertyConstraint.
 */
function matchesConstraint(propType: Type, constraint: PropertyConstraint): boolean {
  const stripped = propType.getNonNullableType()

  if (typeof constraint === 'function') {
    // TypeMatcher — delegate directly
    return constraint(propType)
  }

  // String constraint
  if (constraint === 'T[]') {
    // Special: any array type
    return stripped.isArray()
  }

  // Match constraint as regex against type text
  const regex = new RegExp(`^${constraint}$`)
  return regex.test(stripped.getText())
}
````

Key decisions:

- **Promise unwrapping** — async route handlers return `Promise<{ total, ... }>`. The condition unwraps one level of `Promise<T>` so users don't need separate patterns for sync and async.
- **`T[]` token** — matches any array type. Users who need to constrain the element type can pass a `TypeMatcher` instead (e.g. `arrayOf(isNumber())`).
- **String constraints** are treated as anchored regex (`^number$`) so `'number'` matches `number` but not `bigNumber`.

## Phase 3: Wire into `FunctionRuleBuilder`

### `src/builders/function-rule-builder.ts` (modification)

Add `.followPattern()` as a condition method:

```typescript
import { followPattern as followPatternCondition } from '../conditions/pattern.js'
import type { ArchPattern } from '../core/pattern.js'

// Inside FunctionRuleBuilder class, in the conditions section:

/**
 * Assert that matched functions follow an architectural pattern.
 *
 * Checks that return types contain all properties defined in
 * the pattern's returnShape with matching types.
 */
followPattern(pattern: ArchPattern): this {
  return this.addCondition(followPatternCondition(pattern))
}
```

Also add to `ClassRuleBuilder` for class method return types (future extension point — out of scope for this plan, but the condition is generic enough).

## Phase 4: Public API Export

### `src/index.ts` (modification)

```typescript
// Patterns
export { definePattern } from './core/pattern.js'
export type { ArchPattern, PropertyConstraint } from './core/pattern.js'
export { followPattern } from './conditions/pattern.js'
```

Users who prefer `defineCondition` style can use `followPattern(pattern)` directly as a condition with `.satisfy()`:

```typescript
functions(p)
  .that()
  .resideInFolder('src/routes/**')
  .should()
  .satisfy(followPattern(paginatedCollection))
  .check()
```

## Phase 5: Tests

### `tests/core/pattern.test.ts`

| #   | Test                                                                  | What it validates                       |
| --- | --------------------------------------------------------------------- | --------------------------------------- |
| 1   | `definePattern` creates pattern with name and returnShape             | Factory produces correct `ArchPattern`  |
| 2   | `followPattern` passes when return type matches all properties        | Happy path — all constraints satisfied  |
| 3   | `followPattern` fails when return type is missing a property          | Missing property detection              |
| 4   | `followPattern` fails when property type mismatches                   | Type constraint checking                |
| 5   | `followPattern` unwraps `Promise<T>` for async functions              | Async support                           |
| 6   | `followPattern` handles `T[]` constraint (matches any array)          | Array wildcard                          |
| 7   | `followPattern` accepts `TypeMatcher` as constraint                   | Programmatic constraint                 |
| 8   | `followPattern` reports all missing properties in one violation       | Multi-property failure message          |
| 9   | `followPattern` works via `.satisfy()` on `RuleBuilder`               | Integration with existing extension API |
| 10  | `followPattern` works via `.followPattern()` on `FunctionRuleBuilder` | Fluent chain integration                |

### Test fixture: `tests/fixtures/patterns/`

```
tests/fixtures/patterns/
├── tsconfig.json
├── paginated-correct.ts     # { total: number, skip: number, limit: number, items: User[] }
├── paginated-missing.ts     # { total: number, items: User[] }  — missing skip/limit
├── paginated-wrong-type.ts  # { total: string, skip: number, limit: number, items: User[] }
└── paginated-async.ts       # async function returning Promise<{ total, skip, limit, items }>
```

## Files Changed

| File                                    | Change                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/core/pattern.ts`                   | New — `ArchPattern` interface, `PropertyConstraint` type, `definePattern()`             |
| `src/conditions/pattern.ts`             | New — `followPattern()` condition with Promise unwrap + constraint matching             |
| `src/builders/function-rule-builder.ts` | Modified — add `.followPattern()` method                                                |
| `src/index.ts`                          | Modified — export `definePattern`, `ArchPattern`, `PropertyConstraint`, `followPattern` |
| `tests/core/pattern.test.ts`            | New — 10 tests                                                                          |
| `tests/fixtures/patterns/*.ts`          | New — 4 fixture files                                                                   |

## Out of Scope

- **Parameter shape constraints** — patterns only check return types for now; parameter validation is a separate concern covered by `haveParameterCount` and custom predicates
- **Class method patterns** — `.followPattern()` on `ClassRuleBuilder` checking individual method return types (can be added later; the condition itself is reusable)
- **Pattern composition** — combining multiple patterns into one (use multiple `.should().followPattern()` calls or `defineCondition` for complex cases)
- **Pattern registry / sharing** — a catalog of community patterns is a documentation concern, not a runtime feature
- **Nested shape matching** — `returnShape` is one level deep; deeply nested type validation is better expressed with `TypeMatcher` functions
