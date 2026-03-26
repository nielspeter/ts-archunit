# Plan 0010: Type Entry Point & Type-Level Conditions

## Status

- **State:** Complete
- **Priority:** P1 — Core entry point; THE differentiator for type safety enforcement
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0002 (Project Loader), 0003 (Predicate Engine), 0004 (Condition Engine), 0005 (Rule Builder)

## Purpose

Implement the `types(p)` entry point that operates on both `InterfaceDeclaration` and `TypeAliasDeclaration`. This plan delivers the type-level conditions that distinguish ts-archunit from other architecture testing tools — the ability to enforce constraints on property types using semantic matchers that understand the TypeScript type system.

The motivating use case from the PoC (plan 0001, cmless plan 0212): enforcing that `sortBy` properties must never be bare `string` but always a union of string literals. This catches real bugs where untyped sort columns bypass compile-time safety and only fail at runtime.

```typescript
// The rule this plan enables:
types(project)
  .that()
  .haveProperty('sortBy')
  .should()
  .havePropertyType('sortBy', not(isString()))
  .because('sortBy must be a union of string literals, not bare string')
  .check()
```

### Design Decision: Union Type over Wrapper

The builder uses `InterfaceDeclaration | TypeAliasDeclaration` directly rather than a wrapper class. Both types share `getName()`, `getSourceFile()`, and `isExported()`, so identity predicates work without adaptation. Where behavior diverges (property access), type guards handle the distinction. A type alias keeps it readable:

```typescript
type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration
```

This avoids the overhead of a wrapper class while keeping the API clean. If future needs require normalization (e.g., enum declarations), a wrapper can be introduced without breaking the public API.

### Design Decision: TypeMatcher as Simple Functions

Type matchers are plain functions `(type: Type) => boolean`. This is simpler than making them objects with descriptions. The condition (`havePropertyType`) is responsible for the description, and matchers compose via standard function composition. Every matcher MUST call `getNonNullableType()` internally to handle optional properties — this was a critical PoC finding.

## Phase 1: TypeMatcher Helpers

### `src/helpers/type-matchers.ts`

```typescript
import type { Type } from 'ts-morph'

/**
 * A function that tests a ts-morph Type against a condition.
 *
 * All matchers MUST call getNonNullableType() internally to handle
 * optional properties (strip `undefined` from `T | undefined`).
 * This was a critical finding from the PoC (plan 0001).
 */
export type TypeMatcher = (type: Type) => boolean

/**
 * Negates a matcher. The property type must NOT satisfy the inner matcher.
 *
 * @example
 * not(isString())  // any type except bare string
 */
export function not(matcher: TypeMatcher): TypeMatcher {
  return (type) => !matcher(type)
}

/**
 * Matches bare `string` type.
 * Does NOT match string literal types like `'foo'` or unions of string literals.
 *
 * @example
 * isString()  // matches `string`, not `'a' | 'b'`
 */
export function isString(): TypeMatcher {
  return (type) => type.getNonNullableType().isString()
}

/**
 * Matches bare `number` type.
 * Does NOT match number literal types like `42` or unions of number literals.
 */
export function isNumber(): TypeMatcher {
  return (type) => type.getNonNullableType().isNumber()
}

/**
 * Matches bare `boolean` type.
 */
export function isBoolean(): TypeMatcher {
  return (type) => type.getNonNullableType().isBoolean()
}

/**
 * Matches a union of string literals OR number literals.
 * Requires at least 2 union members (a single literal is not a "union of literals").
 *
 * Handles: `'a' | 'b'`, `1 | 2 | 3`, NOT `string`, NOT `'a' | string`.
 *
 * @example
 * isUnionOfLiterals()  // matches `'asc' | 'desc'`, not `string`
 */
export function isUnionOfLiterals(): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    if (!t.isUnion()) return false
    const members = t.getUnionTypes()
    if (members.length < 2) return false
    return members.every((m) => m.isStringLiteral() || m.isNumberLiteral())
  }
}

/**
 * Matches a specific string literal type (e.g., `'created_at'`).
 * If no value is provided, matches ANY string literal type.
 *
 * @example
 * isStringLiteral()            // matches any string literal
 * isStringLiteral('created_at') // matches only 'created_at'
 */
export function isStringLiteral(value?: string): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    if (!t.isStringLiteral()) return false
    if (value === undefined) return true
    return t.getLiteralValue() === value
  }
}

/**
 * Matches an array type where the element type satisfies the inner matcher.
 *
 * @example
 * arrayOf(isString())  // matches `string[]`
 * arrayOf(isUnionOfLiterals())  // matches `('a' | 'b')[]`
 */
export function arrayOf(elementMatcher: TypeMatcher): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    if (!t.isArray()) return false
    const elementType = t.getArrayElementTypeOrThrow()
    return elementMatcher(elementType)
  }
}

/**
 * Matches when the type's text representation matches the given regex.
 * Escape hatch for types not covered by semantic matchers.
 *
 * Operates on the result of `type.getText()` which returns the type
 * as TypeScript would display it.
 *
 * @example
 * matching(/^Record</)  // matches Record<string, unknown>, etc.
 * matching(/Promise/)   // matches Promise<T> types
 */
export function matching(regex: RegExp): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    return regex.test(t.getText())
  }
}

/**
 * Matches when the type text is exactly the given string.
 * Useful for matching specific type references.
 *
 * @example
 * exactly('SortColumn')  // matches the SortColumn type alias
 */
export function exactly(typeText: string): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    return t.getText() === typeText
  }
}
```

