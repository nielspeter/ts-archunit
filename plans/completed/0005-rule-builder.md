# Plan 0005: Fluent Rule Builder & `.check()` / `.warn()`

## Status

- **State:** Complete
- **Priority:** P0 — Last foundation plan; connects predicates + conditions into executable rules
- **Effort:** 1-2 days
- **Created:** 2026-03-25
- **Depends on:** 0002 (Project Loader), 0003 (Predicate Engine), 0004 (Condition Engine)

## Purpose

Implement the abstract `RuleBuilder<T>` base class that concrete entry points (plans 0007-0012) extend. This is the fluent builder that ties predicates and conditions together into executable rules, following the grammar defined in ADR-003:

```
entry(project)         -> SubjectBuilder     (what are we querying?)
  .that()              -> PredicateBuilder   (filter: which elements?)
  .and()               -> PredicateBuilder   (narrow further)
  .should()            -> ConditionBuilder   (assert: what must be true?)
  .andShould()         -> ConditionBuilder   (additional assertions, AND)
  .because(reason)     -> ConditionBuilder   (human rationale, still chainable)
  .check()             -> void (throws)      (execute and throw on violations)
  .warn()              -> void               (execute and log, don't throw)
```

After this plan, the full pipeline works end-to-end: load project -> filter elements -> evaluate conditions -> report violations. Nothing useful for real users yet (no concrete entry points), but the entire execution engine is in place.

Key requirements:

- **Single abstract class with `this` return types** for extensibility (see design decision below)
- **`.check()`** filters elements with predicates, evaluates conditions, throws `ArchRuleError` with violations
- **`.warn()`** same as check but logs violations to stderr instead of throwing
- **`.because(reason)`** attaches rationale to all violations
- **`.severity('error' | 'warn')`** alternative to `.check()` / `.warn()`
- **Named selections** saving a predicate chain for reuse with lazy evaluation
- **Lazy evaluation** nothing executes until a terminal method (`.check()`, `.warn()`, `.severity()`) is called

### Design Decision: Single Class vs. Multi-Class Builder

ADR-003 describes separate builder types per phase (SubjectBuilder -> PredicateBuilder -> ConditionBuilder) for compile-time enforcement of the chain grammar. However, concrete entry points (ClassRuleBuilder, FunctionRuleBuilder, etc.) each add their own predicate and condition methods. With separate phase classes, every entry point would need three classes:

- `ClassSubjectBuilder` -> `ClassPredicateBuilder` -> `ClassConditionBuilder`
- `FunctionSubjectBuilder` -> `FunctionPredicateBuilder` -> `FunctionConditionBuilder`
- ... and so on for every entry point

That is 3 classes per entry point, 6 entry points = 18 builder classes, plus the 3 abstract bases = 21 classes total. The generics threading to maintain type safety across phases would be complex and brittle.

**This plan uses a single abstract `RuleBuilder<T>` class** where `.that()`, `.and()`, `.should()`, etc. all return `this`. Concrete entry points extend it once and add their predicates and conditions as methods.

The tradeoff: you CAN call a predicate method after `.should()` — TypeScript will not catch it at compile time. However:

1. It works correctly at runtime (predicates filter, conditions assert, regardless of call order)
2. The chain reads correctly in practice — `.should().haveNameMatching()` makes no grammatical sense, so developers naturally avoid it
3. The simpler architecture means one class per entry point instead of three

This plan acknowledges the tradeoff explicitly. If user feedback demands compile-time enforcement, a future plan can layer interface types on top of the same underlying implementation without breaking changes.

### Design Decision: No `.orShould()` in v1

The spec defines `.orShould()` for alternative conditions. However, the semantics are complex — OR between conditions requires grouping logic that interacts non-obviously with `.andShould()`. Real-world architecture rules almost always use AND ("must do X AND must not do Y"). OR is rare and can be expressed with separate rules or custom conditions.

**`.orShould()` is deferred to a future plan.** This keeps the condition evaluation simple: all conditions are ANDed. If a user needs OR semantics, they write two separate rules or use a custom condition via `defineCondition()` (plan 0013).

## Phase 1: ArchRuleError

### `src/core/errors.ts`

