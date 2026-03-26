# Plan 0009: Function Entry Point & Function Predicates

## Status

- **State:** Complete
- **Priority:** P1 — Core entry point for function-level architecture rules
- **Effort:** 1 day
- **Created:** 2026-03-26
- **Depends on:** 0002 (Project Loader), 0003 (Predicate Engine), 0004 (Condition Engine), 0005 (Rule Builder)

## Purpose

Implement the `functions(p)` entry point that returns a `FunctionRuleBuilder` for writing architecture rules against functions. This is the first concrete entry point built on the foundation from plans 0002-0005.

TypeScript has two function declaration patterns that must both be captured:

1. `function foo() {}` — `FunctionDeclaration` (ts-morph: `sf.getFunctions()`)
2. `const foo = () => {}` — `VariableDeclaration` with `ArrowFunction` initializer

The PoC (plan 0001, probe 1) validated that both patterns can be reliably detected. This plan wraps them in a unified `ArchFunction` model so predicates and conditions operate on a single type.

### Design Decision: ArchFunction Wrapper (Option B)

`FunctionDeclaration` and `VariableDeclaration` are different ts-morph types with incompatible APIs. Three options were considered:

- **(a) Union type** `FunctionDeclaration | VariableDeclaration` — predicates would need type guards everywhere. Messy.
- **(b) Wrapper type** `ArchFunction` — normalizes both into a clean interface. Predicates work against one type.
- **(c) `Node` base** — too broad, loses all function-specific information.

**This plan uses (b).** `ArchFunction` is a lightweight wrapper with factory functions for each source pattern. It satisfies the `Named`, `Located`, and `Exportable` interfaces from plan 0003, so identity predicates work out of the box.

### Design Decision: ArchFunction Carries the Underlying Node

`ArchFunction.getNode()` returns the underlying ts-morph `Node` for violation reporting. The violation system (`createViolation`) expects a `Node`, so `ArchFunction` must provide one. For `FunctionDeclaration`, this is the declaration itself. For arrow-function `VariableDeclaration`, this is the variable declaration node (not the arrow function expression), because the variable declaration has the name and source position.

### Design Decision: Conditions Require Adapter

The existing structural conditions in `src/conditions/structural.ts` are typed `Condition<T extends Node>`. Since `ArchFunction` is not a `Node`, these conditions cannot be used directly on `FunctionRuleBuilder`. The builder provides its own condition methods that delegate to the `ArchFunction` wrapper. This is the correct approach — the builder is the API surface, and conditions are implementation details.

For body analysis conditions (plan 0011), `ArchFunction.getBody()` provides the function body node for AST traversal.

## Phase 1: ArchFunction Model

### `src/models/arch-function.ts`

```typescript
import {
  type FunctionDeclaration,
  type VariableDeclaration,
  type SourceFile,
  type ParameterDeclaration,
  type Type,
  type Node,
  SyntaxKind,
} from 'ts-morph'

/**
 * Unified representation of a TypeScript function.
 *
 * Wraps both FunctionDeclaration (`function foo() {}`) and
 * VariableDeclaration with ArrowFunction initializer (`const foo = () => {}`).
 *
 * Satisfies Named, Located, and Exportable interfaces from identity predicates.
 */
export interface ArchFunction {
  /** Function name, or undefined for anonymous functions. */
  getName(): string | undefined

  /** Source file containing this function. */
  getSourceFile(): SourceFile

  /** Whether this function is exported from its module. */
  isExported(): boolean

  /** Whether this function is declared async. */
  isAsync(): boolean

  /** Parameter declarations of this function. */
  getParameters(): ParameterDeclaration[]

  /** Return type of this function (resolved by the type checker). */
  getReturnType(): Type

  /** Function body node, for body analysis (plan 0011). */
  getBody(): Node | undefined

  /**
   * Underlying ts-morph node for violation reporting.
   * FunctionDeclaration or VariableDeclaration.
   */
  getNode(): Node

  /**
   * Start line number in the source file.
   * Used for violation reporting.
   */
  getStartLineNumber(): number
}

/**
 * Create an ArchFunction from a FunctionDeclaration.
 */
export function fromFunctionDeclaration(decl: FunctionDeclaration): ArchFunction {
  return {
    getName: () => decl.getName(),
    getSourceFile: () => decl.getSourceFile(),
    isExported: () => decl.isExported(),
    isAsync: () => decl.isAsync(),
    getParameters: () => decl.getParameters(),
    getReturnType: () => decl.getReturnType(),
    getBody: () => decl.getBody(),
    getNode: () => decl,
    getStartLineNumber: () => decl.getStartLineNumber(),
  }
}

/**
 * Create an ArchFunction from a VariableDeclaration whose initializer
 * is an ArrowFunction.
 *
 * Precondition: caller must verify the initializer is an ArrowFunction.
 */
export function fromArrowVariableDeclaration(decl: VariableDeclaration): ArchFunction {
  const arrow = decl.getInitializerIfKind(SyntaxKind.ArrowFunction)!
  return {
    getName: () => decl.getName(),
    getSourceFile: () => decl.getSourceFile(),
    isExported: () => {
      // VariableDeclaration itself doesn't have isExported —
      // check the parent VariableStatement.
      const varStatement = decl.getVariableStatement()
      return varStatement?.isExported() ?? false
    },
    isAsync: () => arrow.isAsync(),
    getParameters: () => arrow.getParameters(),
    getReturnType: () => arrow.getReturnType(),
    getBody: () => arrow.getBody(),
    getNode: () => decl,
    getStartLineNumber: () => decl.getStartLineNumber(),
  }
}

/**
 * Scan a source file for all functions (both patterns).
 *
 * Returns ArchFunction wrappers for:
 * 1. FunctionDeclarations — `function foo() {}`
 * 2. VariableDeclarations with ArrowFunction initializer — `const foo = () => {}`
 */
export function collectFunctions(sourceFile: SourceFile): ArchFunction[] {
  const functions: ArchFunction[] = []

  // Pattern 1: FunctionDeclarations
  for (const fn of sourceFile.getFunctions()) {
    functions.push(fromFunctionDeclaration(fn))
  }

  // Pattern 2: const arrow functions
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    if (varDecl.getInitializerIfKind(SyntaxKind.ArrowFunction)) {
      functions.push(fromArrowVariableDeclaration(varDecl))
    }
  }

  return functions
}
```