Note on `not()`: This is a _type matcher_ combinator, separate from the predicate combinator `not()` in `src/core/predicate.ts`. They operate at different levels — predicate `not()` inverts element filtering, matcher `not()` inverts type matching within a condition. Users import from different paths or use the namespace to disambiguate:

```typescript
import { not } from 'ts-archunit/helpers/type-matchers' // type matcher
import { not as notPredicate } from 'ts-archunit' // predicate combinator
```

In practice, they rarely appear in the same file. The `not()` in a `.should().havePropertyType()` call is always the type matcher version.

## Phase 2: Type Predicates

### `src/predicates/type.ts`

```typescript
import { Node, type InterfaceDeclaration, type TypeAliasDeclaration } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'

/**
 * Union type representing both interface and type alias declarations.
 * Used as the element type for TypeRuleBuilder.
 */
export type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration

/**
 * Matches only InterfaceDeclaration elements.
 *
 * @example
 * types(project).that().areInterfaces()  // only interfaces, not type aliases
 */
export function areInterfaces(): Predicate<TypeDeclaration> {
  return {
    description: 'are interfaces',
    test: (element) => Node.isInterfaceDeclaration(element),
  }
}

/**
 * Matches only TypeAliasDeclaration elements.
 *
 * @example
 * types(project).that().areTypeAliases()  // only type aliases, not interfaces
 */
export function areTypeAliases(): Predicate<TypeDeclaration> {
  return {
    description: 'are type aliases',
    test: (element) => Node.isTypeAliasDeclaration(element),
  }
}

/**
 * Matches types that have a property with the given name.
 * Works for both interfaces (direct properties) and type aliases
 * (resolved type properties).
 *
 * @example
 * types(project).that().haveProperty('sortBy')
 */
export function haveProperty(name: string): Predicate<TypeDeclaration> {
  return {
    description: `have property "${name}"`,
    test: (element) => {
      const type = getResolvedType(element)
      return type.getProperty(name) !== undefined
    },
  }
}

/**
 * Matches types that have a property whose type satisfies the given matcher.
 * Resolves through type aliases, Partial<>, Pick<>, etc.
 *
 * For InterfaceDeclaration: gets the property symbol and its type directly.
 * For TypeAliasDeclaration: resolves the type and uses getTypeAtLocation()
 * to get the property type in context (critical for Partial<>, Pick<>).
 *
 * @example
 * types(project).that().havePropertyOfType('sortBy', isString())
 */
export function havePropertyOfType(name: string, matcher: TypeMatcher): Predicate<TypeDeclaration> {
  return {
    description: `have property "${name}" of matching type`,
    test: (element) => {
      const propType = getPropertyType(element, name)
      if (propType === undefined) return false
      return matcher(propType)
    },
  }
}

/**
 * Matches interfaces that extend the given type name.
 * For type aliases, checks if the type is an intersection that includes
 * the named type, or if it extends it directly.
 *
 * @example
 * types(project).that().extendType('BaseConfig')
 */
export function extendType(name: string): Predicate<TypeDeclaration> {
  return {
    description: `extend type "${name}"`,
    test: (element) => {
      if (Node.isInterfaceDeclaration(element)) {
        return element.getExtends().some((ext) => ext.getText().startsWith(name))
      }
      // For type aliases, check if the type text references the name
      // This is a pragmatic approach — exact heritage tracking for type aliases
      // is complex and rarely needed
      const typeText = element.getType().getText()
      return typeText.includes(name)
    },
  }
}

// --- Internal helpers ---

/**
 * Resolve a TypeDeclaration to its ts-morph Type.
 */
function getResolvedType(element: TypeDeclaration) {
  return element.getType()
}

/**
 * Get the Type of a named property on a TypeDeclaration.
 *
 * For interfaces: straightforward property type lookup.
 * For type aliases: uses getTypeAtLocation() to resolve in context.
 * This is critical for Partial<T>, Pick<T, K>, and other mapped types
 * where the property type depends on the alias context.
 */
function getPropertyType(element: TypeDeclaration, name: string) {
  const type = getResolvedType(element)
  const prop = type.getProperty(name)
  if (prop === undefined) return undefined

  if (Node.isTypeAliasDeclaration(element)) {
    // For type aliases (Partial<>, Pick<>, etc.), getTypeAtLocation
    // resolves the property type in the context of the alias declaration.
    // Without this, Partial<StrictOptions>['sortBy'] would not resolve correctly.
    return prop.getTypeAtLocation(element)
  }

  // For interfaces, direct type lookup works
  return prop.getTypeAtLocation(element)
}
```

