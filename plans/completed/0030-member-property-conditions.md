# Plan 0030: Member Property Conditions

## Status

- **State:** Done
- **Priority:** P2 — Common use case across all TypeScript projects; currently requires boilerplate `defineCondition`
- **Effort:** 1 day
- **Created:** 2026-03-27
- **Depends on:** 0010 (Type Entry Point), 0007 (Class Entry Point)

## Problem

Checking that interface/type/class properties meet naming, pattern, or quality rules requires a custom `defineCondition` with manual AST traversal. This is one of the most common architectural enforcement patterns across TypeScript projects:

```typescript
// From cmless: apps/api/tests/unit/architecture/code-standards.test.ts
const noForbiddenPaginationParams = defineCondition(
  'no forbidden pagination param names',
  (elements: any[], context: ConditionContext): ArchViolation[] => {
    const forbidden = ['offset', 'pageSize', 'page', 'size']
    const violations: ArchViolation[] = []
    for (const iface of elements) {
      const props = iface.getProperties?.() ?? []
      for (const prop of props) {
        const propName = String(prop.getName?.() ?? '')
        if (forbidden.includes(propName)) {
          violations.push(createViolation(prop, `...`, context))
        }
      }
    }
    return violations
  },
)
```

This pattern appears in many domains — not just pagination:

- **API design:** "No interface in `**/api/**` should have a property named `offset`, `pageSize`, `page`, `size`"
- **Domain modeling:** "All `*Config` types must have a `version` property"
- **Immutability:** "All types in `**/state/**` should have only readonly properties"
- **God object detection:** "No interface should have more than 15 properties"
- **Naming conventions:** "No property should match `/^(data|info|stuff|item)$/`"

## Design Decisions

### 1. New condition file: `src/conditions/members.ts`

These conditions span both types and classes, so they belong in a dedicated file rather than `class.ts` or `type-level.ts`.

**Type constraint:** Conditions are typed over `PropertyBearingNode = InterfaceDeclaration | TypeAliasDeclaration | ClassDeclaration` — NOT the broader `Node`. This gives a compile-time error if accidentally wired to a wrong builder (e.g., `FunctionRuleBuilder`), matching the approach in `type-level.ts` which uses `Condition<TypeDeclaration>`. The inline type alias avoids an import cycle with `predicates/type.ts` (same pattern as `type-level.ts`).

### 2. Property extraction via ts-morph type system

Use `element.getType().getProperties()` (returns `Symbol[]`) as the unified approach for all element types. This resolves through `Partial<>`, `Pick<>`, etc. naturally — matching the approach already used in `haveProperty()` predicate and `havePropertyType()` condition.

For readonly checking, we need the actual declarations: `symbol.getDeclarations()` returns the property signatures/declarations where `isReadonly()` can be checked. **Caveat:** For `Readonly<T>` mapped types, `Symbol.getDeclarations()` may return declarations from the _original_ type `T` where `isReadonly()` returns `false` — the readonly modifier lives on the mapped type wrapper, not on individual property nodes. See Phase 4 for the spike test strategy and fallback approach.

### 3. Builder method naming conventions

Follow the existing pattern precisely: `should` prefix is used **only** when a predicate with the same base name exists on the same builder.

- **TypeRuleBuilder:** No prefix on any condition method — `havePropertyNamed`, `notHavePropertyNamed`, etc. are all distinct from existing predicate `haveProperty(name)`.
- **ClassRuleBuilder:** `should` prefix only for methods that collide with predicates:
  - `shouldHavePropertyNamed` / `shouldNotHavePropertyNamed` — predicate `havePropertyNamed(name)` exists
  - `havePropertyMatching` / `notHavePropertyMatching` — **no** prefix (no predicate twin)
  - `haveOnlyReadonlyProperties` — **no** prefix (no predicate twin)
  - `maxProperties` — **no** prefix (no predicate twin)

  This avoids the awkward `.should().shouldHaveOnlyReadonlyProperties()` double-should and matches the existing pattern where `beExported()`, `notExist()`, `contain()`, `notContain()` have no `should` prefix.

### 4. Variadic name arguments