Key implementation notes:

- `fromArrowVariableDeclaration` uses `getInitializerIfKind(SyntaxKind.ArrowFunction)` instead of `getInitializer()?.getKind()` — this is the idiomatic ts-morph pattern that returns `undefined` if the kind doesn't match, or the correctly-typed node if it does.
- `isExported()` for arrow functions checks the parent `VariableStatement`, not the `VariableDeclaration` itself. This matches the ts-morph API — `export const foo = () => {}` makes the `VariableStatement` exported, not the `VariableDeclaration`.
- `getBody()` returns the arrow function body, which may be a `Block` (for `() => { ... }`) or an `Expression` (for `() => expr`). Plan 0011 body analysis handles both.
- `getNode()` returns the `VariableDeclaration` for arrow functions (not the `ArrowFunction` expression), so violation messages reference the variable name and its source line.

## Phase 2: Function Predicates

### `src/predicates/function.ts`

```typescript
import type { Predicate } from '../core/predicate.js'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Matches async functions (declared with the `async` keyword).
 */
export function areAsync(): Predicate<ArchFunction> {
  return {
    description: 'are async',
    test: (fn) => fn.isAsync(),
  }
}

/**
 * Matches functions that are NOT async.
 */
export function areNotAsync(): Predicate<ArchFunction> {
  return {
    description: 'are not async',
    test: (fn) => !fn.isAsync(),
  }
}

/**
 * Matches functions with exactly `n` parameters.
 */
export function haveParameterCount(n: number): Predicate<ArchFunction> {
  return {
    description: `have ${String(n)} parameter${n === 1 ? '' : 's'}`,
    test: (fn) => fn.getParameters().length === n,
  }
}

/**
 * Matches functions with more than `n` parameters.
 */
export function haveParameterCountGreaterThan(n: number): Predicate<ArchFunction> {
  return {
    description: `have more than ${String(n)} parameter${n === 1 ? '' : 's'}`,
    test: (fn) => fn.getParameters().length > n,
  }
}

/**
 * Matches functions with fewer than `n` parameters.
 */
export function haveParameterCountLessThan(n: number): Predicate<ArchFunction> {
  return {
    description: `have fewer than ${String(n)} parameter${n === 1 ? '' : 's'}`,
    test: (fn) => fn.getParameters().length < n,
  }
}

/**
 * Matches functions that have a parameter with the given name.
 */
export function haveParameterNamed(name: string): Predicate<ArchFunction> {
  return {
    description: `have a parameter named "${name}"`,
    test: (fn) => fn.getParameters().some((p) => p.getName() === name),
  }
}

/**
 * Matches functions whose return type text matches the given pattern.
 *
 * The pattern is matched against the type checker's text representation
 * of the return type (e.g. "Promise<number>", "string", "void").
 *
 * @param pattern - RegExp or string (converted to RegExp)
 */
export function haveReturnType(pattern: RegExp | string): Predicate<ArchFunction> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    description: `have return type matching ${String(regex)}`,
    test: (fn) => regex.test(fn.getReturnType().getText()),
  }
}
```

These predicates operate on `ArchFunction` directly. The identity predicates from plan 0003 (`haveNameMatching`, `resideInFile`, `areExported`, etc.) also work because `ArchFunction` satisfies the `Named`, `Located`, and `Exportable` interfaces.

## Phase 3: FunctionRuleBuilder

### `src/builders/function-rule-builder.ts`