```typescript
import type { ArchViolation } from './violation.js'

/**
 * Format violations into a human-readable error message.
 */
function formatViolations(violations: ArchViolation[], reason?: string): string {
  const header = `Architecture violation${violations.length === 1 ? '' : 's'} (${violations.length} found)`
  const reasonLine = reason ? `\nReason: ${reason}` : ''

  const details = violations
    .map((v) => {
      const location = `${v.file}:${String(v.line)}`
      return `  - ${v.element}: ${v.message} (${location})`
    })
    .join('\n')

  return `${header}${reasonLine}\n${details}`
}

/**
 * Thrown by `.check()` when architecture violations are found.
 *
 * Integrates naturally with vitest/jest — the test fails with a readable
 * error message listing all violations and their locations.
 */
export class ArchRuleError extends Error {
  public readonly violations: ArchViolation[]

  constructor(violations: ArchViolation[], reason?: string) {
    super(formatViolations(violations, reason))
    this.name = 'ArchRuleError'
    this.violations = violations
  }
}
```

Note: Uses `ArchViolation` fields from plan 0004: `file` (not `sourcePath`), `element`, `message`, `line`.

## Phase 2: Abstract RuleBuilder

### `src/core/rule-builder.ts`

```typescript
import type { ArchProject } from './project.js'
import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'
import { ArchRuleError } from './errors.js'

/**
 * Abstract base class for all rule builders.
 *
 * Concrete entry points (plans 0007+) extend this and:
 * 1. Implement `getElements()` to return the elements to check
 * 2. Add predicate methods that call `addPredicate()`
 * 3. Add condition methods that call `addCondition()`
 *
 * The builder accumulates predicates and conditions. Nothing executes
 * until a terminal method (`.check()`, `.warn()`, `.severity()`) is called.
 */
export abstract class RuleBuilder<T> {
  protected _predicates: Predicate<T>[] = []
  protected _conditions: Condition<T>[] = []
  protected _reason?: string

  constructor(protected readonly project: ArchProject) {}

  // --- Chain methods (grammar transitions) ---

  /**
   * Begin the predicate phase. Returns `this` for chaining.
   * Purely a readability marker — `.that().haveNameMatching(...)` reads like English.
   */
  that(): this {
    return this
  }

  /**
   * Add another predicate (AND). Returns `this` for chaining.
   * `.that().extend('Base').and().resideInFolder('src/repos/**')` means both must match.
   */
  and(): this {
    return this
  }

  /**
   * Begin the condition phase. Returns a forked builder for named selection safety.
   * Creates a fresh builder with the same predicates but empty conditions.
   */
  should(): this {
    const fork = this.fork()
    return fork
  }

  /**
   * Add another condition that must ALSO pass (AND).
   * `.should().notContain(call('x')).andShould().notContain(call('y'))` means both must hold.
   */
  andShould(): this {
    return this
  }

  /**
   * Attach a human-readable rationale to the rule.
   * Included in violation messages when `.check()` throws.
   */
  because(reason: string): this {
    this._reason = reason
    return this
  }

  // --- Terminal methods ---

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   * This is the primary terminal method — use in test assertions.
   */
  check(): void {
    const violations = this.evaluate()
    if (violations.length > 0) {
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   * Use for rules that should warn but not fail CI.
   */
  warn(): void {
    const violations = this.evaluate()
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  - ${v.element}: ${v.message} (${v.file}:${String(v.line)})`)
        .join('\n')
      const reasonLine = this._reason ? `\nReason: ${this._reason}` : ''
      console.warn(
        `Architecture warning${violations.length === 1 ? '' : 's'} (${String(violations.length)} found)${reasonLine}\n${formatted}`,
      )
    }
  }

  /**
   * Execute the rule with the given severity.
   * `.severity('error')` is equivalent to `.check()`.
   * `.severity('warn')` is equivalent to `.warn()`.
   */
  severity(level: 'error' | 'warn'): void {
    if (level === 'error') {
      this.check()
    } else {
      this.warn()
    }
  }

  // --- Protected: for subclasses ---

  /**
   * Register a predicate. Called by concrete builder methods like
   * `.haveNameMatching()`, `.extend()`, etc.
   */
  protected addPredicate(predicate: Predicate<T>): this {
    this._predicates.push(predicate)
    return this
  }

  /**
   * Register a condition. Called by concrete builder methods like
   * `.notContain()`, `.notExist()`, etc.
   */
  protected addCondition(condition: Condition<T>): this {
    this._conditions.push(condition)
    return this
  }

  /**
   * Subclasses implement this to return the elements to check.
   * Called lazily during `.check()` / `.warn()`.
   */
  protected abstract getElements(): T[]

  /**
   * Create a fork of this builder with the same predicates but empty conditions.
   * Used by `.should()` to support named selections without mutation.
   *
   * Subclasses with additional constructor args MUST override this method.
   */
  protected fork(): this {
    const fork = Object.create(Object.getPrototypeOf(this)) as this
    Object.assign(fork, this)
    fork._predicates = [...this._predicates]
    fork._conditions = []
    fork._reason = undefined
    return fork
  }

  // --- Private: execution engine ---

  /**
   * Build the rule description from predicates and conditions.
   */
  private buildRuleDescription(): string {
    const predicateDesc = this._predicates.map((p) => p.description).join(' and ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    const parts: string[] = []
    if (predicateDesc) parts.push(`that ${predicateDesc}`)
    if (conditionDesc) parts.push(`should ${conditionDesc}`)
    return parts.join(' ')
  }

  /**
   * Execute the full pipeline: filter elements with predicates,
   * evaluate conditions, return violations.
   */
  private evaluate(): ArchViolation[] {
    // Step 1: Get all elements from the concrete builder
    const allElements = this.getElements()

    // Step 2: Filter with predicates (AND — all predicates must match)
    const filtered = allElements.filter((element) =>
      this._predicates.every((predicate) => predicate.test(element)),
    )

    // Step 3: If no elements match predicates or no conditions, no violations
    if (filtered.length === 0 || this._conditions.length === 0) {
      return []
    }

    // Step 4: Build context for conditions
    const context: ConditionContext = {
      rule: this.buildRuleDescription(),
      because: this._reason,
    }

    // Step 5: Evaluate all conditions (AND — all must pass)
    const violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(filtered, context))
    }

    return violations
  }
}
```

Key implementation details:

**All conditions are ANDed.** `.should().condA().andShould().condB()` means both must pass. This is simple, predictable, and covers the vast majority of real-world rules.

**Predicate combination:** All predicates are ANDed. `.that().extend('Base').and().resideInFolder('src/**')` means both must match. OR-predicates are handled by the predicate combinator `or()` from plan 0003.

**Empty element set:** If no elements match the predicates, `.check()` passes with no violations. This is correct — "all repositories should X" is vacuously true when there are no repositories.

**Lazy evaluation:** The builder accumulates predicates and conditions as data. `getElements()` is only called when a terminal method runs.

**`fork()` uses `Object.create` + `Object.assign`:** This copies all instance properties (including those from subclasses) without calling the constructor. Subclasses with non-copyable state (e.g., closures over constructor args) must override `fork()`. This is safer than assuming a specific constructor signature.

**`ConditionContext` is passed to `evaluate()`:** The rule description and `.because()` reason are assembled into a `ConditionContext` and passed to each condition, so violations include the full rule context.

## Phase 3: Named Selection Support

Named selections work naturally: `.should()` always forks the builder. The original builder retains its predicates and is never mutated.

```typescript
// Named selection
const repos = classes(p).that().extend('BaseRepository')