Key implementation detail: `getPropertyType` uses `getTypeAtLocation(element)` for both interfaces and type aliases. This ensures consistent behavior and correctly resolves mapped types like `Partial<>` and `Pick<>` where the property type depends on the declaration context. This was a critical PoC finding — calling `prop.getType()` directly fails for type aliases wrapping mapped types.

## Phase 3: Type-Level Conditions

### `src/conditions/type-level.ts`

```typescript
import { Node, type InterfaceDeclaration, type TypeAliasDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementName } from '../core/violation.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'

type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration

/**
 * Assert that a named property's type satisfies the given matcher.
 *
 * This is the key condition for type-level architecture rules.
 * Resolves through type aliases, Partial<>, Pick<>, etc.
 *
 * Elements without the named property are skipped (no violation).
 * Use the `haveProperty()` predicate to filter to types that have the property.
 *
 * @example
 * // sortBy must not be bare string
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .check()
 *
 * // sortBy must be a union of string literals
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', isUnionOfLiterals())
 *   .check()
 */
export function havePropertyType(
  propertyName: string,
  matcher: TypeMatcher,
): Condition<TypeDeclaration> {
  return {
    description: `have property "${propertyName}" with matching type`,
    evaluate(elements: TypeDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []

      for (const element of elements) {
        const type = element.getType()
        const prop = type.getProperty(propertyName)

        // Skip elements without the property — not a violation.
        // The predicate haveProperty() should be used to filter these out.
        if (prop === undefined) continue

        // Resolve property type in context (critical for Partial<>, Pick<>)
        const propType = prop.getTypeAtLocation(element)
        const stripped = propType.getNonNullableType()
        const typeText = stripped.getText()

        if (!matcher(propType)) {
          violations.push(
            createViolation(
              element,
              `property "${propertyName}" has type '${typeText}' which does not match the expected type constraint`,
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

Note: The condition calls `matcher(propType)` with the raw property type — the matcher itself is responsible for calling `getNonNullableType()`. This avoids double-stripping and keeps the condition logic clean. The `stripped` variable is only used for the violation message.

## Phase 4: TypeRuleBuilder

### `src/builders/type-rule-builder.ts`

```typescript
import { Node, type InterfaceDeclaration, type TypeAliasDeclaration } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import { RuleBuilder } from '../core/rule-builder.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'
import {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
} from '../predicates/type.js'
import { havePropertyType } from '../conditions/type-level.js'
import type { Condition } from '../core/condition.js'

type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration

/**
 * Rule builder for interface and type alias declarations.
 *
 * Returned by the `types()` entry point. Provides type-specific
 * predicates and conditions on top of the base RuleBuilder chain.
 *
 * @example
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .because('sortBy must be a union of literals, not bare string')
 *   .check()
 */
export class TypeRuleBuilder extends RuleBuilder<TypeDeclaration> {
  constructor(project: ArchProject) {
    super(project)
  }

  /**
   * Collect all InterfaceDeclarations and TypeAliasDeclarations
   * from all source files in the project.
   */
  protected getElements(): TypeDeclaration[] {
    const elements: TypeDeclaration[] = []
    for (const sf of this.project.getSourceFiles()) {
      elements.push(...sf.getInterfaces())
      elements.push(...sf.getTypeAliases())
    }
    return elements
  }

  // --- Type-specific predicates ---

  /**
   * Filter to only InterfaceDeclaration elements.
   */
  areInterfaces(): this {
    return this.addPredicate(areInterfaces())
  }

  /**
   * Filter to only TypeAliasDeclaration elements.
   */
  areTypeAliases(): this {
    return this.addPredicate(areTypeAliases())
  }

  /**
   * Filter to types that have a property with the given name.
   */
  haveProperty(name: string): this {
    return this.addPredicate(haveProperty(name))
  }

  /**
   * Filter to types that have a property whose type matches the given matcher.
   */
  havePropertyOfType(name: string, matcher: TypeMatcher): this {
    return this.addPredicate(havePropertyOfType(name, matcher))
  }

  /**
   * Filter to types that extend the given type name.
   */
  extendType(name: string): this {
    return this.addPredicate(extendType(name))
  }

  // --- Type-specific conditions ---

  /**
   * Assert that the named property's type satisfies the matcher.
   *
   * Elements without the property are skipped (not a violation).
   * Combine with `.that().haveProperty(name)` to ensure the property exists.
   */
  havePropertyType(name: string, matcher: TypeMatcher): this {
    return this.addCondition(havePropertyType(name, matcher) as Condition<TypeDeclaration>)
  }

  // --- Identity predicates (delegated to shared predicates) ---
  // haveNameMatching, resideInFile, resideInFolder, areExported, areNotExported
  // are inherited from RuleBuilder via addPredicate() — users call them as
  // standalone functions passed to .that():
  //
  //   types(project).that().addPredicate(haveNameMatching(/Options$/))
  //
  // For ergonomics, we provide direct methods:

  /**
   * Filter to types whose name matches the given regex or string pattern.
   */
  haveNameMatching(pattern: RegExp | string): this {
    const { haveNameMatching: pred } = require('../predicates/identity.js')
    return this.addPredicate(pred(pattern))
  }