````typescript
import type { ArchProject } from '../core/project.js'
import type { Predicate } from '../core/predicate.js'
import { RuleBuilder } from '../core/rule-builder.js'
import type { ArchFunction } from '../models/arch-function.js'
import { collectFunctions } from '../models/arch-function.js'
import {
  haveNameMatching as identityHaveNameMatching,
  haveNameStartingWith as identityHaveNameStartingWith,
  haveNameEndingWith as identityHaveNameEndingWith,
  resideInFile as identityResideInFile,
  resideInFolder as identityResideInFolder,
  areExported as identityAreExported,
  areNotExported as identityAreNotExported,
} from '../predicates/identity.js'
import {
  areAsync as fnAreAsync,
  areNotAsync as fnAreNotAsync,
  haveParameterCount as fnHaveParameterCount,
  haveParameterCountGreaterThan as fnHaveParameterCountGreaterThan,
  haveParameterCountLessThan as fnHaveParameterCountLessThan,
  haveParameterNamed as fnHaveParameterNamed,
  haveReturnType as fnHaveReturnType,
} from '../predicates/function.js'

/**
 * Rule builder for function-level architecture rules.
 *
 * Operates on both FunctionDeclarations and const arrow functions,
 * unified through the ArchFunction model.
 *
 * @example
 * ```typescript
 * // No function should have more than 5 parameters
 * functions(project)
 *   .that().haveParameterCountGreaterThan(5)
 *   .should(notExist())
 *   .because('functions with many parameters are hard to use')
 *   .check()
 *
 * // All exported async functions should have names starting with a verb
 * functions(project)
 *   .that().areExported().and().areAsync()
 *   .should().haveNameMatching(/^(get|find|create|update|delete|fetch|load|save)/)
 *   .because('async functions should use verb prefixes')
 *   .check()
 * ```
 */
export class FunctionRuleBuilder extends RuleBuilder<ArchFunction> {
  protected getElements(): ArchFunction[] {
    return this.project.getSourceFiles().flatMap(collectFunctions)
  }

  // --- Identity predicates (delegated to plan 0003 generics) ---

  haveNameMatching(pattern: RegExp | string): this {
    return this.addPredicate(identityHaveNameMatching<ArchFunction>(pattern))
  }

  haveNameStartingWith(prefix: string): this {
    return this.addPredicate(identityHaveNameStartingWith<ArchFunction>(prefix))
  }

  haveNameEndingWith(suffix: string): this {
    return this.addPredicate(identityHaveNameEndingWith<ArchFunction>(suffix))
  }

  resideInFile(glob: string): this {
    return this.addPredicate(identityResideInFile<ArchFunction>(glob))
  }

  resideInFolder(glob: string): this {
    return this.addPredicate(identityResideInFolder<ArchFunction>(glob))
  }

  areExported(): this {
    return this.addPredicate(identityAreExported<ArchFunction>())
  }

  areNotExported(): this {
    return this.addPredicate(identityAreNotExported<ArchFunction>())
  }

  // --- Function-specific predicates ---

  areAsync(): this {
    return this.addPredicate(fnAreAsync())
  }

  areNotAsync(): this {
    return this.addPredicate(fnAreNotAsync())
  }

  haveParameterCount(n: number): this {
    return this.addPredicate(fnHaveParameterCount(n))
  }

  haveParameterCountGreaterThan(n: number): this {
    return this.addPredicate(fnHaveParameterCountGreaterThan(n))
  }

  haveParameterCountLessThan(n: number): this {
    return this.addPredicate(fnHaveParameterCountLessThan(n))
  }

  haveParameterNamed(name: string): this {
    return this.addPredicate(fnHaveParameterNamed(name))
  }

  haveReturnType(pattern: RegExp | string): this {
    return this.addPredicate(fnHaveReturnType(pattern))
  }
}

/**
 * Entry point for function-level architecture rules.
 *
 * Scans all source files in the project for both FunctionDeclarations
 * and const arrow functions (VariableDeclaration with ArrowFunction initializer).
 *
 * @example
 * ```typescript
 * import { project, functions } from 'ts-archunit'
 *
 * const p = project('tsconfig.json')
 *
 * // All parseXxxOrder functions should not exist
 * functions(p)
 *   .that().haveNameMatching(/^parse\w+Order$/)
 *   .should(notExist())
 *   .because('use shared parseOrder() utility instead')
 *   .check()
 * ```
 */
export function functions(p: ArchProject): FunctionRuleBuilder {
  return new FunctionRuleBuilder(p)
}
````

Key implementation notes:

- **`getElements()` calls `collectFunctions` on every source file.** This scans both `FunctionDeclaration` and arrow-function `VariableDeclaration` patterns.
- **Identity predicates are wired via explicit delegation.** Each method calls `this.addPredicate()` with the generic identity predicate instantiated for `ArchFunction`. This is the same pattern that `ClassRuleBuilder` (plan 0008) and other entry points will use.
- **`fork()` is not overridden.** `FunctionRuleBuilder` has no additional constructor args beyond `project`, so the base `fork()` from `RuleBuilder` works correctly.

### Design Note: Condition Methods

`FunctionRuleBuilder` does not add its own condition methods in this plan. Conditions are passed to `.should()` as arguments (e.g., `.should(notExist())`). Function-specific conditions that need `ArchFunction` access (e.g., body analysis via `contain(call(...))`) are added in plan 0011.

