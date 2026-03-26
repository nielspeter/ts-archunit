# Plan 0008: Class Entry Point & Class Predicates/Conditions

## Status

- **State:** Not Started
- **Priority:** P1 — First concrete entry point; enables real architecture rules on classes
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0005 (Rule Builder), 0003 (Predicate Engine), 0004 (Condition Engine)

## Purpose

Implement the `classes(p)` entry point that operates on `ClassDeclaration` nodes from ts-morph. This is the first concrete builder extending the abstract `RuleBuilder<T>` from plan 0005, and establishes the pattern that plans 0009 (functions) and 0010 (types) will follow.

After this plan, users can write rules like:

```typescript
// All services extending BaseService must have an init() method
classes(p).that().extend('BaseService').should().haveMethodNamed('init').check()

// Abstract classes must reside in the domain folder
classes(p).that().areAbstract().should().resideInFolder('**/domain/**').check()

// Classes with @Controller decorator must be exported
classes(p).that().haveDecorator('Controller').should().beExported().check()

// Named selection: reuse predicate chain for multiple rules
const repos = classes(p).that().extend('BaseRepository')
repos.should().haveMethodNamed('findById').check()
repos.should().beExported().check()
```

The builder wires both identity predicates (from plan 0003) and structural conditions (from plan 0004) as convenience methods, plus adds class-specific predicates and conditions.

### Design Decision: Predicate vs. Condition with Same Name

Some operations (e.g., `extend`, `haveMethodNamed`) make sense both as predicates (filter) and conditions (assert). In the fluent chain, context determines meaning:

- After `.that()` -- predicate: `classes(p).that().extend('Base')` filters to classes extending Base
- After `.should()` -- condition: `classes(p).should().extend('Base')` asserts all classes extend Base

Since `RuleBuilder` uses a single class (see plan 0005 design decision), the same method name can serve both roles. The method always calls `addPredicate()` or `addCondition()` depending on... well, it can't know. Both `.that()` and `.should()` return `this`.

**Resolution:** Methods with dual meaning are implemented as predicates. For the condition variant, we provide separate condition factory functions in `src/conditions/class.ts` that users can compose with `.should()` + the structural condition wiring. In practice the builder exposes:

- **Predicate methods** (used after `.that()`): `extend()`, `implement()`, `haveDecorator()`, `haveDecoratorMatching()`, `areAbstract()`, `haveMethodNamed()`, `haveMethodMatching()`, `havePropertyNamed()`
- **Condition methods** (used after `.should()`): `shouldExtend()`, `shouldImplement()`, `shouldHaveMethodNamed()`, `shouldNotHaveMethodMatching()`
- **Identity predicate methods** (wired through): `haveNameMatching()`, `haveNameStartingWith()`, `haveNameEndingWith()`, `resideInFile()`, `resideInFolder()`, `areExported()`, `areNotExported()`
- **Structural condition methods** (wired through): `resideInFile()` (condition version via `shouldResideInFile()`), `beExported()`, `notExist()`

Wait -- having `shouldExtend` and `extend` is awkward. Better approach: **use the same method name** and always register as predicate. For the condition variants, expose standalone condition factory functions that users pass to a generic `.shouldSatisfy()` or that we wire as separate builder methods with `should` prefix.

**Final approach (simplest, most consistent):** The builder methods that are predicate-only go after `.that()`. The builder methods that are condition-only go after `.should()`. Methods shared between both are registered as **predicates** (the builder method calls `addPredicate()`). For the condition version of the same check, we provide standalone condition factories in `src/conditions/class.ts`. The user composes them:

```typescript
// Predicate: filter to classes extending BaseService
classes(p).that().extend('BaseService').should().beExported().check()

// Condition: assert all classes extend BaseService (use condition factory)
classes(p).that().areExported().should().extend('BaseService').check()
```

Actually, the cleanest design: **all class-specific builder methods call `addPredicate()` when chained after `.that()` and `addCondition()` when chained after `.should()`**. But since `RuleBuilder` can't track phase, we take the pragmatic route:

**All class-specific methods on the builder are predicates.** Condition versions are standalone functions in `src/conditions/class.ts` and wired as separate methods on the builder with clear condition semantics. Since the builder's `.should()` fork returns `this` (same type), both predicate and condition methods are available in both phases. The method names distinguish them:

