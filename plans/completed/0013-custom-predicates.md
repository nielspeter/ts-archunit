# Plan 0013: Custom Predicates, Conditions & Extension API

## Status

- **State:** Draft
- **Priority:** P1 — Primary extensibility mechanism; lets users go beyond built-in rules
- **Effort:** 0.5 days
- **Created:** 2026-03-26
- **Depends on:** 0003 (Predicate Engine), 0004 (Condition Engine), 0005 (Rule Builder)

## Purpose

Expose an extension API that lets users define their own predicates and conditions using the same interfaces as built-in ones (spec Sections 7.1, 7.2). This is a thin convenience layer: `definePredicate()` creates a `Predicate<T>` object, `defineCondition()` creates a `Condition<T>` object, and `.satisfy()` on `RuleBuilder` plugs them into the fluent chain.

The goal is zero-boilerplate extensibility. Users who need a rule that ts-archunit does not ship should be able to write it in a few lines without understanding the builder internals.

## Phase 1: `definePredicate()` and `defineCondition()`

### `src/core/define.ts`

```typescript
import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'

/**
 * Create a custom predicate for use in `.that().satisfy()` chains.
 *
 * The predicate filters elements — return `true` to keep, `false` to exclude.
 *
 * @example
 * ```ts
 * const isAbstract = definePredicate<ClassDeclaration>(
 *   'is abstract',
 *   (cls) => cls.isAbstract()
 * )
 *
 * classes(p).that().satisfy(isAbstract).should().beExported().check()
 * ```
 */
export function definePredicate<T>(
  description: string,
  test: (element: T) => boolean,
): Predicate<T> {
  return { description, test }
}

/**
 * Create a custom condition for use in `.should().satisfy()` chains.
 *
 * The callback receives the filtered element array and rule context.
 * Return an `ArchViolation[]` for elements that fail the condition.
 *
 * @example
 * ```ts
 * const useSharedHelper = defineCondition<ClassDeclaration>(
 *   'use shared count helper',
 *   (classes, context) => {
 *     return classes
 *       .filter(cls => !usesHelper(cls))
 *       .map(cls => createViolation(cls, 'should use shared count helper', context))
 *   }
 * )
 *
 * classes(p).that().extend('Base').should().satisfy(useSharedHelper).check()
 * ```
 */
export function defineCondition<T>(
  description: string,
  evaluate: (elements: T[], context: ConditionContext) => ArchViolation[],
): Condition<T> {
  return { description, evaluate }
}
```

Both functions are trivial wrappers that construct the interface object. The value is discoverability: users import `definePredicate` / `defineCondition` rather than constructing raw objects, and the JSDoc guides them toward correct usage.

## Phase 2: `.satisfy()` on RuleBuilder

Add a public `.satisfy()` method to `RuleBuilder<T>` that accepts either a `Predicate<T>` or a `Condition<T>` and dispatches based on structural type detection.

### `src/core/rule-builder.ts` (modification)

Add the following method to the `RuleBuilder<T>` class, in the "Chain methods" section after `andShould()`:

```typescript
/**
 * Plug in a custom predicate or condition.
 *
 * After `.that()` — pass a `Predicate<T>` to filter elements.
 * After `.should()` — pass a `Condition<T>` to assert against filtered elements.
 *
 * Dispatch is structural: if the object has a `test` method it is treated
 * as a predicate; if it has `evaluate` it is treated as a condition.
 *
 * @example
 * ```ts
 * // Custom predicate
 * classes(p).that().satisfy(isAbstract).should().beExported().check()
 *
 * // Custom condition
 * classes(p).that().extend('Base').should().satisfy(useSharedHelper).check()
 * ```
 */
satisfy(custom: Predicate<T> | Condition<T>): this {
  if ('test' in custom) {
    return this.addPredicate(custom as Predicate<T>)
  }
  return this.addCondition(custom as Condition<T>)
}
```

The structural dispatch works because `Predicate<T>` has `test()` and `Condition<T>` has `evaluate()` — they share no methods. If a user somehow creates an object with both `test` and `evaluate`, the predicate path wins (filter before assert is the safer default).

## Phase 3: Public API Export

### `src/index.ts` (modification)

```typescript
// Core — custom predicate/condition factories
export { definePredicate, defineCondition } from './core/define.js'
```

The `Predicate` and `Condition` types are already exported. `satisfy()` is a method on `RuleBuilder` which is also already exported. No new type exports needed.

## Phase 4: Tests