  /**
   * Filter to types that are exported.
   */
  areExported(): this {
    const { areExported: pred } = require('../predicates/identity.js')
    return this.addPredicate(pred())
  }

  /**
   * Filter to types that reside in a file matching the glob.
   */
  resideInFile(glob: string): this {
    const { resideInFile: pred } = require('../predicates/identity.js')
    return this.addPredicate(pred(glob))
  }

  /**
   * Filter to types that reside in a folder matching the glob.
   */
  resideInFolder(glob: string): this {
    const { resideInFolder: pred } = require('../predicates/identity.js')
    return this.addPredicate(pred(glob))
  }
}
```

Wait — using `require()` is wrong for an ESM-only package. The identity predicates should be imported statically. Let me revise:

### `src/builders/type-rule-builder.ts` (revised)

```typescript
import type { InterfaceDeclaration, TypeAliasDeclaration } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import { RuleBuilder } from '../core/rule-builder.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'
import {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
  type TypeDeclaration,
} from '../predicates/type.js'
import { havePropertyType } from '../conditions/type-level.js'
import type { Condition } from '../core/condition.js'
import {
  haveNameMatching as identityHaveNameMatching,
  resideInFile as identityResideInFile,
  resideInFolder as identityResideInFolder,
  areExported as identityAreExported,
  areNotExported as identityAreNotExported,
} from '../predicates/identity.js'

/**
 * Rule builder for interface and type alias declarations.
 *
 * Returned by the `types()` entry point. Provides type-specific
 * predicates and conditions on top of the base RuleBuilder chain.
 *
 * @example
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .because('sortBy must be a union of literals, not bare string')
 *   .check()
 */
export class TypeRuleBuilder extends RuleBuilder<TypeDeclaration> {
  constructor(project: ArchProject) {
    super(project)
  }

  /**
   * Collect all InterfaceDeclarations and TypeAliasDeclarations
   * from all source files in the project.
   */
  protected getElements(): TypeDeclaration[] {
    const elements: TypeDeclaration[] = []
    for (const sf of this.project.getSourceFiles()) {
      elements.push(...sf.getInterfaces())
      elements.push(...sf.getTypeAliases())
    }
    return elements
  }

  // --- Type-specific predicates ---

  areInterfaces(): this {
    return this.addPredicate(areInterfaces())
  }

  areTypeAliases(): this {
    return this.addPredicate(areTypeAliases())
  }

  haveProperty(name: string): this {
    return this.addPredicate(haveProperty(name))
  }

  havePropertyOfType(name: string, matcher: TypeMatcher): this {
    return this.addPredicate(havePropertyOfType(name, matcher))
  }

  extendType(name: string): this {
    return this.addPredicate(extendType(name))
  }

  // --- Type-specific conditions ---

  havePropertyType(name: string, matcher: TypeMatcher): this {
    return this.addCondition(havePropertyType(name, matcher) as Condition<TypeDeclaration>)
  }

  // --- Identity predicates (convenience wrappers) ---

  haveNameMatching(pattern: RegExp | string): this {
    return this.addPredicate(identityHaveNameMatching(pattern))
  }

  areExported(): this {
    return this.addPredicate(identityAreExported())
  }

  areNotExported(): this {
    return this.addPredicate(identityAreNotExported())
  }

  resideInFile(glob: string): this {
    return this.addPredicate(identityResideInFile(glob))
  }

  resideInFolder(glob: string): this {
    return this.addPredicate(identityResideInFolder(glob))
  }
}
```

## Phase 5: Entry Function

### `src/builders/type-rule-builder.ts`

```typescript
import type { ArchProject } from '../core/project.js'
import { TypeRuleBuilder } from '../builders/type-rule-builder.js'

/**
 * Entry point for rules on interface and type alias declarations.
 *
 * Returns a TypeRuleBuilder that can filter and assert on all
 * InterfaceDeclaration and TypeAliasDeclaration nodes in the project.
 *
 * @example
 * // All types with a sortBy property must not use bare string
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .check()
 *
 * // All exported interfaces must have names ending in Options or Config
 * types(project)
 *   .that().areInterfaces().and().areExported()
 *   .should().haveNameMatching(/(?:Options|Config)$/)
 *   .check()
 */
export function types(project: ArchProject): TypeRuleBuilder {
  return new TypeRuleBuilder(project)
}
```

## Phase 6: Public API Exports

### `src/index.ts` additions

```typescript
// Type entry point
export { types } from './builders/type-rule-builder.js'
export { TypeRuleBuilder } from './builders/type-rule-builder.js'

// Type predicates
export type { TypeDeclaration } from './predicates/type.js'
export {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
} from './predicates/type.js'

// Type-level conditions
export { havePropertyType } from './conditions/type-level.js'

// Type matchers
export type { TypeMatcher } from './helpers/type-matchers.js'
export {
  not as notType,
  isString,
  isNumber,
  isBoolean,
  isUnionOfLiterals,
  isStringLiteral,
  arrayOf,
  matching,
  exactly,
} from './helpers/type-matchers.js'
```

Note: The type matcher `not()` is exported as `notType()` from the top-level index to avoid collision with the predicate combinator `not()`. When importing from `'ts-archunit/helpers/type-matchers'` directly, users get the unaliased `not()`.

## Phase 7: Tests

### `tests/helpers/type-matchers.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  not,
  isString,
  isNumber,
  isBoolean,
  isUnionOfLiterals,
  isStringLiteral,
  arrayOf,
  matching,
  exactly,
} from '../../src/helpers/type-matchers.js'