- `extend('Base')` -- predicate (filters)
- `shouldExtend('Base')` -- condition (asserts), calls `addCondition()`

This is explicit and prevents confusion.

## Phase 1: Class Predicates

### `src/predicates/class.ts`

```typescript
import type { ClassDeclaration } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'

/**
 * Matches classes that extend the named base class.
 *
 * Uses the extends clause expression text, e.g. `class Foo extends Bar`
 * matches `extend('Bar')`.
 */
export function extend(className: string): Predicate<ClassDeclaration> {
  return {
    description: `extend "${className}"`,
    test: (cls) => cls.getExtends()?.getExpression().getText() === className,
  }
}

/**
 * Matches classes that have an explicit `implements` clause for the named interface.
 *
 * Checks `getImplements()` expression texts.
 */
export function implement(interfaceName: string): Predicate<ClassDeclaration> {
  return {
    description: `implement "${interfaceName}"`,
    test: (cls) =>
      cls.getImplements().some((impl) => impl.getExpression().getText() === interfaceName),
  }
}

/**
 * Matches classes that have a decorator with the given name.
 *
 * @example haveDecorator('Controller') matches `@Controller class Foo {}`
 */
export function haveDecorator(name: string): Predicate<ClassDeclaration> {
  return {
    description: `have decorator @${name}`,
    test: (cls) => cls.getDecorators().some((d) => d.getName() === name),
  }
}

/**
 * Matches classes that have a decorator whose name matches the regex.
 */
export function haveDecoratorMatching(regex: RegExp): Predicate<ClassDeclaration> {
  return {
    description: `have decorator matching ${String(regex)}`,
    test: (cls) => cls.getDecorators().some((d) => regex.test(d.getName())),
  }
}

/**
 * Matches abstract classes.
 */
export function areAbstract(): Predicate<ClassDeclaration> {
  return {
    description: 'are abstract',
    test: (cls) => cls.isAbstract(),
  }
}

/**
 * Matches classes that have a method with the given name.
 */
export function haveMethodNamed(name: string): Predicate<ClassDeclaration> {
  return {
    description: `have method named "${name}"`,
    test: (cls) => cls.getMethod(name) !== undefined,
  }
}

/**
 * Matches classes that have a method whose name matches the regex.
 */
export function haveMethodMatching(regex: RegExp): Predicate<ClassDeclaration> {
  return {
    description: `have method matching ${String(regex)}`,
    test: (cls) =>
      cls.getMethods().some((m) => {
        const name = m.getName()
        return regex.test(name)
      }),
  }
}

/**
 * Matches classes that have a property with the given name.
 */
export function havePropertyNamed(name: string): Predicate<ClassDeclaration> {
  return {
    description: `have property named "${name}"`,
    test: (cls) => cls.getProperty(name) !== undefined,
  }
}
```

### `src/predicates/index.ts`

Add re-export for class predicates:

```typescript
// existing identity exports...
export * from './identity.js'
export * as classPredicates from './class.js'
```

## Phase 2: Class Conditions

### `src/conditions/class.ts`

```typescript
import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import { elementCondition } from './helpers.js'
import { getElementName } from '../core/violation.js'

/**
 * Assert that classes extend the named base class.
 */
export function shouldExtend(className: string): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `extend "${className}"`,
    (cls) => cls.getExtends()?.getExpression().getText() === className,
    (cls) => `${getElementName(cls)} does not extend "${className}"`,
  )
}

/**
 * Assert that classes implement the named interface.
 */
export function shouldImplement(interfaceName: string): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `implement "${interfaceName}"`,
    (cls) =>
      cls.getImplements().some((impl) => impl.getExpression().getText() === interfaceName),
    (cls) => `${getElementName(cls)} does not implement "${interfaceName}"`,
  )
}

/**
 * Assert that classes have a method with the given name.
 */
export function shouldHaveMethodNamed(name: string): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `have method named "${name}"`,
    (cls) => cls.getMethod(name) !== undefined,
    (cls) => `${getElementName(cls)} does not have method "${name}"`,
  )
}

/**
 * Assert that classes do NOT have any methods matching the regex.
 */
export function shouldNotHaveMethodMatching(regex: RegExp): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `not have methods matching ${String(regex)}`,
    (cls) => !cls.getMethods().some((m) => regex.test(m.getName())),
    (cls) => {
      const matching = cls
        .getMethods()
        .filter((m) => regex.test(m.getName()))
        .map((m) => m.getName())
      return `${getElementName(cls)} has methods matching ${String(regex)}: ${matching.join(', ')}`
    },
  )
}
```