// First rule — forks repos, adds condition, checks
repos.should().notContain(call('parseInt')).check()

// Second rule — forks repos again, independent conditions
repos.should().notContain(newExpr('Error')).check()

// repos itself is unchanged — still just predicates, no conditions
```

This works because `.should()` calls `fork()`, which copies predicates and resets conditions. Each `.should()` produces an independent builder.

## Phase 4: Public API Export

### `src/index.ts`

```typescript
export { RuleBuilder } from './core/rule-builder.js'
export { ArchRuleError } from './core/errors.js'
```

`RuleBuilder` is exported for concrete entry points (which may live in user code via `defineCondition`/`definePredicate` extensions). `ArchRuleError` is exported so users can catch it programmatically if needed.

## Phase 5: Tests

Tests use a minimal `TestRuleBuilder` that extends `RuleBuilder<T>` with an in-memory element set. This validates the builder mechanics without depending on concrete entry points (plans 0007+).

### `tests/core/rule-builder.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import type { Predicate } from '../../src/core/predicate.js'
import type { Condition, ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

// --- Test element type ---
interface TestElement {
  name: string
  file: string
  line: number
  exported: boolean
}

// --- Test-only concrete builder ---
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

  // Expose predicate/condition registration for testing
  withPredicate(predicate: Predicate<TestElement>): this {
    return this.addPredicate(predicate)
  }

  withCondition(condition: Condition<TestElement>): this {
    return this.addCondition(condition)
  }
}