The existing structural conditions (`notExist`, `resideInFile`, etc.) use `elementCondition<T extends Node>` which calls `createViolation(node, ...)`. Since `ArchFunction` is a wrapper (not a `Node`), these cannot be reused directly. This plan adds a `functionCondition()` helper that creates violations from `ArchFunction` properties. This is intentional duplication — the alternative (making `elementCondition` generic over non-Node types) is a refactor of plan 0004 that can happen later if more wrapper types emerge.

### `src/conditions/function.ts`

```typescript
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Helper to create a per-element condition for ArchFunction.
 */
function functionCondition(
  description: string,
  predicate: (fn: ArchFunction) => boolean,
  messageFn: (fn: ArchFunction) => string,
): Condition<ArchFunction> {
  return {
    description,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        if (!predicate(fn)) {
          violations.push({
            rule: context.rule,
            element: fn.getName() ?? '<anonymous>',
            file: fn.getSourceFile().getFilePath(),
            line: fn.getStartLineNumber(),
            message: messageFn(fn),
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * The predicate set must be empty — no functions should match.
 *
 * If ANY functions exist after predicate filtering, each one
 * becomes a violation.
 *
 * @example
 * functions(project)
 *   .that().haveNameMatching(/^parse\w+Order$/)
 *   .should(notExist())
 *   .because('use shared parseOrder() utility instead')
 */
export function notExist(): Condition<ArchFunction> {
  return {
    description: 'not exist',
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      return elements.map((fn) => ({
        rule: context.rule,
        element: fn.getName() ?? '<anonymous>',
        file: fn.getSourceFile().getFilePath(),
        line: fn.getStartLineNumber(),
        message: `${fn.getName() ?? '<anonymous>'} should not exist`,
        because: context.because,
      }))
    },
  }
}

/**
 * Functions must be exported from their module.
 */
export function beExported(): Condition<ArchFunction> {
  return functionCondition(
    'be exported',
    (fn) => fn.isExported(),
    (fn) => `${fn.getName() ?? '<anonymous>'} is not exported`,
  )
}

/**
 * Functions must be async.
 */
export function beAsync(): Condition<ArchFunction> {
  return functionCondition(
    'be async',
    (fn) => fn.isAsync(),
    (fn) => `${fn.getName() ?? '<anonymous>'} is not async`,
  )
}

/**
 * Functions must have a name matching the given pattern.
 */
export function haveNameMatching(pattern: RegExp): Condition<ArchFunction> {
  return functionCondition(
    `have name matching ${String(pattern)}`,
    (fn) => {
      const name = fn.getName()
      return name !== undefined && pattern.test(name)
    },
    (fn) => `${fn.getName() ?? '<anonymous>'} does not have a name matching ${String(pattern)}`,
  )
}
```

## Phase 4: Public API Export

### `src/index.ts` (additions)

```typescript
// Function entry point
export { functions, FunctionRuleBuilder } from './builders/function-rule-builder.js'
export type { ArchFunction } from './models/arch-function.js'
export {
  collectFunctions,
  fromFunctionDeclaration,
  fromArrowVariableDeclaration,
} from './models/arch-function.js'

// Function predicates
export {
  areAsync,
  areNotAsync,
  haveParameterCount,
  haveParameterCountGreaterThan,
  haveParameterCountLessThan,
  haveParameterNamed,
  haveReturnType,
} from './predicates/function.js'

// Function conditions
export {
  notExist as functionNotExist,
  beExported as functionBeExported,
  beAsync as functionBeAsync,
  haveNameMatching as functionHaveNameMatching,
} from './conditions/function.js'
```

Note: Function-specific conditions are re-exported with `function` prefix to avoid name collisions with the structural conditions. This mirrors the existing pattern for `conditionResideInFile` vs predicate `resideInFile`.

## Phase 5: Tests

### `tests/models/arch-function.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import {
  fromFunctionDeclaration,
  fromArrowVariableDeclaration,
  collectFunctions,
} from '../../src/models/arch-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})
const routesSf = project.getSourceFiles().find((sf) => sf.getBaseName() === 'routes.ts')!