## Phase 3: ClassRuleBuilder

### `src/builders/class-rule-builder.ts`

```typescript
import type { ClassDeclaration } from 'ts-morph'
import { RuleBuilder } from '../core/rule-builder.js'
import type { ArchProject } from '../core/project.js'

// Identity predicates (plan 0003)
import {
  haveNameMatching as identityHaveNameMatching,
  haveNameStartingWith as identityHaveNameStartingWith,
  haveNameEndingWith as identityHaveNameEndingWith,
  resideInFile as predicateResideInFile,
  resideInFolder as predicateResideInFolder,
  areExported as identityAreExported,
  areNotExported as identityAreNotExported,
} from '../predicates/identity.js'

// Class-specific predicates (this plan)
import {
  extend as predicateExtend,
  implement as predicateImplement,
  haveDecorator as predicateHaveDecorator,
  haveDecoratorMatching as predicateHaveDecoratorMatching,
  areAbstract as predicateAreAbstract,
  haveMethodNamed as predicateHaveMethodNamed,
  haveMethodMatching as predicateHaveMethodMatching,
  havePropertyNamed as predicateHavePropertyNamed,
} from '../predicates/class.js'

// Structural conditions (plan 0004)
import {
  resideInFile as conditionResideInFile,
  resideInFolder as conditionResideInFolder,
  beExported as conditionBeExported,
  notExist as conditionNotExist,
} from '../conditions/structural.js'

// Class-specific conditions (this plan)
import {
  shouldExtend as conditionExtend,
  shouldImplement as conditionImplement,
  shouldHaveMethodNamed as conditionHaveMethodNamed,
  shouldNotHaveMethodMatching as conditionNotHaveMethodMatching,
} from '../conditions/class.js'

/**
 * Rule builder for ClassDeclaration elements.
 *
 * Created by the `classes(p)` entry point. Provides class-specific
 * predicates and conditions alongside the identity predicates and
 * structural conditions from the foundation plans.
 */
export class ClassRuleBuilder extends RuleBuilder<ClassDeclaration> {
  constructor(project: ArchProject) {
    super(project)
  }

  protected getElements(): ClassDeclaration[] {
    const classes: ClassDeclaration[] = []
    for (const sourceFile of this.project.getSourceFiles()) {
      classes.push(...sourceFile.getClasses())
    }
    return classes
  }

  // --- Identity predicate methods (plan 0003) ---

  haveNameMatching(pattern: RegExp | string): this {
    return this.addPredicate(identityHaveNameMatching(pattern))
  }

  haveNameStartingWith(prefix: string): this {
    return this.addPredicate(identityHaveNameStartingWith(prefix))
  }

  haveNameEndingWith(suffix: string): this {
    return this.addPredicate(identityHaveNameEndingWith(suffix))
  }

  resideInFile(glob: string): this {
    return this.addPredicate(predicateResideInFile(glob))
  }

  resideInFolder(glob: string): this {
    return this.addPredicate(predicateResideInFolder(glob))
  }

  areExported(): this {
    return this.addPredicate(identityAreExported())
  }

  areNotExported(): this {
    return this.addPredicate(identityAreNotExported())
  }

  // --- Class-specific predicate methods ---

  extend(className: string): this {
    return this.addPredicate(predicateExtend(className))
  }

  implement(interfaceName: string): this {
    return this.addPredicate(predicateImplement(interfaceName))
  }

  haveDecorator(name: string): this {
    return this.addPredicate(predicateHaveDecorator(name))
  }

  haveDecoratorMatching(regex: RegExp): this {
    return this.addPredicate(predicateHaveDecoratorMatching(regex))
  }

  areAbstract(): this {
    return this.addPredicate(predicateAreAbstract())
  }

  haveMethodNamed(name: string): this {
    return this.addPredicate(predicateHaveMethodNamed(name))
  }

  haveMethodMatching(regex: RegExp): this {
    return this.addPredicate(predicateHaveMethodMatching(regex))
  }

  havePropertyNamed(name: string): this {
    return this.addPredicate(predicateHavePropertyNamed(name))
  }

  // --- Structural condition methods (plan 0004) ---

  shouldResideInFile(glob: string): this {
    return this.addCondition(conditionResideInFile(glob))
  }

  shouldResideInFolder(glob: string): this {
    return this.addCondition(conditionResideInFolder(glob))
  }

  beExported(): this {
    return this.addCondition(conditionBeExported())
  }

  notExist(): this {
    return this.addCondition(conditionNotExist())
  }

  // --- Class-specific condition methods ---

  shouldExtend(className: string): this {
    return this.addCondition(conditionExtend(className))
  }

  shouldImplement(interfaceName: string): this {
    return this.addCondition(conditionImplement(interfaceName))
  }

  shouldHaveMethodNamed(name: string): this {
    return this.addCondition(conditionHaveMethodNamed(name))
  }

  shouldNotHaveMethodMatching(regex: RegExp): this {
    return this.addCondition(conditionNotHaveMethodMatching(regex))
  }
}
```