// --- Helpers ---

function nameMatches(pattern: RegExp): Predicate<TestElement> {
  return {
    description: `name matches ${String(pattern)}`,
    test: (el) => pattern.test(el.name),
  }
}

function isExported(): Predicate<TestElement> {
  return {
    description: 'is exported',
    test: (el) => el.exported,
  }
}

function alwaysPass(): Condition<TestElement> {
  return {
    description: 'always passes',
    evaluate: () => [],
  }
}

function alwaysFail(msg: string): Condition<TestElement> {
  return {
    description: `always fails with "${msg}"`,
    evaluate: (elements: TestElement[], context: ConditionContext): ArchViolation[] =>
      elements.map((el) => ({
        rule: context.rule,
        element: el.name,
        file: el.file,
        line: el.line,
        message: `${msg}: ${el.name}`,
        because: context.because,
      })),
  }
}

const stubProject = {} as ArchProject

const elements: TestElement[] = [
  { name: 'UserService', file: 'src/services/user.ts', line: 5, exported: true },
  { name: 'OrderService', file: 'src/services/order.ts', line: 3, exported: true },
  { name: 'helperFn', file: 'src/helpers/util.ts', line: 1, exported: false },
  { name: 'UserRepository', file: 'src/repos/user.ts', line: 10, exported: true },
]

describe('RuleBuilder', () => {
  describe('.check()', () => {
    it('passes when no violations exist', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysPass()).check()
      }).not.toThrow()
    })

    it('throws ArchRuleError when violations exist', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysFail('violated')).check()
      }).toThrow(ArchRuleError)
    })

    it('includes violation details in the error', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      try {
        builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysFail('bad')).check()
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ArchRuleError)
        const archError = error as ArchRuleError
        expect(archError.violations).toHaveLength(2)
        expect(archError.message).toContain('bad: UserService')
        expect(archError.message).toContain('bad: OrderService')
      }
    })
  })

  describe('.warn()', () => {
    it('logs violations to stderr but does not throw', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const builder = new TestRuleBuilder(stubProject, elements)
      builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysFail('warning')).warn()
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]?.[0]).toContain('warning: UserService')
      warnSpy.mockRestore()
    })

    it('does not log when there are no violations', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const builder = new TestRuleBuilder(stubProject, elements)
      builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysPass()).warn()
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('.because()', () => {
    it('attaches reason to the error message', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      try {
        builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysFail('bad')).because('services must follow the pattern').check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        expect(archError.message).toContain('services must follow the pattern')
      }
    })
  })

  describe('.andShould()', () => {
    it('fails when any condition has violations', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysPass()).andShould().withCondition(alwaysFail('second')).check()
      }).toThrow(ArchRuleError)
    })

    it('passes when all conditions pass', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.that().withPredicate(nameMatches(/Service$/)).should().withCondition(alwaysPass()).andShould().withCondition(alwaysPass()).check()
      }).not.toThrow()
    })
  })

  describe('named selections', () => {
    it('reuses predicate chain across multiple rules', () => {
      const services = new TestRuleBuilder(stubProject, elements).that().withPredicate(nameMatches(/Service$/))
      expect(() => { services.should().withCondition(alwaysPass()).check() }).not.toThrow()
      expect(() => { services.should().withCondition(alwaysFail('bad')).check() }).toThrow(ArchRuleError)
    })

    it('.should() does not mutate the original builder', () => {
      const services = new TestRuleBuilder(stubProject, elements).that().withPredicate(nameMatches(/Service$/))
      const rule1 = services.should().withCondition(alwaysFail('rule1'))
      const rule2 = services.should().withCondition(alwaysPass())
      expect(() => rule1.check()).toThrow(ArchRuleError)
      expect(() => rule2.check()).not.toThrow()
    })
  })

  describe('empty element set', () => {
    it('.check() passes when no elements match predicates', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.that().withPredicate(nameMatches(/^NothingMatchesThis$/)).should().withCondition(alwaysFail('unreachable')).check()
      }).not.toThrow()
    })

    it('.check() passes when element list is empty', () => {
      const builder = new TestRuleBuilder(stubProject, [])
      expect(() => {
        builder.should().withCondition(alwaysFail('unreachable')).check()
      }).not.toThrow()
    })
  })

  describe('.severity()', () => {
    it('severity("error") behaves like .check()', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      expect(() => {
        builder.should().withCondition(alwaysFail('bad')).severity('error')
      }).toThrow(ArchRuleError)
    })

    it('severity("warn") behaves like .warn()', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const builder = new TestRuleBuilder(stubProject, elements)
      builder.should().withCondition(alwaysFail('bad')).severity('warn')
      expect(warnSpy).toHaveBeenCalledOnce()
      warnSpy.mockRestore()
    })
  })

  describe('predicate combination', () => {
    it('ANDs multiple predicates together', () => {
      const builder = new TestRuleBuilder(stubProject, elements)
      try {
        builder.that().withPredicate(nameMatches(/Service$/)).and().withPredicate(isExported()).should().withCondition(alwaysFail('found')).check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // UserService and OrderService match both predicates
        expect(archError.violations).toHaveLength(2)
      }
    })
  })
})
```

### `tests/integration/rule-chain.test.ts`

End-to-end test using the PoC fixtures with a real ts-morph project:

```typescript
import { describe, it, expect } from 'vitest'
import { Project, type SourceFile } from 'ts-morph'
import path from 'node:path'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