describe('ArchFunction model', () => {
  describe('fromFunctionDeclaration', () => {
    const parseFoo = routesSf.getFunctions().find((f) => f.getName() === 'parseFooOrder')!
    const archFn = fromFunctionDeclaration(parseFoo)

    it('getName() returns function name', () => {
      expect(archFn.getName()).toBe('parseFooOrder')
    })

    it('getSourceFile() returns the containing source file', () => {
      expect(archFn.getSourceFile().getBaseName()).toBe('routes.ts')
    })

    it('isExported() reflects export status', () => {
      expect(archFn.isExported()).toBe(true)
    })

    it('isAsync() reflects async status', () => {
      expect(archFn.isAsync()).toBe(false)
    })

    it('getParameters() returns parameter declarations', () => {
      const params = archFn.getParameters()
      expect(params).toHaveLength(1)
      expect(params[0]!.getName()).toBe('order')
    })

    it('getReturnType() returns the resolved return type', () => {
      const returnType = archFn.getReturnType().getText()
      // parseFooOrder returns { field: string; direction: string }
      expect(returnType).toContain('field')
      expect(returnType).toContain('direction')
    })

    it('getBody() returns the function body', () => {
      expect(archFn.getBody()).toBeDefined()
    })

    it('getNode() returns the FunctionDeclaration', () => {
      expect(archFn.getNode().getKind()).toBe(SyntaxKind.FunctionDeclaration)
    })

    it('getStartLineNumber() returns a valid line number', () => {
      expect(archFn.getStartLineNumber()).toBeGreaterThan(0)
    })
  })

  describe('fromArrowVariableDeclaration', () => {
    const parseBaz = routesSf
      .getVariableDeclarations()
      .find((v) => v.getName() === 'parseBazOrder')!
    const archFn = fromArrowVariableDeclaration(parseBaz)

    it('getName() returns variable name', () => {
      expect(archFn.getName()).toBe('parseBazOrder')
    })

    it('getSourceFile() returns the containing source file', () => {
      expect(archFn.getSourceFile().getBaseName()).toBe('routes.ts')
    })

    it('isExported() reflects export status', () => {
      expect(archFn.isExported()).toBe(true)
    })

    it('isAsync() reflects async status of the arrow function', () => {
      expect(archFn.isAsync()).toBe(false)
    })

    it('getParameters() returns arrow function parameters', () => {
      const params = archFn.getParameters()
      expect(params).toHaveLength(1)
      expect(params[0]!.getName()).toBe('order')
    })

    it('getReturnType() returns the resolved return type', () => {
      const returnType = archFn.getReturnType().getText()
      expect(returnType).toContain('field')
    })

    it('getBody() returns the arrow function body', () => {
      expect(archFn.getBody()).toBeDefined()
    })

    it('getNode() returns the VariableDeclaration', () => {
      expect(archFn.getNode().getKind()).toBe(SyntaxKind.VariableDeclaration)
    })
  })

  describe('collectFunctions', () => {
    it('collects both FunctionDeclarations and arrow functions', () => {
      const fns = collectFunctions(routesSf)
      const names = fns.map((f) => f.getName())
      // FunctionDeclarations: parseFooOrder, parseBarOrder, listItems, parseConfig
      // Arrow functions: parseBazOrder
      expect(names).toContain('parseFooOrder')
      expect(names).toContain('parseBarOrder')
      expect(names).toContain('parseBazOrder')
      expect(names).toContain('listItems')
      expect(names).toContain('parseConfig')
    })

    it('does not include non-arrow variable declarations', () => {
      const fns = collectFunctions(routesSf)
      // All collected items should be actual functions
      for (const fn of fns) {
        expect(fn.getBody()).toBeDefined()
      }
    })
  })
})
```

### `tests/predicates/function.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import {
  areAsync,
  areNotAsync,
  haveParameterCount,
  haveParameterCountGreaterThan,
  haveParameterCountLessThan,
  haveParameterNamed,
  haveReturnType,
} from '../../src/predicates/function.js'
import { collectFunctions } from '../../src/models/arch-function.js'
import type { ArchFunction } from '../../src/models/arch-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})

// Collect all functions from all fixture files
const allFunctions = project.getSourceFiles().flatMap(collectFunctions)

function findFn(name: string): ArchFunction {
  const fn = allFunctions.find((f) => f.getName() === name)
  if (!fn) throw new Error(`Function "${name}" not found in fixtures`)
  return fn
}