## Phase 4: Entry Point Function

### `src/builders/class-rule-builder.ts`

```typescript
import type { ArchProject } from '../core/project.js'
import { ClassRuleBuilder } from '../builders/class-rule-builder.js'

/**
 * Entry point for class architecture rules.
 *
 * Returns a `ClassRuleBuilder` that operates on all `ClassDeclaration`
 * nodes across the project's source files.
 *
 * @example
 * classes(p).that().extend('BaseService').should().beExported().check()
 */
export function classes(project: ArchProject): ClassRuleBuilder {
  return new ClassRuleBuilder(project)
}
```

## Phase 5: Public API Export

### `src/index.ts` (additions)

```typescript
// Class entry point
export { classes } from './builders/class-rule-builder.js'
export { ClassRuleBuilder } from './builders/class-rule-builder.js'

// Class predicates (standalone)
export {
  extend,
  implement,
  haveDecorator,
  haveDecoratorMatching,
  areAbstract,
  haveMethodNamed as classHaveMethodNamed,
  haveMethodMatching,
  havePropertyNamed,
} from './predicates/class.js'

// Class conditions (standalone)
export {
  shouldExtend,
  shouldImplement,
  shouldHaveMethodNamed,
  shouldNotHaveMethodMatching,
} from './conditions/class.js'
```

Note: `haveMethodNamed` is exported as `classHaveMethodNamed` to avoid collision with a potential future `haveMethodNamed` identity predicate. The standalone exports allow power users to compose predicates/conditions manually.

## Phase 6: Tests

### `tests/predicates/class.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  extend,
  implement,
  haveDecorator,
  haveDecoratorMatching,
  areAbstract,
  haveMethodNamed,
  haveMethodMatching,
  havePropertyNamed,
} from '../../src/predicates/class.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const project = new Project({ tsConfigFilePath: tsconfigPath })

function getClass(name: string) {
  for (const sf of project.getSourceFiles()) {
    const cls = sf.getClass(name)
    if (cls) return cls
  }
  throw new Error(`Class ${name} not found in fixtures`)
}