// Minimal SourceFile-based builder for integration testing
class SourceFileRuleBuilder extends RuleBuilder<SourceFile> {
  protected getElements(): SourceFile[] {
    return this.project.getSourceFiles()
  }

  fileNameContains(substring: string): this {
    return this.addPredicate({
      description: `file name contains "${substring}"`,
      test: (sf) => sf.getBaseName().includes(substring),
    })
  }

  haveClassNamed(name: string): this {
    return this.addCondition({
      description: `have class named "${name}"`,
      evaluate: (sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] =>
        sourceFiles
          .filter((sf) => !sf.getClasses().some((c) => c.getName() === name))
          .map((sf) => ({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `Expected class "${name}" in ${sf.getBaseName()}`,
            because: context.because,
          })),
    })
  }

  containExport(): this {
    return this.addCondition({
      description: 'contain at least one export',
      evaluate: (sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] =>
        sourceFiles
          .filter((sf) => sf.getExportedDeclarations().size === 0)
          .map((sf) => ({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `No exports found in ${sf.getBaseName()}`,
            because: context.because,
          })),
    })
  }
}

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('rule chain integration (PoC fixtures)', () => {
  const p = loadTestProject()

  it('passes a rule that all source files have exports', () => {
    expect(() => {
      new SourceFileRuleBuilder(p).should().containExport().check()
    }).not.toThrow()
  })

  it('fails a rule that every file has a class named "NonExistent"', () => {
    expect(() => {
      new SourceFileRuleBuilder(p).should().haveClassNamed('NonExistent').check()
    }).toThrow(ArchRuleError)
  })

  it('filters files with predicates before evaluating conditions', () => {
    expect(() => {
      new SourceFileRuleBuilder(p).that().fileNameContains('base-service').should().haveClassNamed('BaseService').check()
    }).not.toThrow()
  })

  it('chains because() with check()', () => {
    try {
      new SourceFileRuleBuilder(p).should().haveClassNamed('NonExistent').because('every file should define this class').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('every file should define this class')
      expect(archError.violations.length).toBeGreaterThan(0)
    }
  })
})
```

### `tests/core/errors.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchViolation } from '../../src/core/violation.js'