### `tests/core/define.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { definePredicate, defineCondition } from '../../src/core/define.js'
import type { ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

describe('definePredicate', () => {
  it('creates a Predicate with the given description and test', () => {
    const pred = definePredicate<{ name: string }>(
      'has name starting with "X"',
      (el) => el.name.startsWith('X'),
    )
    expect(pred.description).toBe('has name starting with "X"')
    expect(pred.test({ name: 'Xavier' })).toBe(true)
    expect(pred.test({ name: 'Alice' })).toBe(false)
  })

  it('works with predicate combinators and/or/not', () => {
    const { and, not } = await import('../../src/core/predicate.js')
    const isLong = definePredicate<string>('is long', (s) => s.length > 5)
    const startsWithA = definePredicate<string>('starts with A', (s) => s.startsWith('A'))

    const combined = and(isLong, not(startsWithA))
    expect(combined.test('BobbyTables')).toBe(true)
    expect(combined.test('Alice')).toBe(false)  // starts with A
    expect(combined.test('Bob')).toBe(false)    // too short
  })
})

describe('defineCondition', () => {
  it('creates a Condition with the given description and evaluate', () => {
    const cond = defineCondition<{ name: string; file: string; line: number }>(
      'have short names',
      (elements, context) =>
        elements
          .filter((el) => el.name.length > 10)
          .map((el) => ({
            rule: context.rule,
            element: el.name,
            file: el.file,
            line: el.line,
            message: `Name "${el.name}" exceeds 10 characters`,
            because: context.because,
          })),
    )

    expect(cond.description).toBe('have short names')

    const ctx: ConditionContext = { rule: 'test rule' }
    const violations = cond.evaluate(
      [
        { name: 'Short', file: 'a.ts', line: 1 },
        { name: 'VeryLongClassName', file: 'b.ts', line: 5 },
      ],
      ctx,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('VeryLongClassName')
    expect(violations[0]!.message).toContain('exceeds 10 characters')
  })

  it('propagates because from context', () => {
    const cond = defineCondition<{ name: string }>(
      'always fail',
      (elements, context) =>
        elements.map((el) => ({
          rule: context.rule,
          element: el.name,
          file: 'test.ts',
          line: 1,
          message: 'failed',
          because: context.because,
        })),
    )

    const ctx: ConditionContext = { rule: 'r', because: 'reasons' }
    const violations = cond.evaluate([{ name: 'X' }], ctx)
    expect(violations[0]!.because).toBe('reasons')
  })
})
```

### `tests/core/rule-builder-satisfy.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { definePredicate, defineCondition } from '../../src/core/define.js'
import type { ArchProject } from '../../src/core/project.js'
import type { Predicate } from '../../src/core/predicate.js'
import type { Condition } from '../../src/core/condition.js'

interface TestElement {
  name: string
  file: string
  line: number
}

class TestRuleBuilder extends RuleBuilder<TestElement> {
  constructor(
    project: ArchProject,
    private elements: TestElement[],
  ) {
    super(project)
  }

  protected getElements(): TestElement[] {
    return this.elements
  }

  // Expose addCondition for test setup
  withCondition(condition: Condition<TestElement>): this {
    return this.addCondition(condition)
  }
}

const stubProject = {} as ArchProject

const elements: TestElement[] = [
  { name: 'UserService', file: 'src/user.ts', line: 1 },
  { name: 'OrderService', file: 'src/order.ts', line: 1 },
  { name: 'helperUtil', file: 'src/util.ts', line: 1 },
]

describe('.satisfy() with custom predicate', () => {
  it('filters elements using a custom predicate', () => {
    const isService = definePredicate<TestElement>(
      'is a service',
      (el) => el.name.endsWith('Service'),
    )

    const alwaysFail = defineCondition<TestElement>(
      'always fail',
      (els, ctx) =>
        els.map((el) => ({
          rule: ctx.rule,
          element: el.name,
          file: el.file,
          line: el.line,
          message: 'fail',
        })),
    )

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.that().satisfy(isService).should().satisfy(alwaysFail).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      // Only services matched the predicate, not helperUtil
      expect(archError.violations).toHaveLength(2)
      expect(archError.violations.map((v) => v.element)).toEqual([
        'UserService',
        'OrderService',
      ])
    }
  })

  it('dispatches Predicate based on structural type (has test)', () => {
    const pred: Predicate<TestElement> = {
      description: 'raw predicate',
      test: (el) => el.name === 'helperUtil',
    }

    const alwaysFail = defineCondition<TestElement>(
      'fail',
      (els, ctx) =>
        els.map((el) => ({
          rule: ctx.rule,
          element: el.name,
          file: el.file,
          line: el.line,
          message: 'fail',
        })),
    )

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.that().satisfy(pred).should().satisfy(alwaysFail).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations).toHaveLength(1)
      expect(archError.violations[0]!.element).toBe('helperUtil')
    }
  })
})