describe('class predicates', () => {
  describe('extend()', () => {
    it('matches a class extending the named base', () => {
      const pred = extend('BaseService')
      expect(pred.test(getClass('OrderService'))).toBe(true)
      expect(pred.test(getClass('ProductService'))).toBe(true)
      expect(pred.test(getClass('EdgeCaseService'))).toBe(true)
    })

    it('does not match a class that does not extend the named base', () => {
      const pred = extend('BaseService')
      expect(pred.test(getClass('BaseService'))).toBe(false)
      expect(pred.test(getClass('DomainError'))).toBe(false)
    })

    it('does not match when extends clause has a different class', () => {
      const pred = extend('SomeOtherClass')
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })

    it('has a meaningful description', () => {
      expect(extend('BaseService').description).toBe('extend "BaseService"')
    })
  })

  describe('areAbstract()', () => {
    it('matches abstract classes', () => {
      const pred = areAbstract()
      expect(pred.test(getClass('BaseService'))).toBe(true)
    })

    it('does not match non-abstract classes', () => {
      const pred = areAbstract()
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })
  })

  describe('haveMethodNamed()', () => {
    it('matches a class with the named method', () => {
      const pred = haveMethodNamed('getTotal')
      expect(pred.test(getClass('OrderService'))).toBe(true)
    })

    it('does not match a class without the named method', () => {
      const pred = haveMethodNamed('nonExistentMethod')
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })
  })

  describe('haveMethodMatching()', () => {
    it('matches a class with a method whose name matches the regex', () => {
      const pred = haveMethodMatching(/^get/)
      expect(pred.test(getClass('OrderService'))).toBe(true)
    })

    it('does not match when no method names match', () => {
      const pred = haveMethodMatching(/^zzz/)
      expect(pred.test(getClass('OrderService'))).toBe(false)
    })
  })

  describe('havePropertyNamed()', () => {
    it('matches a class with the named property', () => {
      const pred = havePropertyNamed('db')
      expect(pred.test(getClass('BaseService'))).toBe(true)
    })

    it('does not match a class without the named property', () => {
      const pred = havePropertyNamed('nonExistent')
      expect(pred.test(getClass('BaseService'))).toBe(false)
    })
  })
})
```

Note: `implement()`, `haveDecorator()`, and `haveDecoratorMatching()` need additional fixture classes with `implements` clauses and decorators. These will be added to a new fixture file.

### `tests/fixtures/poc/src/decorated.ts` (new fixture)

```typescript
// Fixture for testing decorator and implements predicates
export interface Serializable {
  serialize(): string
}

export interface Loggable {
  log(): void
}

export function Controller(_target: Function) {}
export function Injectable(_target: Function) {}

@Controller
export class UserController implements Serializable {
  serialize(): string {
    return 'user'
  }
}

@Injectable
export class UserRepository implements Serializable, Loggable {
  serialize(): string {
    return 'repo'
  }
  log(): void {}
}

export class PlainClass {
  doSomething(): void {}
}
```

Note: For decorators to work, the fixture's `tsconfig.json` needs `"experimentalDecorators": true`. Update:

### `tests/fixtures/poc/tsconfig.json` (updated)

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "noEmit": true,
    "experimentalDecorators": true
  },
  "include": ["src"]
}
```

### `tests/predicates/class.test.ts` (additional tests with decorator fixture)

```typescript
// Additional tests using the decorated.ts fixture

describe('class predicates (decorator fixture)', () => {
  describe('implement()', () => {
    it('matches a class implementing the named interface', () => {
      const pred = implement('Serializable')
      expect(pred.test(getClass('UserController'))).toBe(true)
      expect(pred.test(getClass('UserRepository'))).toBe(true)
    })

    it('does not match a class not implementing the interface', () => {
      const pred = implement('Serializable')
      expect(pred.test(getClass('PlainClass'))).toBe(false)
    })

    it('matches specific interface when class implements multiple', () => {
      const pred = implement('Loggable')
      expect(pred.test(getClass('UserRepository'))).toBe(true)
      expect(pred.test(getClass('UserController'))).toBe(false)
    })
  })

  describe('haveDecorator()', () => {
    it('matches a class with the named decorator', () => {
      const pred = haveDecorator('Controller')
      expect(pred.test(getClass('UserController'))).toBe(true)
    })

    it('does not match a class without the decorator', () => {
      const pred = haveDecorator('Controller')
      expect(pred.test(getClass('PlainClass'))).toBe(false)
    })
  })

  describe('haveDecoratorMatching()', () => {
    it('matches a class with a decorator matching the regex', () => {
      const pred = haveDecoratorMatching(/able$/)
      expect(pred.test(getClass('UserRepository'))).toBe(true) // @Injectable
    })

    it('does not match when no decorator matches', () => {
      const pred = haveDecoratorMatching(/^NonExistent/)
      expect(pred.test(getClass('UserController'))).toBe(false)
    })
  })
})
```