`havePropertyNamed(...names)` and `notHavePropertyNamed(...names)` accept multiple names as rest parameters. This matches the `notImportFrom(...globs)` pattern and avoids forcing users to chain multiple conditions for multi-name checks.

- `havePropertyNamed('skip', 'limit')` → asserts ALL listed properties exist (AND)
- `notHavePropertyNamed('offset', 'page')` → asserts NONE of the listed properties exist (NOR)

Both throw at rule-definition time if called with zero arguments — prevents silent no-op rules.

### 5. `maxProperties` as a condition, not a predicate

Existing metric predicates (`haveMoreMethodsThan`, `haveMoreLinesThan`) are used as filters in `.that()` + `.should().notExist()`. For property count, we add a direct **condition** `maxProperties(n)` — this gives clearer violation messages ("UserConfig has 23 properties, max allowed is 15") rather than generic "X should not exist". This mirrors how `maxCyclomaticComplexity`, `maxClassLines` work in standard rules.

## Phase 1: Property Extraction Helper

### `src/conditions/members.ts` — internal helper

```typescript
import {
  Node,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
  type ClassDeclaration,
  type Symbol as TsSymbol,
} from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementName } from '../core/violation.js'
import { elementCondition } from './helpers.js'

// Inline the union to avoid conditions → predicates import cycle
// (same pattern as type-level.ts)
type PropertyBearingNode = InterfaceDeclaration | TypeAliasDeclaration | ClassDeclaration

/**
 * Extract property symbols from a property-bearing node.
 * Resolves through the type system (handles Partial<>, Pick<>, etc.).
 */
function getPropertySymbols(node: PropertyBearingNode): TsSymbol[] {
  return node.getType().getProperties()
}
```

The `PropertyBearingNode` union gives compile-time safety — a `Condition<PropertyBearingNode>` cannot be assigned to a `Condition<ArchFunction>`. The helper uses `getType().getProperties()` which returns `Symbol[]` — each symbol has `.getName()`, `.getDeclarations()`, `.getTypeAtLocation()`. It naturally resolves through `Partial<>`, `Pick<>`, intersections, mapped types.

## Phase 2: Name-Based Conditions

### `src/conditions/members.ts` — name conditions

```typescript
/**
 * Assert that all named properties exist on the element.
 * Every name must be present — violation per missing name.
 *
 * @param names At least one property name required. Throws if called with zero arguments.
 *
 * @example
 * types(p).that().haveNameMatching(/Config$/)
 *   .should().havePropertyNamed('version', 'name')
 *   .check()
 */
export function havePropertyNamed(...names: string[]): Condition<PropertyBearingNode> {
  if (names.length === 0) {
    throw new Error('havePropertyNamed() requires at least one property name')
  }
  return {
    description: `have properties named ${names.map((n) => `"${n}"`).join(', ')}`,
    evaluate(elements: PropertyBearingNode[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        const props = getPropertySymbols(element)
        const propNames = new Set(props.map((p) => p.getName()))
        for (const name of names) {
          if (!propNames.has(name)) {
            violations.push(
              createViolation(
                element,
                `${getElementName(element)} is missing required property "${name}"`,
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
 * Assert that none of the named properties exist on the element.
 * Violation per element per forbidden name found.
 *
 * @param names At least one property name required. Throws if called with zero arguments.
 *
 * @example
 * types(p).that().resideInFolder('**/ api /**')
 *   .should().notHavePropertyNamed('offset', 'pageSize', 'page', 'size')
 *   .because('use skip/limit for pagination')
 *   .check()
 */
export function notHavePropertyNamed(...names: string[]): Condition<PropertyBearingNode> {
  if (names.length === 0) {
    throw new Error('notHavePropertyNamed() requires at least one property name')
  }
  const nameSet = new Set(names)
  return {
    description: `not have properties named ${names.map((n) => `"${n}"`).join(', ')}`,
    evaluate(elements: PropertyBearingNode[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        const props = getPropertySymbols(element)
        for (const prop of props) {
          if (nameSet.has(prop.getName())) {
            violations.push(
              createViolation(
                element,
                `${getElementName(element)} has forbidden property "${prop.getName()}"`,
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

## Phase 3: Pattern-Based Conditions

### `src/conditions/members.ts` — regex conditions

```typescript
/**
 * Assert at least one property name matches the regex.
 * Semantics: EXISTS — violation if *no* property name matches.
 *
 * Note: this checks for existence of at least one match, unlike
 * `havePropertyNamed(...names)` which requires ALL names to exist.
 *
 * @example
 * types(p).that().haveNameMatching(/Entity$/)
 *   .should().havePropertyMatching(/^id$/)
 *   .check()
 */