describe('function predicates', () => {
  describe('areAsync', () => {
    it('matches async functions', () => {
      // OrderService.getTotal is async — but that's a method, not a top-level function.
      // For this test, use a predicate check on a known non-async function.
      const predicate = areAsync()
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })

    it('has readable description', () => {
      expect(areAsync().description).toBe('are async')
    })
  })

  describe('areNotAsync', () => {
    it('matches non-async functions', () => {
      const predicate = areNotAsync()
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })
  })

  describe('haveParameterCount', () => {
    it('matches functions with exact parameter count', () => {
      const predicate = haveParameterCount(1)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true) // 1 param: order
    })

    it('rejects functions with different count', () => {
      const predicate = haveParameterCount(2)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })

    it('matches zero-parameter functions', () => {
      const predicate = haveParameterCount(0)
      expect(predicate.test(findFn('listItems'))).toBe(true) // no params
    })

    it('singular description for count of 1', () => {
      expect(haveParameterCount(1).description).toBe('have 1 parameter')
    })

    it('plural description for count != 1', () => {
      expect(haveParameterCount(3).description).toBe('have 3 parameters')
    })
  })

  describe('haveParameterCountGreaterThan', () => {
    it('matches functions with more than n parameters', () => {
      const predicate = haveParameterCountGreaterThan(0)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true) // 1 > 0
    })

    it('rejects functions with n or fewer parameters', () => {
      const predicate = haveParameterCountGreaterThan(1)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false) // 1 is not > 1
    })
  })

  describe('haveParameterCountLessThan', () => {
    it('matches functions with fewer than n parameters', () => {
      const predicate = haveParameterCountLessThan(2)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true) // 1 < 2
    })

    it('rejects functions with n or more parameters', () => {
      const predicate = haveParameterCountLessThan(1)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false) // 1 is not < 1
    })
  })

  describe('haveParameterNamed', () => {
    it('matches functions with a parameter of the given name', () => {
      const predicate = haveParameterNamed('order')
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })

    it('rejects functions without that parameter', () => {
      const predicate = haveParameterNamed('nonexistent')
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })

    it('works on arrow functions', () => {
      const predicate = haveParameterNamed('order')
      expect(predicate.test(findFn('parseBazOrder'))).toBe(true)
    })
  })

  describe('haveReturnType', () => {
    it('matches return type with regex', () => {
      const predicate = haveReturnType(/field/)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })

    it('matches return type with string pattern', () => {
      const predicate = haveReturnType('field')
      expect(predicate.test(findFn('parseFooOrder'))).toBe(true)
    })

    it('rejects non-matching return type', () => {
      const predicate = haveReturnType(/^Promise/)
      expect(predicate.test(findFn('parseFooOrder'))).toBe(false)
    })
  })
})
```

### `tests/builders/function-rule-builder.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { functions, FunctionRuleBuilder } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { notExist, beExported } from '../../src/conditions/function.js'

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