### `tests/conditions/class.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project, type ClassDeclaration } from 'ts-morph'
import path from 'node:path'
import {
  shouldExtend,
  shouldImplement,
  shouldHaveMethodNamed,
  shouldNotHaveMethodMatching,
} from '../../src/conditions/class.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const project = new Project({ tsConfigFilePath: tsconfigPath })

function getClass(name: string): ClassDeclaration {
  for (const sf of project.getSourceFiles()) {
    const cls = sf.getClass(name)
    if (cls) return cls
  }
  throw new Error(`Class ${name} not found in fixtures`)
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('class conditions', () => {
  describe('shouldExtend()', () => {
    it('passes for classes extending the named base', () => {
      const cond = shouldExtend('BaseService')
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation for classes not extending the named base', () => {
      const cond = shouldExtend('BaseService')
      const violations = cond.evaluate([getClass('DomainError')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not extend')
    })

    it('reports violations for multiple non-conforming classes', () => {
      const cond = shouldExtend('BaseService')
      const violations = cond.evaluate(
        [getClass('OrderService'), getClass('DomainError')],
        ctx,
      )
      expect(violations).toHaveLength(1) // Only DomainError fails
    })
  })

  describe('shouldImplement()', () => {
    it('passes for classes implementing the named interface', () => {
      const cond = shouldImplement('Serializable')
      const violations = cond.evaluate([getClass('UserController')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation for classes not implementing the interface', () => {
      const cond = shouldImplement('Serializable')
      const violations = cond.evaluate([getClass('PlainClass')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not implement')
    })
  })

  describe('shouldHaveMethodNamed()', () => {
    it('passes for classes with the named method', () => {
      const cond = shouldHaveMethodNamed('getTotal')
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation for classes without the named method', () => {
      const cond = shouldHaveMethodNamed('init')
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('does not have method "init"')
    })
  })

  describe('shouldNotHaveMethodMatching()', () => {
    it('passes when no methods match the regex', () => {
      const cond = shouldNotHaveMethodMatching(/^zzz/)
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violation when methods match the forbidden regex', () => {
      const cond = shouldNotHaveMethodMatching(/^get/)
      const violations = cond.evaluate([getClass('OrderService')], ctx)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.message).toContain('has methods matching')
      expect(violations[0]!.message).toContain('getTotal')
    })
  })
})
```

### `tests/builders/class-rule-builder.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { ClassRuleBuilder } from '../../src/builders/class-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

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

describe('ClassRuleBuilder', () => {
  const p = loadTestProject()

  describe('getElements()', () => {
    it('returns all classes from all source files', () => {
      const builder = new ClassRuleBuilder(p)
      // At minimum: BaseService, DomainError, OrderService, ProductService,
      // EdgeCaseService, plus fixture decorator classes
      expect(() => {
        builder.should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('identity predicate wiring', () => {
    it('haveNameMatching() filters by class name', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })

    it('haveNameEndingWith() filters by suffix', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameEndingWith('Service')
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })

    it('areExported() filters to exported classes', () => {
      // All exported classes should not be abstract (most are concrete)
      // This just validates the predicate wiring works
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .areExported()
          .and()
          .haveNameMatching(/^OrderService$/)
          .should()
          .shouldExtend('BaseService')
          .check()
      }).not.toThrow()
    })
  })

  describe('class-specific predicate wiring', () => {
    it('extend() filters to subclasses', () => {
      // All BaseService subclasses are exported
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .should()
          .beExported()
          .check()
      }).not.toThrow()
    })

    it('areAbstract() filters to abstract classes', () => {
      // BaseService is abstract and exported
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .areAbstract()
          .should()
          .shouldExtend('SomethingElse')
          .check()
      }).toThrow(ArchRuleError) // BaseService doesn't extend anything
    })

    it('haveMethodNamed() filters by method presence', () => {
      // Classes with getTotal: OrderService, ProductService
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveMethodNamed('getTotal')
          .should()
          .shouldExtend('BaseService')
          .check()
      }).not.toThrow()
    })
  })

  describe('class-specific condition wiring', () => {
    it('shouldExtend() asserts class hierarchy', () => {
      // All classes ending in Service should extend BaseService
      // (This includes BaseService itself which doesn't extend it -- should fail)
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .haveNameMatching(/Service$/)
          .should()
          .shouldExtend('BaseService')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('shouldHaveMethodNamed() asserts method presence', () => {
      // OrderService and ProductService have getTotal
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .and()
          .haveNameMatching(/^(Order|Product)Service$/)
          .should()
          .shouldHaveMethodNamed('getTotal')
          .check()
      }).not.toThrow()
    })

    it('shouldNotHaveMethodMatching() asserts no forbidden methods', () => {
      expect(() => {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .should()
          .shouldNotHaveMethodMatching(/^buildUrl$/)
          .check()
      }).toThrow(ArchRuleError) // ProductService has buildUrl
    })
  })

  describe('named selections', () => {
    it('supports named selection pattern', () => {
      const services = new ClassRuleBuilder(p).that().extend('BaseService')

      // Rule 1: all services must be exported
      expect(() => {
        services.should().beExported().check()
      }).not.toThrow()

      // Rule 2: all services must have getTotal (EdgeCaseService doesn't)
      // EdgeCaseService has withOptionalChain, etc. but not getTotal
      expect(() => {
        services.should().shouldHaveMethodNamed('getTotal').check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('because() reason propagation', () => {
    it('includes reason in violation message', () => {
      try {
        new ClassRuleBuilder(p)
          .that()
          .extend('BaseService')
          .should()
          .shouldHaveMethodNamed('init')
          .because('all services must implement init for lifecycle management')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        expect(archError.message).toContain(
          'all services must implement init for lifecycle management',
        )
      }
    })
  })
})
```

### `tests/integration/class-entry-point.test.ts`

End-to-end tests using the `classes()` entry function:

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

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

describe('classes() entry point integration', () => {
  const p = loadTestProject()

  it('all BaseService subclasses should be exported', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().beExported().check()
    }).not.toThrow()
  })

  it('abstract classes should not exist in service folder (negative test)', () => {
    // This validates the full chain works end-to-end
    expect(() => {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .because('abstract classes should live in the domain layer')
        .check()
    }).toThrow(ArchRuleError) // BaseService is abstract
  })

  it('classes with getTotal should extend BaseService', () => {
    expect(() => {
      classes(p)
        .that()
        .haveMethodNamed('getTotal')
        .should()
        .shouldExtend('BaseService')
        .check()
    }).not.toThrow()
  })

  it('fluent chain reads naturally', () => {
    // Validates the grammar: entry -> .that() -> predicate -> .should() -> condition -> .check()
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .and()
        .haveNameMatching(/^Order/)
        .should()
        .shouldHaveMethodNamed('getTotal')
        .because('order services must expose a total')
        .check()
    }).not.toThrow()
  })

  it('returns a ClassRuleBuilder', () => {
    const builder = classes(p)
    expect(builder).toBeInstanceOf(Object)
    // Can chain without errors
    expect(() => {
      builder.that().extend('BaseService')
    }).not.toThrow()
  })
})
```

## Files Changed

| File | Change |
|------|--------|
| `src/predicates/class.ts` | New -- 8 class-specific predicate functions |
| `src/conditions/class.ts` | New -- 4 class-specific condition functions |
| `src/builders/class-rule-builder.ts` | New -- `ClassRuleBuilder` extending `RuleBuilder<ClassDeclaration>` |
| `src/builders/class-rule-builder.ts` | New -- `classes(p)` entry point function |
| `src/predicates/index.ts` | Modified -- re-export class predicates |
| `src/index.ts` | Modified -- export classes entry point, ClassRuleBuilder, class predicates/conditions |
| `tests/fixtures/poc/src/decorated.ts` | New -- fixture with decorators and implements clauses |
| `tests/fixtures/poc/tsconfig.json` | Modified -- add `experimentalDecorators: true` |
| `tests/predicates/class.test.ts` | New -- 14 tests for class predicates |
| `tests/conditions/class.test.ts` | New -- 7 tests for class conditions |
| `tests/builders/class-rule-builder.test.ts` | New -- 10 tests for builder wiring and named selections |
| `tests/integration/class-entry-point.test.ts` | New -- 5 end-to-end tests via `classes()` |

## Test Inventory

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `extend()` matches subclasses | PoC finding: `getExtends()?.getExpression().getText()` |
| 2 | `extend()` rejects non-subclasses | No extends clause or different base |
| 3 | `extend()` rejects different base class | Specificity of class name match |
| 4 | `extend()` has meaningful description | Violation message readability |
| 5 | `areAbstract()` matches abstract classes | `isAbstract()` check |
| 6 | `areAbstract()` rejects concrete classes | Negative case |
| 7 | `haveMethodNamed()` matches by method name | `getMethod(name)` check |
| 8 | `haveMethodNamed()` rejects missing method | Negative case |
| 9 | `haveMethodMatching()` matches by regex | Regex against method names |
| 10 | `haveMethodMatching()` rejects non-matching | Negative regex case |
| 11 | `havePropertyNamed()` matches by property | `getProperty(name)` check |
| 12 | `havePropertyNamed()` rejects missing property | Negative case |
| 13 | `implement()` matches implementing class | `getImplements()` expression text |
| 14 | `implement()` rejects non-implementing class | Negative case |
| 15 | `implement()` handles multiple interfaces | Specificity with multiple implements |
| 16 | `haveDecorator()` matches decorated class | `getDecorators()` name check |
| 17 | `haveDecorator()` rejects undecorated class | Negative case |
| 18 | `haveDecoratorMatching()` matches by regex | Regex against decorator names |
| 19 | `haveDecoratorMatching()` rejects non-matching | Negative regex case |
| 20 | `shouldExtend()` passes for valid extends | Condition passes |
| 21 | `shouldExtend()` reports violation for missing extends | Condition fails with message |
| 22 | `shouldExtend()` counts violations correctly | Multiple elements, partial match |
| 23 | `shouldImplement()` passes for implementing class | Condition passes |
| 24 | `shouldImplement()` reports violation | Condition fails |
| 25 | `shouldHaveMethodNamed()` passes | Condition passes |
| 26 | `shouldHaveMethodNamed()` reports violation | Condition fails with method name |
| 27 | `shouldNotHaveMethodMatching()` passes | No methods match forbidden regex |
| 28 | `shouldNotHaveMethodMatching()` reports violation with names | Lists matching methods |
| 29 | Builder `getElements()` returns all classes | All fixture classes found |
| 30 | Builder `haveNameMatching()` wires identity predicate | Predicate filters correctly |
| 31 | Builder `haveNameEndingWith()` wires identity predicate | Suffix predicate |
| 32 | Builder `areExported()` wires identity predicate | Export predicate |
| 33 | Builder `extend()` wires class predicate | Class-specific filter |
| 34 | Builder `areAbstract()` wires class predicate | Abstract filter |
| 35 | Builder `haveMethodNamed()` wires class predicate | Method presence filter |
| 36 | Builder `shouldExtend()` wires class condition | Class-specific assertion |
| 37 | Builder `shouldHaveMethodNamed()` wires class condition | Method assertion |
| 38 | Builder `shouldNotHaveMethodMatching()` wires class condition | Negative method assertion |
| 39 | Builder named selections work | Fork semantics from plan 0005 |
| 40 | Builder `because()` propagates reason | Reason in violation message |
| 41 | Integration: `classes(p)` returns builder | Entry function works |
| 42 | Integration: full predicate-condition chain | End-to-end grammar |
| 43 | Integration: abstract class notExist assertion | Structural condition wiring |
| 44 | Integration: method presence via entry point | Entry -> predicate -> condition |
| 45 | Integration: compound predicate chain | `.and()` with multiple predicates |

## Out of Scope

- **Body analysis** (`contain(call('parseInt'))`, etc.) -- plan 0011, operates on class method bodies
- **`structurallyMatch()`** predicate -- deferred to plan 0010 (type-level conditions), requires type checker
- **Constructor parameter predicates** (e.g., `haveConstructorParam('db')`) -- future enhancement
- **Static method/property predicates** -- future enhancement, can be added as `haveStaticMethodNamed()`
- **Generic type parameter predicates** -- future enhancement
- **Module-level dependency conditions** (`onlyImportFrom`, etc.) -- plan 0007
- **Custom predicate/condition API** (`definePredicate`, `defineCondition`) -- plan 0013