export function havePropertyMatching(pattern: RegExp): Condition<PropertyBearingNode> {
  return elementCondition<PropertyBearingNode>(
    `have a property matching ${String(pattern)}`,
    (element) => {
      // Clone regex to avoid /g flag statefulness across calls
      const re = new RegExp(pattern.source, pattern.flags)
      const props = getPropertySymbols(element)
      return props.some((p) => re.test(p.getName()))
    },
    (element) => `${getElementName(element)} has no property matching ${String(pattern)}`,
  )
}

/**
 * Assert no property name matches the regex.
 * Violation per matching property found.
 *
 * @example
 * types(p).should().notHavePropertyMatching(/^(data|info|stuff|item)$/).check()
 */
export function notHavePropertyMatching(pattern: RegExp): Condition<PropertyBearingNode> {
  return {
    description: `not have properties matching ${String(pattern)}`,
    evaluate(elements: PropertyBearingNode[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        // Clone regex to avoid /g flag statefulness across elements
        const re = new RegExp(pattern.source, pattern.flags)
        const props = getPropertySymbols(element)
        for (const prop of props) {
          if (re.test(prop.getName())) {
            violations.push(
              createViolation(
                element,
                `${getElementName(element)} has property "${prop.getName()}" matching ${String(pattern)}`,
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

## Phase 4: Quality Conditions

### `src/conditions/members.ts` — quality conditions

```typescript
/**
 * Assert all properties are readonly.
 * Primary approach: check declarations via Symbol.getDeclarations().
 * Fallback for Readonly<T> mapped types: see implementation note below.
 *
 * @example
 * types(p).that().resideInFolder('**/ state /**')
 *   .should().haveOnlyReadonlyProperties()
 *   .because('state objects must be immutable')
 *   .check()
 */
export function haveOnlyReadonlyProperties(): Condition<PropertyBearingNode> {
  return {
    description: 'have only readonly properties',
    evaluate(elements: PropertyBearingNode[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        const props = getPropertySymbols(element)
        for (const prop of props) {
          if (!isPropertyReadonly(prop)) {
            violations.push(
              createViolation(
                element,
                `${getElementName(element)} has mutable property "${prop.getName()}"`,
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
 * Check if a property symbol is readonly.
 *
 * Strategy:
 * 1. Check direct declarations — works for explicit `readonly` on
 *    interface properties and class properties.
 * 2. If no declarations have isReadonly() (e.g., Readonly<T> mapped types
 *    where declarations point to the original type), check the symbol's
 *    value declaration.
 *
 * ⚠️ SPIKE NEEDED: During implementation, write a spike test to verify
 * how ts-morph exposes Readonly<T> properties. If Symbol.getDeclarations()
 * returns the unwrapped declarations (without readonly), the fallback is
 * to check the TypeScript compiler's `CheckFlags.Readonly` on the symbol,
 * accessible via `(symbol.compilerSymbol as any).links?.checkFlags`.
 * Document the exact approach that works in a code comment.
 */
function isPropertyReadonly(prop: TsSymbol): boolean {
  const decls = prop.getDeclarations()
  for (const d of decls) {
    if (Node.isPropertySignature(d) || Node.isPropertyDeclaration(d)) {
      return d.isReadonly()
    }
  }
  // Fallback: for mapped types like Readonly<T>, declarations may point
  // to the source type. Check the value declaration as a last resort.
  const valueDecl = prop.getValueDeclaration()
  if (valueDecl) {
    if (Node.isPropertySignature(valueDecl) || Node.isPropertyDeclaration(valueDecl)) {
      return valueDecl.isReadonly()
    }
  }
  // If we reach here, the property is synthetic (mapped type with no
  // direct declaration). Conservative: treat as mutable.
  return false
}

/**
 * Assert property count does not exceed the maximum.
 * Detects god objects / oversized DTOs.
 *
 * @example
 * types(p).should().maxProperties(15)
 *   .because('large interfaces indicate a missing abstraction')
 *   .check()
 */
export function maxProperties(max: number): Condition<PropertyBearingNode> {
  return {
    description: `have at most ${String(max)} properties`,
    evaluate(elements: PropertyBearingNode[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        const count = getPropertySymbols(element).length
        if (count > max) {
          violations.push(
            createViolation(
              element,
              `${getElementName(element)} has ${String(count)} properties, max allowed is ${String(max)}`,
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

**`Readonly<T>` spike test required:** Before implementing `isPropertyReadonly`, write a quick ts-morph test:

```typescript
const project = new Project()
const sf = project.createSourceFile('test.ts', 'type X = Readonly<{ a: string }>')
const type = sf.getTypeAliasOrThrow('X').getType()
const prop = type.getPropertyOrThrow('a')
console.log(prop.getDeclarations().map((d) => d.getKindName()))
console.log(prop.getValueDeclaration()?.isReadonly?.())
```

If declarations point to the inner object literal (not readonly), the fallback is to check the TS compiler's internal `CheckFlags.Readonly` on the symbol, wrapped behind an ADR-005-compliant `eslint-disable` comment at this single interop boundary.

## Phase 5: Wire Into Builders

### `src/builders/type-rule-builder.ts` — add 6 condition methods

```typescript
import {
  havePropertyNamed as memberHavePropertyNamed,
  notHavePropertyNamed as memberNotHavePropertyNamed,
  havePropertyMatching as memberHavePropertyMatching,
  notHavePropertyMatching as memberNotHavePropertyMatching,
  haveOnlyReadonlyProperties as memberHaveOnlyReadonlyProperties,
  maxProperties as memberMaxProperties,
} from '../conditions/members.js'

// In TypeRuleBuilder class:

// --- Member property conditions ---

havePropertyNamed(...names: string[]): this {
  return this.addCondition(memberHavePropertyNamed(...names))
}

notHavePropertyNamed(...names: string[]): this {
  return this.addCondition(memberNotHavePropertyNamed(...names))
}

havePropertyMatching(pattern: RegExp): this {
  return this.addCondition(memberHavePropertyMatching(pattern))
}

notHavePropertyMatching(pattern: RegExp): this {
  return this.addCondition(memberNotHavePropertyMatching(pattern))
}

haveOnlyReadonlyProperties(): this {
  return this.addCondition(memberHaveOnlyReadonlyProperties())
}

maxProperties(max: number): this {
  return this.addCondition(memberMaxProperties(max))
}
```

### `src/builders/class-rule-builder.ts` — add 6 condition methods

```typescript
import {
  havePropertyNamed as memberHavePropertyNamed,
  notHavePropertyNamed as memberNotHavePropertyNamed,
  havePropertyMatching as memberHavePropertyMatching,
  notHavePropertyMatching as memberNotHavePropertyMatching,
  haveOnlyReadonlyProperties as memberHaveOnlyReadonlyProperties,
  maxProperties as memberMaxProperties,
} from '../conditions/members.js'

// In ClassRuleBuilder class:

// --- Member property condition methods ---

// "should" prefix: predicate havePropertyNamed(name) exists on this builder
shouldHavePropertyNamed(...names: string[]): this {
  return this.addCondition(memberHavePropertyNamed(...names))
}

shouldNotHavePropertyNamed(...names: string[]): this {
  return this.addCondition(memberNotHavePropertyNamed(...names))
}

// No "should" prefix: no predicate collision (matches beExported, notExist, contain pattern)
havePropertyMatching(pattern: RegExp): this {
  return this.addCondition(memberHavePropertyMatching(pattern))
}

notHavePropertyMatching(pattern: RegExp): this {
  return this.addCondition(memberNotHavePropertyMatching(pattern))
}

haveOnlyReadonlyProperties(): this {
  return this.addCondition(memberHaveOnlyReadonlyProperties())
}

maxProperties(max: number): this {
  return this.addCondition(memberMaxProperties(max))
}
```

## Phase 6: Fixtures

### `tests/fixtures/poc/src/members.ts` — new fixture

```typescript
// --- Name checking fixtures ---

export interface PaginationBad {
  offset: number
  pageSize: number
  filter?: string
}

export interface PaginationGood {
  skip: number
  limit: number
  filter?: string
}

export interface ConfigComplete {
  version: string
  name: string
  debug: boolean
}

export interface ConfigMissingVersion {
  name: string
  debug: boolean
}

// --- Pattern checking fixtures ---

export interface HasIdField {
  id: string
  name: string
}

export interface MissingIdField {
  name: string
  email: string
}

export interface BadPropertyNames {
  data: unknown
  info: string
  stuff: number[]
}

// --- Readonly fixtures ---

export interface FullyReadonly {
  readonly id: string
  readonly name: string
}

export interface PartiallyReadonly {
  readonly id: string
  name: string // mutable
}

export interface AllMutable {
  id: string
  name: string
}

// --- Property count fixtures ---

export interface SmallInterface {
  a: string
  b: number
}

export interface LargeInterface {
  a: string
  b: number
  c: boolean
  d: string
  e: number
  f: boolean
  g: string
  h: number
  i: boolean
  j: string
  k: number
}

// --- Type alias fixtures ---

export type ReadonlyConfig = Readonly<{
  host: string
  port: number
}>

export type MutableConfig = {
  host: string
  port: number
}

// --- Class fixtures ---

export class ReadonlyClass {
  readonly id: string = ''
  readonly name: string = ''
}

export class MutableClass {
  id: string = ''
  name: string = ''
}

export class ClassWithForbiddenProp {
  offset: number = 0
  filter: string = ''
}
```

## Phase 7: Exports

### `src/index.ts` — add exports

```typescript
// Member property conditions (plan 0030)
export {
  havePropertyNamed as conditionHavePropertyNamed,
  notHavePropertyNamed as conditionNotHavePropertyNamed,
  havePropertyMatching as conditionHavePropertyMatching,
  notHavePropertyMatching as conditionNotHavePropertyMatching,
  haveOnlyReadonlyProperties,
  maxProperties,
} from './conditions/members.js'

// Re-export the PropertyBearingNode type for custom condition authors
export type { PropertyBearingNode } from './conditions/members.js'
```

**Note:** Name-based and pattern-based conditions use the `condition` prefix consistently — matching existing convention (`conditionResideInFile`, `conditionNotImportFrom`, `conditionHaveNameMatching`). Quality conditions (`haveOnlyReadonlyProperties`, `maxProperties`) have no predicate collisions, so no prefix needed.

## Files Changed

| File                                   | Change                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `src/conditions/members.ts`            | **New** — 6 condition factories + property extraction helper                   |
| `src/builders/type-rule-builder.ts`    | Modified — add 6 condition methods                                             |
| `src/builders/class-rule-builder.ts`   | Modified — add 6 condition methods                                             |
| `src/index.ts`                         | Modified — export 6 new conditions                                             |
| `tests/fixtures/poc/src/members.ts`    | **New** — interfaces, type aliases, and classes with various property patterns |
| `tests/conditions/members.test.ts`     | **New** — unit tests for all 6 conditions                                      |
| `tests/integration/type-rules.test.ts` | Modified — add integration tests for full fluent chains                        |

## Test Inventory

### `tests/conditions/members.test.ts` — unit tests

**havePropertyNamed:**

1. **passes when all named properties exist** — `ConfigComplete` has `version` and `name`
2. **reports violation for each missing property** — `ConfigMissingVersion` missing `version`
3. **works with single name** — `PaginationGood` has `skip`
4. **works with type aliases** — `ReadonlyConfig` has `host` and `port`
5. **throws on zero arguments** — `havePropertyNamed()` throws at definition time

**notHavePropertyNamed:** 6. **passes when none of the forbidden names exist** — `PaginationGood` has no `offset`/`pageSize` 7. **reports violation per forbidden property found** — `PaginationBad` has `offset` and `pageSize` 8. **works on classes** — `ClassWithForbiddenProp` has `offset` 9. **throws on zero arguments** — `notHavePropertyNamed()` throws at definition time

**havePropertyMatching:** 10. **passes when at least one property matches** — `HasIdField` matches `/^id$/` 11. **reports violation when no property matches** — `MissingIdField` no property matching `/^id$/` 12. **safe with /g flag regex** — no statefulness across elements

**notHavePropertyMatching:** 13. **passes when no property matches** — `PaginationGood` no match for `/^(data|info|stuff)$/` 14. **reports violation per matching property** — `BadPropertyNames` has `data`, `info`, `stuff`

**haveOnlyReadonlyProperties:** 15. **passes for fully readonly interface** — `FullyReadonly` 16. **reports violation for mutable properties** — `PartiallyReadonly` → `name` is mutable 17. **reports all mutable properties** — `AllMutable` → `id` and `name` both mutable 18. **passes for `Readonly<>` type alias** — `ReadonlyConfig` (spike sentinel — see Phase 4) 19. **reports violation for mutable type alias** — `MutableConfig` 20. **works on readonly class** — `ReadonlyClass` passes 21. **reports violation for mutable class** — `MutableClass` fails

**maxProperties:** 22. **passes when count is within limit** — `SmallInterface` (2) ≤ 5 23. **reports violation when count exceeds limit** — `LargeInterface` (11) > 5 24. **violation message includes actual count and limit** — verify "has 11 properties, max allowed is 5"

### `tests/integration/type-rules.test.ts` — integration tests

Full fluent chains proving end-to-end wiring through the builders:

25. **types(p).that().resideInFolder(...).should().notHavePropertyNamed('offset', 'pageSize', 'page', 'size').check()** — the cmless pagination rule from bug 0002
26. **types(p).that().haveNameMatching(/Config$/).should().havePropertyNamed('version').check()** — required property enforcement
27. **types(p).should().maxProperties(5).check()** — god object detection (LargeInterface fails)
28. **types(p).that().areInterfaces().should().haveOnlyReadonlyProperties().check()** — immutability enforcement
29. **types(p).should().notHavePropertyMatching(/^(data|info|stuff)$/).check()** — naming convention enforcement
30. **types(p).that().haveProperty('skip').should().havePropertyNamed('limit').check()** — predicate + condition combo (filter to types with `skip`, assert they also have `limit`)

### `tests/integration/class-rules.test.ts` — class integration tests

31. **classes(p).should().shouldNotHavePropertyNamed('offset').check()** — forbidden property on class
32. **classes(p).should().haveOnlyReadonlyProperties().check()** — readonly enforcement on classes (no double-should)
33. **classes(p).should().maxProperties(10).check()** — property count on classes

## Broader Context

This plan is part of a larger gap in ts-archunit: **member inspection conditions**. Users can filter elements by shape (predicates), but have limited ability to assert on shape (conditions). The asks keep surfacing from the same root:

- **Bug 0002** (property names) → this plan
- **Bug 0003** (parameter types — `notAcceptParameterOfType('Knex')`) → plan 0031
- Future: property type conditions on classes, method return type conditions, etc.

These are separate plans because they touch different ts-morph APIs and serve different user motivations (type shape vs DI boundaries), but they form a cohesive capability layer. Plan 0031 should share the fixture file and follow the same patterns established here.

## Out of Scope

- **Parameter type conditions** (`acceptParameterOfType` / `notAcceptParameterOfType`) — Planned as 0031 (bug 0003). Different ts-morph API surface (constructor/method parameters vs type properties).
- **`haveOnlyOptionalProperties()` / `haveOnlyRequiredProperties()`** — Less common than readonly enforcement. Users can use `defineCondition` or we add later if demand appears.
- **Property-level type conditions on classes** — `havePropertyType(name, matcher)` already exists for types. Extending to classes is a separate concern.
- **Property accessor conditions** — Checking getters/setters vs direct properties. Niche.
- **Standard rules using these conditions** — Could add `noGodInterfaces(threshold)` to `src/rules/metrics.ts`. Defer to a follow-up since standard rules are a separate concern.
- **Intersection / mapped type edge cases** — `getType().getProperties()` already handles most compositions. If exotic mapped types cause issues, we fix as bugs.