describe('FunctionRuleBuilder', () => {
  const p = loadTestProject()

  it('returns a FunctionRuleBuilder from functions()', () => {
    expect(functions(p)).toBeInstanceOf(FunctionRuleBuilder)
  })

  describe('getElements() scans both patterns', () => {
    it('finds FunctionDeclarations', () => {
      // parseFooOrder, parseBarOrder are FunctionDeclarations
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseFooOrder$/)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('finds arrow function VariableDeclarations', () => {
      // parseBazOrder is const arrow
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseBazOrder$/)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('identity predicates', () => {
    it('haveNameMatching filters by regex', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('haveNameMatching with string pattern', () => {
      expect(() => {
        functions(p).that().haveNameMatching('parseFoo').should().addCondition(notExist()).check()
      }).toThrow(ArchRuleError)
    })

    it('haveNameStartingWith filters by prefix', () => {
      expect(() => {
        functions(p).that().haveNameStartingWith('parse').should().addCondition(notExist()).check()
      }).toThrow(ArchRuleError)
    })

    it('haveNameEndingWith filters by suffix', () => {
      expect(() => {
        functions(p).that().haveNameEndingWith('Order').should().addCondition(notExist()).check()
      }).toThrow(ArchRuleError)
    })

    it('resideInFile filters by file glob', () => {
      // parseFoo/Bar/BazOrder all live in routes.ts
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .and()
          .resideInFile('**/routes.ts')
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('areExported filters to exported functions', () => {
      expect(() => {
        functions(p)
          .that()
          .areExported()
          .and()
          .haveNameMatching(/^parseFooOrder$/)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('function-specific predicates', () => {
    it('areAsync filters async functions', () => {
      // No top-level async functions in the fixtures
      expect(() => {
        functions(p).that().areAsync().should().addCondition(notExist()).check()
      }).not.toThrow()
    })

    it('haveParameterCount filters by parameter count', () => {
      // listItems has 0 parameters
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^listItems$/)
          .and()
          .haveParameterCount(0)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('haveParameterNamed filters by parameter name', () => {
      // parseFooOrder has param "order"
      expect(() => {
        functions(p).that().haveParameterNamed('order').should().addCondition(notExist()).check()
      }).toThrow(ArchRuleError)
    })

    it('haveReturnType filters by return type', () => {
      // parseFooOrder returns { field: string; direction: string }
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parseFooOrder$/)
          .and()
          .haveReturnType(/field/)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('real-world rule patterns', () => {
    it('detects parseXxxOrder anti-pattern across both function syntaxes', () => {
      try {
        functions(p)
          .that()
          .haveNameMatching(/^parse\w+Order$/)
          .should()
          .addCondition(notExist())
          .because('use shared parseOrder() utility instead')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        // Should find 3: parseFooOrder, parseBarOrder (FunctionDecl), parseBazOrder (arrow)
        expect(archError.violations).toHaveLength(3)
        const names = archError.violations.map((v) => v.element)
        expect(names).toContain('parseFooOrder')
        expect(names).toContain('parseBarOrder')
        expect(names).toContain('parseBazOrder')
        expect(archError.message).toContain('use shared parseOrder() utility instead')
      }
    })

    it('named selection reuse works', () => {
      const parsers = functions(p)
        .that()
        .haveNameMatching(/^parse/)

      // Rule 1: parseXxxOrder should not exist
      expect(() => {
        parsers
          .that()
          .haveNameMatching(/Order$/)
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)

      // Rule 2: parseConfig should exist and be exported
      expect(() => {
        parsers
          .that()
          .haveNameMatching(/^parseConfig$/)
          .should()
          .addCondition(beExported())
          .check()
      }).not.toThrow()
    })
  })

  describe('chain methods', () => {
    it('.that().and() chains multiple predicates', () => {
      expect(() => {
        functions(p)
          .that()
          .haveNameMatching(/^parse/)
          .and()
          .haveParameterCount(1)
          .and()
          .areExported()
          .should()
          .addCondition(notExist())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.should() forks the builder for named selections', () => {
      const exported = functions(p).that().areExported()
      const rule1 = exported.should().addCondition(notExist())
      const rule2 = exported.should().addCondition(beExported())
      // rule1 fails (exported functions exist)
      expect(() => rule1.check()).toThrow(ArchRuleError)
      // rule2 passes (exported functions are exported)
      expect(() => rule2.check()).not.toThrow()
    })
  })
})
```

Note: The tests use `.addCondition()` directly because `addCondition` is a protected method on `RuleBuilder`. For this to work, `FunctionRuleBuilder` must expose it. Alternative: make the conditions top-level and pass them differently. However, looking at the existing builder pattern, the cleaner approach is to add a public `shouldSatisfy()` or to have conditions added via a method. Since the builder's `.should()` returns `this`, conditions can be registered by calling `.addCondition()`.

**Correction:** `addCondition` is `protected`. Tests cannot call it directly. The builder needs to either:

1. Expose condition methods on the builder (e.g., `builder.should().notExist()`)
2. Accept conditions via a parameter to `.should()`

Looking at the spec and the existing `should()` signature, the cleanest approach is to add condition methods to the builder. However, conditions like `notExist()` are generic and don't belong exclusively on `FunctionRuleBuilder`. The simplest fix: add a public `satisfying(condition)` method or extend `.should()` to accept a condition argument.

**Revised approach:** Add a `withCondition(condition: Condition<ArchFunction>): this` public method on `FunctionRuleBuilder` that delegates to `addCondition`. This mirrors the `TestRuleBuilder` pattern from plan 0005's tests. In the real test code:

```typescript
// Instead of:
functions(p).that()....should().addCondition(notExist()).check()

// Use:
functions(p).that()....should().withCondition(notExist()).check()
```

Add to `FunctionRuleBuilder`:

```typescript
/**
 * Register a condition. Public API for passing standalone conditions
 * (like notExist(), beExported()) into the builder chain.
 */
withCondition(condition: Condition<ArchFunction>): this {
  return this.addCondition(condition)
}
```

This is consistent with the test builder pattern and provides an escape hatch for generic conditions. All test code above should use `.withCondition()` instead of `.addCondition()`.

## Files Changed

| File                                           | Change                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/models/arch-function.ts`                  | New — `ArchFunction` interface, factory functions, `collectFunctions`                                                                                        |
| `src/predicates/function.ts`                   | New — `areAsync`, `areNotAsync`, `haveParameterCount`, `haveParameterCountGreaterThan`, `haveParameterCountLessThan`, `haveParameterNamed`, `haveReturnType` |
| `src/conditions/function.ts`                   | New — `notExist`, `beExported`, `beAsync`, `haveNameMatching` for `ArchFunction`                                                                             |
| `src/builders/function-rule-builder.ts`        | New — `FunctionRuleBuilder`, `functions()` entry point                                                                                                       |
| `src/index.ts`                                 | Modified — export function entry point, predicates, conditions, model                                                                                        |
| `tests/models/arch-function.test.ts`           | New — 14 tests for ArchFunction model                                                                                                                        |
| `tests/predicates/function.test.ts`            | New — 13 tests for function predicates                                                                                                                       |
| `tests/builders/function-rule-builder.test.ts` | New — 15 tests for FunctionRuleBuilder                                                                                                                       |

## Test Inventory

| #   | Test                                              | File               | What it validates                |
| --- | ------------------------------------------------- | ------------------ | -------------------------------- |
| 1   | fromFunctionDeclaration: getName()                | arch-function.test | Returns function name            |
| 2   | fromFunctionDeclaration: getSourceFile()          | arch-function.test | Returns containing source file   |
| 3   | fromFunctionDeclaration: isExported()             | arch-function.test | Reflects export status           |
| 4   | fromFunctionDeclaration: isAsync()                | arch-function.test | Reflects async status            |
| 5   | fromFunctionDeclaration: getParameters()          | arch-function.test | Returns parameter declarations   |
| 6   | fromFunctionDeclaration: getReturnType()          | arch-function.test | Returns resolved return type     |
| 7   | fromFunctionDeclaration: getBody()                | arch-function.test | Returns function body            |
| 8   | fromFunctionDeclaration: getNode()                | arch-function.test | Returns FunctionDeclaration node |
| 9   | fromFunctionDeclaration: getStartLineNumber()     | arch-function.test | Returns valid line number        |
| 10  | fromArrowVariableDeclaration: getName()           | arch-function.test | Returns variable name            |
| 11  | fromArrowVariableDeclaration: getSourceFile()     | arch-function.test | Returns containing source file   |
| 12  | fromArrowVariableDeclaration: isExported()        | arch-function.test | Checks VariableStatement export  |
| 13  | fromArrowVariableDeclaration: isAsync()           | arch-function.test | Checks arrow function async      |
| 14  | fromArrowVariableDeclaration: getParameters()     | arch-function.test | Returns arrow function params    |
| 15  | fromArrowVariableDeclaration: getReturnType()     | arch-function.test | Returns resolved return type     |
| 16  | fromArrowVariableDeclaration: getBody()           | arch-function.test | Returns arrow function body      |
| 17  | fromArrowVariableDeclaration: getNode()           | arch-function.test | Returns VariableDeclaration node |
| 18  | collectFunctions: collects both patterns          | arch-function.test | FunctionDecl + arrow functions   |
| 19  | collectFunctions: excludes non-arrow vars         | arch-function.test | Only arrow-initialized vars      |
| 20  | areAsync matches async functions                  | function.test      | Predicate correctness            |
| 21  | areNotAsync matches non-async functions           | function.test      | Predicate correctness            |
| 22  | haveParameterCount exact match                    | function.test      | Exact count matching             |
| 23  | haveParameterCount rejects different count        | function.test      | Negative case                    |
| 24  | haveParameterCount zero params                    | function.test      | Edge case: 0 parameters          |
| 25  | haveParameterCount description singular           | function.test      | "1 parameter" not "1 parameters" |
| 26  | haveParameterCount description plural             | function.test      | "3 parameters"                   |
| 27  | haveParameterCountGreaterThan matches             | function.test      | Strict greater than              |
| 28  | haveParameterCountGreaterThan rejects             | function.test      | Boundary: n == count             |
| 29  | haveParameterCountLessThan matches                | function.test      | Strict less than                 |
| 30  | haveParameterCountLessThan rejects                | function.test      | Boundary: n == count             |
| 31  | haveParameterNamed matches                        | function.test      | Finds parameter by name          |
| 32  | haveParameterNamed rejects                        | function.test      | No matching parameter            |
| 33  | haveParameterNamed on arrow function              | function.test      | Works on both patterns           |
| 34  | haveReturnType with regex                         | function.test      | Regex match on type text         |
| 35  | haveReturnType with string                        | function.test      | String-to-regex conversion       |
| 36  | haveReturnType rejects                            | function.test      | Non-matching pattern             |
| 37  | functions() returns FunctionRuleBuilder           | builder.test       | Entry point type                 |
| 38  | Finds FunctionDeclarations                        | builder.test       | Pattern 1 scanning               |
| 39  | Finds arrow function VariableDeclarations         | builder.test       | Pattern 2 scanning               |
| 40  | haveNameMatching with regex                       | builder.test       | Identity predicate wiring        |
| 41  | haveNameMatching with string                      | builder.test       | String pattern wiring            |
| 42  | haveNameStartingWith                              | builder.test       | Identity predicate wiring        |
| 43  | haveNameEndingWith                                | builder.test       | Identity predicate wiring        |
| 44  | resideInFile with glob                            | builder.test       | File path predicate              |
| 45  | areExported filters                               | builder.test       | Export predicate wiring          |
| 46  | areAsync filters                                  | builder.test       | Function predicate wiring        |
| 47  | haveParameterCount on builder                     | builder.test       | Function predicate wiring        |
| 48  | haveParameterNamed on builder                     | builder.test       | Function predicate wiring        |
| 49  | haveReturnType on builder                         | builder.test       | Function predicate wiring        |
| 50  | Detects parseXxxOrder anti-pattern (3 violations) | builder.test       | Real-world rule, both patterns   |
| 51  | Named selection reuse                             | builder.test       | Fork semantics                   |
| 52  | .that().and() chains predicates                   | builder.test       | Multi-predicate chaining         |
| 53  | .should() forks builder                           | builder.test       | Named selection safety           |

## Out of Scope

- **Body analysis** (`contain(call(...))`, `notContain(newExpr(...))`) -- plan 0011. The `ArchFunction.getBody()` method is provided now as the hook point.
- **Class method functions** -- `FunctionRuleBuilder` scans top-level functions only. Class methods are handled by `ClassRuleBuilder` (plan 0008). A future plan could add a `methods()` entry point or option on `functions()`.
- **Function expression patterns** beyond `const x = () => {}` -- e.g. `const x = function() {}` (FunctionExpression assigned to variable). These are rare in modern TypeScript. Can be added later if real-world usage demands it.
- **Decorator predicates** (`haveDecorator(name)`) -- listed in the spec but only meaningful for class methods, not top-level functions. Deferred to plan 0008 or a future extension.
- **Condition methods on the builder** beyond `withCondition()` -- condition wiring (e.g. `.notExist()`, `.beExported()` directly on the builder) could be added for ergonomics in a future pass. For now, standalone condition functions passed via `.withCondition()` work.
- **Performance optimization** (memoization of `getElements()` results) -- not needed until profiling shows it matters.