describe('ArchRuleError', () => {
  it('formats a single violation', () => {
    const violations: ArchViolation[] = [
      { rule: 'test rule', element: 'ProductService.getTotal', file: 'src/service.ts', line: 42, message: 'bad call to parseInt' },
    ]
    const error = new ArchRuleError(violations)
    expect(error.name).toBe('ArchRuleError')
    expect(error.message).toContain('1 found')
    expect(error.message).toContain('ProductService.getTotal')
    expect(error.message).toContain('bad call to parseInt')
    expect(error.message).toContain('src/service.ts:42')
  })

  it('formats multiple violations', () => {
    const violations: ArchViolation[] = [
      { rule: 'r', element: 'A', file: 'a.ts', line: 1, message: 'violation A' },
      { rule: 'r', element: 'B', file: 'b.ts', line: 2, message: 'violation B' },
    ]
    const error = new ArchRuleError(violations)
    expect(error.message).toContain('2 found')
    expect(error.message).toContain('violation A')
    expect(error.message).toContain('violation B')
  })

  it('includes reason when provided', () => {
    const violations: ArchViolation[] = [
      { rule: 'r', element: 'X', file: 'x.ts', line: 1, message: 'bad' },
    ]
    const error = new ArchRuleError(violations, 'use shared helper instead')
    expect(error.message).toContain('Reason: use shared helper instead')
  })

  it('exposes violations array', () => {
    const violations: ArchViolation[] = [
      { rule: 'r', element: 'A', file: 'a.ts', line: 1, message: 'a' },
      { rule: 'r', element: 'B', file: 'b.ts', line: 2, message: 'b' },
    ]
    const error = new ArchRuleError(violations)
    expect(error.violations).toBe(violations)
  })

  it('extends Error', () => {
    const error = new ArchRuleError([])
    expect(error).toBeInstanceOf(Error)
  })
})
```

## Files Changed

| File | Change |
|------|--------|
| `src/core/errors.ts` | New — `ArchRuleError` class, `formatViolations` helper |
| `src/core/rule-builder.ts` | New — abstract `RuleBuilder<T>` base class |
| `src/index.ts` | Modified — export `RuleBuilder` and `ArchRuleError` |
| `tests/core/errors.test.ts` | New — 5 tests for ArchRuleError formatting |
| `tests/core/rule-builder.test.ts` | New — 14 tests covering builder mechanics |
| `tests/integration/rule-chain.test.ts` | New — 4 integration tests with real ts-morph project |

## Test Inventory

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `.check()` passes when no violations exist | Basic passing chain |
| 2 | `.check()` throws ArchRuleError when violations exist | Basic failing chain |
| 3 | `.check()` includes violation details in error | Error message has element names and locations |
| 4 | `.warn()` logs but does not throw | Violations go to stderr, no exception |
| 5 | `.warn()` does not log when no violations | Clean output for passing rules |
| 6 | `.because()` attaches reason to error message | Reason string in ArchRuleError |
| 7 | `.andShould()` fails when any condition fails | AND semantics |
| 8 | `.andShould()` passes when all pass | AND semantics |
| 9 | Named selection reuses predicates across rules | Same predicates, different conditions |
| 10 | `.should()` does not mutate the original builder | Fork semantics |
| 11 | Empty predicate match set passes `.check()` | Vacuous truth |
| 12 | Empty element list passes `.check()` | No elements, no violations |
| 13 | `.severity('error')` behaves like `.check()` | Severity alias |
| 14 | `.severity('warn')` behaves like `.warn()` | Severity alias |
| 15 | Multiple predicates are ANDed | `.and()` narrows the set |
| 16 | ArchRuleError formats single violation | Error formatting |
| 17 | ArchRuleError formats multiple violations | Pluralization |
| 18 | ArchRuleError includes reason | `.because()` in message |
| 19 | ArchRuleError exposes violations array | Programmatic access |
| 20 | ArchRuleError extends Error | Instanceof check |
| 21 | Integration: passing rule with real ts-morph | End-to-end with PoC fixtures |
| 22 | Integration: failing rule with real ts-morph | End-to-end throws ArchRuleError |
| 23 | Integration: predicates filter before conditions | Predicate narrowing on real files |
| 24 | Integration: because() in full chain | Reason propagates through pipeline |

## Out of Scope

- **Concrete entry points** (`classes()`, `functions()`, `modules()`, etc.) — plans 0007-0012
- **`.orShould()` OR conditions** — deferred; semantics are complex and rarely needed. Can be added in a future plan once real use cases emerge. For now, use separate rules or custom conditions.
- **Compile-time enforcement of chain grammar** (separate builder types per phase) — acknowledged tradeoff; can be layered on later
- **`within()` scoped rules** — plan 0015
- **Violation code frames and colored output** — plan 0006
- **Custom predicate/condition extension API** (`definePredicate`, `defineCondition`, `.satisfy()`) — plan 0013
- **Baseline mode and diff-aware mode** — plan 0016