describe('.satisfy() with custom condition', () => {
  it('evaluates a custom condition against filtered elements', () => {
    const mustEndWithService = defineCondition<TestElement>(
      'have names ending with "Service"',
      (els, ctx) =>
        els
          .filter((el) => !el.name.endsWith('Service'))
          .map((el) => ({
            rule: ctx.rule,
            element: el.name,
            file: el.file,
            line: el.line,
            message: `"${el.name}" does not end with "Service"`,
            because: ctx.because,
          })),
    )

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().satisfy(mustEndWithService).because('naming convention').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations).toHaveLength(1)
      expect(archError.violations[0]!.element).toBe('helperUtil')
      expect(archError.violations[0]!.because).toBe('naming convention')
    }
  })

  it('dispatches Condition based on structural type (has evaluate)', () => {
    const cond: Condition<TestElement> = {
      description: 'raw condition',
      evaluate: () => [],
    }

    const builder = new TestRuleBuilder(stubProject, elements)
    // Should not throw — condition returns no violations
    expect(() => {
      builder.should().satisfy(cond).check()
    }).not.toThrow()
  })
})

describe('.satisfy() with built-in chain methods', () => {
  it('custom predicate combines with built-in conditions via andShould()', () => {
    const isService = definePredicate<TestElement>(
      'is a service',
      (el) => el.name.endsWith('Service'),
    )

    const alwaysPass = defineCondition<TestElement>('pass', () => [])

    const builder = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder.that().satisfy(isService).should().satisfy(alwaysPass).check()
    }).not.toThrow()
  })

  it('works with named selections', () => {
    const isService = definePredicate<TestElement>(
      'is a service',
      (el) => el.name.endsWith('Service'),
    )

    const alwaysPass = defineCondition<TestElement>('pass', () => [])
    const alwaysFail = defineCondition<TestElement>(
      'fail',
      (els, ctx) =>
        els.map((el) => ({
          rule: ctx.rule,
          element: el.name,
          file: el.file,
          line: el.line,
          message: 'fail',
        })),
    )

    const services = new TestRuleBuilder(stubProject, elements).that().satisfy(isService)

    expect(() => services.should().satisfy(alwaysPass).check()).not.toThrow()
    expect(() => services.should().satisfy(alwaysFail).check()).toThrow(ArchRuleError)
  })
})
```

## Files Changed

| File | Change |
|------|--------|
| `src/core/define.ts` | New — `definePredicate()` and `defineCondition()` factory functions |
| `src/core/rule-builder.ts` | Modified — add public `satisfy()` method with structural type dispatch |
| `src/index.ts` | Modified — export `definePredicate` and `defineCondition` |
| `tests/core/define.test.ts` | New — 4 tests for factory functions |
| `tests/core/rule-builder-satisfy.test.ts` | New — 6 tests for `.satisfy()` integration |

## Test Inventory

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `definePredicate` creates predicate with description and test | Factory produces correct `Predicate<T>` |
| 2 | `definePredicate` result works with `and`/`or`/`not` combinators | Composability with existing predicate algebra |
| 3 | `defineCondition` creates condition with description and evaluate | Factory produces correct `Condition<T>` |
| 4 | `defineCondition` propagates `because` from context | Reason flows through to violations |
| 5 | `.satisfy()` filters with custom predicate | Predicate dispatch and element filtering |
| 6 | `.satisfy()` dispatches raw `Predicate` by structural type | `test` key detection |
| 7 | `.satisfy()` evaluates custom condition | Condition dispatch and violation reporting |
| 8 | `.satisfy()` dispatches raw `Condition` by structural type | `evaluate` key detection |
| 9 | `.satisfy()` combines with `andShould()` and other chain methods | Interop with existing builder |
| 10 | `.satisfy()` works with named selections | Fork semantics preserved |

## Out of Scope

- **Composite custom rules** (combining multiple custom predicates/conditions into a reusable rule bundle) — future plan if demand emerges
- **`defineRule()` high-level helper** that wraps an entire entry + predicate + condition chain — not needed; the fluent API already serves this purpose
- **Custom element types** (non-ts-morph T) — the interfaces are generic over `T` and already support arbitrary types, but concrete entry points that produce custom element types are a separate concern
- **Plugin/registry system** for sharing custom predicates/conditions across projects — out of scope for the core library