/**
 * Tests use the PoC options.ts fixture which has:
 * - UnsafeOptions { sortBy?: string }
 * - SafeOptions { sortBy?: 'created_at' | 'updated_at' | 'name' }
 * - AliasedOptions { sortBy?: SortColumn }
 * - PartialStrictOptions = Partial<StrictOptions>
 * - PickedOptions = Pick<SafeOptions, 'sortBy'>
 * - SingleLiteralOptions { sortBy?: 'created_at' }
 * - UnrelatedOptions { limit?: number; offset?: number }
 * - ExplicitUndefinedOptions { sortBy: 'a' | 'b' | undefined }
 */
const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getPropertyType(interfaceName: string, propertyName: string) {
  const sf = tsMorphProject.getSourceFileOrThrow('options.ts')
  const iface = sf.getInterface(interfaceName)
  if (iface) {
    const prop = iface.getType().getProperty(propertyName)
    return prop?.getTypeAtLocation(iface)
  }
  const alias = sf.getTypeAlias(interfaceName)
  if (alias) {
    const prop = alias.getType().getProperty(propertyName)
    return prop?.getTypeAtLocation(alias)
  }
  throw new Error(`Type ${interfaceName} not found`)
}

describe('TypeMatcher', () => {
  describe('isString()', () => {
    it('matches bare string type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isString()(type)).toBe(true)
    })

    it('does not match string literal union', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(isString()(type)).toBe(false)
    })

    it('does not match number type', () => {
      const type = getPropertyType('UnrelatedOptions', 'limit')!
      expect(isString()(type)).toBe(false)
    })
  })

  describe('isNumber()', () => {
    it('matches bare number type', () => {
      const type = getPropertyType('UnrelatedOptions', 'limit')!
      expect(isNumber()(type)).toBe(true)
    })

    it('does not match string type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isNumber()(type)).toBe(false)
    })
  })

  describe('isBoolean()', () => {
    it('does not match string type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isBoolean()(type)).toBe(false)
    })
  })

  describe('not()', () => {
    it('inverts a matcher', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(not(isString())(type)).toBe(false)
    })

    it('passes when inner matcher fails', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(not(isString())(type)).toBe(true)
    })
  })

  describe('isUnionOfLiterals()', () => {
    it('matches union of string literals', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('does not match bare string', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(false)
    })

    it('does not match single string literal', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(false)
    })

    it('matches through type alias (AliasedOptions -> SortColumn)', () => {
      const type = getPropertyType('AliasedOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('matches through Partial<> wrapper', () => {
      const type = getPropertyType('PartialStrictOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('matches through Pick<> wrapper', () => {
      const type = getPropertyType('PickedOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })

    it('matches union with explicit undefined stripped', () => {
      const type = getPropertyType('ExplicitUndefinedOptions', 'sortBy')!
      expect(isUnionOfLiterals()(type)).toBe(true)
    })
  })

  describe('isStringLiteral()', () => {
    it('matches single string literal type', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isStringLiteral()(type)).toBe(true)
    })

    it('matches specific string literal value', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isStringLiteral('created_at')(type)).toBe(true)
    })

    it('rejects wrong string literal value', () => {
      const type = getPropertyType('SingleLiteralOptions', 'sortBy')!
      expect(isStringLiteral('wrong')(type)).toBe(false)
    })

    it('does not match bare string', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(isStringLiteral()(type)).toBe(false)
    })

    it('does not match union of string literals', () => {
      const type = getPropertyType('SafeOptions', 'sortBy')!
      expect(isStringLiteral()(type)).toBe(false)
    })
  })

  describe('matching()', () => {
    it('matches type text against regex', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(matching(/^string$/)(type)).toBe(true)
    })

    it('rejects non-matching type text', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(matching(/^number$/)(type)).toBe(false)
    })
  })

  describe('exactly()', () => {
    it('matches exact type text', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(exactly('string')(type)).toBe(true)
    })

    it('rejects different type text', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(exactly('number')(type)).toBe(false)
    })
  })

  describe('arrayOf()', () => {
    // No array properties in current fixtures — test against programmatic types
    it('does not match non-array type', () => {
      const type = getPropertyType('UnsafeOptions', 'sortBy')!
      expect(arrayOf(isString())(type)).toBe(false)
    })
  })
})
```

### `tests/predicates/type.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project, Node } from 'ts-morph'
import path from 'node:path'
import {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
} from '../../src/predicates/type.js'
import { isString, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getInterface(name: string) {
  for (const sf of tsMorphProject.getSourceFiles()) {
    const iface = sf.getInterface(name)
    if (iface) return iface
  }
  throw new Error(`Interface ${name} not found`)
}

function getTypeAlias(name: string) {
  for (const sf of tsMorphProject.getSourceFiles()) {
    const alias = sf.getTypeAlias(name)
    if (alias) return alias
  }
  throw new Error(`Type alias ${name} not found`)
}

describe('type predicates', () => {
  describe('areInterfaces()', () => {
    it('matches InterfaceDeclaration', () => {
      expect(areInterfaces().test(getInterface('SafeOptions'))).toBe(true)
    })

    it('rejects TypeAliasDeclaration', () => {
      expect(areInterfaces().test(getTypeAlias('PartialStrictOptions'))).toBe(false)
    })
  })

  describe('areTypeAliases()', () => {
    it('matches TypeAliasDeclaration', () => {
      expect(areTypeAliases().test(getTypeAlias('PartialStrictOptions'))).toBe(true)
    })

    it('rejects InterfaceDeclaration', () => {
      expect(areTypeAliases().test(getInterface('SafeOptions'))).toBe(false)
    })
  })

  describe('haveProperty()', () => {
    it('matches interface with the property', () => {
      expect(haveProperty('sortBy').test(getInterface('SafeOptions'))).toBe(true)
    })

    it('rejects interface without the property', () => {
      expect(haveProperty('sortBy').test(getInterface('UnrelatedOptions'))).toBe(false)
    })

    it('matches type alias with the property (Partial<>)', () => {
      expect(haveProperty('sortBy').test(getTypeAlias('PartialStrictOptions'))).toBe(true)
    })

    it('matches type alias with the property (Pick<>)', () => {
      expect(haveProperty('sortBy').test(getTypeAlias('PickedOptions'))).toBe(true)
    })
  })

  describe('havePropertyOfType()', () => {
    it('matches when property type satisfies matcher', () => {
      expect(havePropertyOfType('sortBy', isString()).test(getInterface('UnsafeOptions'))).toBe(
        true,
      )
    })

    it('rejects when property type does not satisfy matcher', () => {
      expect(havePropertyOfType('sortBy', isString()).test(getInterface('SafeOptions'))).toBe(false)
    })

    it('rejects when property does not exist', () => {
      expect(havePropertyOfType('sortBy', isString()).test(getInterface('UnrelatedOptions'))).toBe(
        false,
      )
    })

    it('resolves through Partial<> for property type matching', () => {
      expect(
        havePropertyOfType('sortBy', isUnionOfLiterals()).test(
          getTypeAlias('PartialStrictOptions'),
        ),
      ).toBe(true)
    })
  })

  describe('extendType()', () => {
    // domain.ts does not have extending interfaces in current fixtures.
    // Test with interfaces from the fixture set.
    it('returns false for interface that does not extend', () => {
      expect(extendType('BaseConfig').test(getInterface('SafeOptions'))).toBe(false)
    })
  })
})
```

### `tests/conditions/type-level.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { havePropertyType } from '../../src/conditions/type-level.js'
import { isString, not, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

const sf = tsMorphProject.getSourceFileOrThrow('options.ts')

const context: ConditionContext = {
  rule: 'types that have property "sortBy" should have property "sortBy" with matching type',
}

describe('havePropertyType condition', () => {
  it('produces violation for bare string sortBy', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const unsafeOptions = sf.getInterfaceOrThrow('UnsafeOptions')
    const violations = condition.evaluate([unsafeOptions], context)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('UnsafeOptions')
    expect(violations[0]!.message).toContain('sortBy')
    expect(violations[0]!.message).toContain('string')
  })

  it('produces no violation for union of string literals', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const safeOptions = sf.getInterfaceOrThrow('SafeOptions')
    const violations = condition.evaluate([safeOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('produces no violation for aliased union (AliasedOptions)', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const aliasedOptions = sf.getInterfaceOrThrow('AliasedOptions')
    const violations = condition.evaluate([aliasedOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('produces no violation for Partial<StrictOptions>', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const partialOptions = sf.getTypeAliasOrThrow('PartialStrictOptions')
    const violations = condition.evaluate([partialOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('produces no violation for Pick<SafeOptions, "sortBy">', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const pickedOptions = sf.getTypeAliasOrThrow('PickedOptions')
    const violations = condition.evaluate([pickedOptions], context)
    expect(violations).toHaveLength(0)
  })

  it('skips elements without the named property', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const unrelated = sf.getInterfaceOrThrow('UnrelatedOptions')
    const violations = condition.evaluate([unrelated], context)
    expect(violations).toHaveLength(0)
  })

  it('works with isUnionOfLiterals matcher', () => {
    const condition = havePropertyType('sortBy', isUnionOfLiterals())
    const safeOptions = sf.getInterfaceOrThrow('SafeOptions')
    const unsafeOptions = sf.getInterfaceOrThrow('UnsafeOptions')
    const singleLiteral = sf.getInterfaceOrThrow('SingleLiteralOptions')

    expect(condition.evaluate([safeOptions], context)).toHaveLength(0)
    expect(condition.evaluate([unsafeOptions], context)).toHaveLength(1)
    expect(condition.evaluate([singleLiteral], context)).toHaveLength(1)
  })

  it('evaluates multiple elements at once', () => {
    const condition = havePropertyType('sortBy', not(isString()))
    const all = [
      sf.getInterfaceOrThrow('UnsafeOptions'),
      sf.getInterfaceOrThrow('SafeOptions'),
      sf.getInterfaceOrThrow('AliasedOptions'),
    ]
    const violations = condition.evaluate(all, context)
    // Only UnsafeOptions has bare string
    expect(violations).toHaveLength(1)
    expect(violations[0]!.element).toBe('UnsafeOptions')
  })
})
```

### `tests/integration/type-rules.test.ts`

End-to-end tests using the `types()` entry point with the full builder chain.

```typescript
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { types } from '../../src/builders/type-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { not, isString, isUnionOfLiterals } from '../../src/helpers/type-matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const p = project(tsconfigPath)

describe('types() integration', () => {
  it('enforces no bare string on sortBy property', () => {
    // This is THE motivating use case from cmless plan 0212
    expect(() => {
      types(p)
        .that()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .because('sortBy must be a union of string literals, not bare string')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes when all sortBy properties are unions of literals (filtered)', () => {
    expect(() => {
      types(p)
        .that()
        .haveProperty('sortBy')
        .and()
        .haveNameMatching(/^Safe|^Aliased|^Partial|^Picked|^SingleLiteral|^ExplicitUndefined/)
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
    }).not.toThrow()
  })

  it('filters to only interfaces', () => {
    expect(() => {
      types(p)
        .that()
        .areInterfaces()
        .and()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
    }).toThrow(ArchRuleError) // UnsafeOptions is an interface with bare string
  })

  it('filters to only type aliases', () => {
    expect(() => {
      types(p)
        .that()
        .areTypeAliases()
        .and()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
    }).not.toThrow() // all type aliases with sortBy use unions
  })

  it('violation message includes the type name and property', () => {
    try {
      types(p)
        .that()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations.some((v) => v.element === 'UnsafeOptions')).toBe(true)
      expect(archError.violations.some((v) => v.message.includes('sortBy'))).toBe(true)
    }
  })

  it('named selection reuses predicates across rules', () => {
    const sortByTypes = types(p).that().haveProperty('sortBy')

    // Rule 1: no bare string
    expect(() => {
      sortByTypes.should().havePropertyType('sortBy', not(isString())).check()
    }).toThrow(ArchRuleError)

    // Rule 2: same selection, different condition (just pass)
    // This verifies should() forks correctly
    expect(() => {
      sortByTypes.should().havePropertyType('direction', not(isString())).check()
    }).not.toThrow()
  })

  it('supports .because() in the full chain', () => {
    try {
      types(p)
        .that()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', not(isString()))
        .because('untyped sortBy allows invalid column names at runtime')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ArchRuleError).message).toContain(
        'untyped sortBy allows invalid column names at runtime',
      )
    }
  })

  it('works with isUnionOfLiterals matcher end-to-end', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/^Safe/)
        .and()
        .haveProperty('sortBy')
        .should()
        .havePropertyType('sortBy', isUnionOfLiterals())
        .check()
    }).not.toThrow()
  })
})
```

## Files Changed

| File                                   | Change                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/type-matchers.ts`         | New — `TypeMatcher` type alias and matcher functions (`not`, `isString`, `isNumber`, `isBoolean`, `isUnionOfLiterals`, `isStringLiteral`, `arrayOf`, `matching`, `exactly`) |
| `src/predicates/type.ts`               | New — `TypeDeclaration` type alias, type predicates (`areInterfaces`, `areTypeAliases`, `haveProperty`, `havePropertyOfType`, `extendType`)                                 |
| `src/conditions/type-level.ts`         | New — `havePropertyType` condition                                                                                                                                          |
| `src/builders/type-rule-builder.ts`    | New — `TypeRuleBuilder` extending `RuleBuilder<TypeDeclaration>`                                                                                                            |
| `src/builders/type-rule-builder.ts`    | New — `types()` entry function                                                                                                                                              |
| `src/index.ts`                         | Modified — export entry point, builder, predicates, conditions, matchers                                                                                                    |
| `tests/helpers/type-matchers.test.ts`  | New — 20 tests for type matchers                                                                                                                                            |
| `tests/predicates/type.test.ts`        | New — 11 tests for type predicates                                                                                                                                          |
| `tests/conditions/type-level.test.ts`  | New — 8 tests for `havePropertyType` condition                                                                                                                              |
| `tests/integration/type-rules.test.ts` | New — 8 tests for end-to-end `types()` rules                                                                                                                                |

## Test Inventory

| #   | Test                                                          | What it validates                           |
| --- | ------------------------------------------------------------- | ------------------------------------------- |
| 1   | `isString()` matches bare string type                         | Core matcher — UnsafeOptions.sortBy         |
| 2   | `isString()` rejects string literal union                     | Core matcher — SafeOptions.sortBy           |
| 3   | `isString()` rejects number type                              | Type discrimination                         |
| 4   | `isNumber()` matches bare number                              | Core matcher — UnrelatedOptions.limit       |
| 5   | `isNumber()` rejects string                                   | Type discrimination                         |
| 6   | `isBoolean()` rejects string                                  | Type discrimination                         |
| 7   | `not()` inverts a matcher                                     | Combinator — not(isString()) on bare string |
| 8   | `not()` passes when inner fails                               | Combinator — not(isString()) on union       |
| 9   | `isUnionOfLiterals()` matches string literal union            | Core matcher — SafeOptions                  |
| 10  | `isUnionOfLiterals()` rejects bare string                     | Core matcher — UnsafeOptions                |
| 11  | `isUnionOfLiterals()` rejects single literal                  | Edge case — SingleLiteralOptions            |
| 12  | `isUnionOfLiterals()` resolves through type alias             | AliasedOptions -> SortColumn                |
| 13  | `isUnionOfLiterals()` resolves through Partial<>              | PartialStrictOptions                        |
| 14  | `isUnionOfLiterals()` resolves through Pick<>                 | PickedOptions                               |
| 15  | `isUnionOfLiterals()` strips explicit undefined               | ExplicitUndefinedOptions                    |
| 16  | `isStringLiteral()` matches single literal                    | SingleLiteralOptions                        |
| 17  | `isStringLiteral('created_at')` matches specific value        | Value matching                              |
| 18  | `isStringLiteral('wrong')` rejects wrong value                | Value matching                              |
| 19  | `isStringLiteral()` rejects bare string                       | Type discrimination                         |
| 20  | `isStringLiteral()` rejects union                             | Type discrimination                         |
| 21  | `matching()` matches type text regex                          | Escape hatch — string text                  |
| 22  | `matching()` rejects non-matching                             | Escape hatch negative                       |
| 23  | `exactly()` matches exact type text                           | Exact match                                 |
| 24  | `exactly()` rejects different text                            | Exact match negative                        |
| 25  | `arrayOf()` rejects non-array                                 | Guard clause                                |
| 26  | `areInterfaces()` matches InterfaceDeclaration                | Type guard predicate                        |
| 27  | `areInterfaces()` rejects TypeAliasDeclaration                | Type guard predicate                        |
| 28  | `areTypeAliases()` matches TypeAliasDeclaration               | Type guard predicate                        |
| 29  | `areTypeAliases()` rejects InterfaceDeclaration               | Type guard predicate                        |
| 30  | `haveProperty()` matches interface with property              | Property existence                          |
| 31  | `haveProperty()` rejects interface without property           | Property existence negative                 |
| 32  | `haveProperty()` matches Partial<> type alias                 | Mapped type resolution                      |
| 33  | `haveProperty()` matches Pick<> type alias                    | Mapped type resolution                      |
| 34  | `havePropertyOfType()` matches when type satisfies matcher    | Property type predicate                     |
| 35  | `havePropertyOfType()` rejects when type doesn't satisfy      | Property type negative                      |
| 36  | `havePropertyOfType()` rejects when property missing          | Guard clause                                |
| 37  | `havePropertyOfType()` resolves through Partial<>             | Mapped type resolution                      |
| 38  | `havePropertyType` condition: violation for bare string       | Core condition — UnsafeOptions              |
| 39  | `havePropertyType` condition: no violation for union          | Core condition — SafeOptions                |
| 40  | `havePropertyType` condition: no violation for aliased union  | Type alias resolution                       |
| 41  | `havePropertyType` condition: no violation for Partial<>      | Mapped type resolution                      |
| 42  | `havePropertyType` condition: no violation for Pick<>         | Mapped type resolution                      |
| 43  | `havePropertyType` condition: skips elements without property | Guard behavior                              |
| 44  | `havePropertyType` condition: isUnionOfLiterals matcher       | Alternative matcher                         |
| 45  | `havePropertyType` condition: multiple elements at once       | Batch evaluation                            |
| 46  | Integration: enforces no bare string on sortBy                | End-to-end motivating use case              |
| 47  | Integration: passes when filtered to safe types               | Predicate + condition combo                 |
| 48  | Integration: filters to only interfaces                       | areInterfaces() predicate                   |
| 49  | Integration: filters to only type aliases                     | areTypeAliases() predicate                  |
| 50  | Integration: violation message includes type name             | Error reporting                             |
| 51  | Integration: named selection reuses predicates                | Fork semantics                              |
| 52  | Integration: .because() in full chain                         | Reason propagation                          |
| 53  | Integration: isUnionOfLiterals end-to-end                     | Alternative matcher E2E                     |

## Out of Scope

- **Enum declarations** — could be added to `TypeDeclaration` union later but enums have different semantics and rarely appear in architecture rules
- **Generic type parameter constraints** — e.g., "types with generic parameter extending X". Too niche for v1
- **Intersection type matchers** — e.g., `isIntersectionOf(...)`. Can be added as a matcher later
- **Deep property access** — e.g., `havePropertyType('config.nested.field', ...)`. Only top-level properties for now
- **Method signatures on interfaces** — covered by body analysis (plan 0011) and class entry point (plan 0008)
- **Custom TypeMatcher composition** — `and(matcher1, matcher2)` for matchers. Users can compose with plain functions: `(type) => matcher1(type) && matcher2(type)`
- **Declaration merging** — interfaces with the same name across files. ts-morph handles each declaration separately, which is correct for architecture rules
