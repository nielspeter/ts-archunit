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
export type PropertyBearingNode = InterfaceDeclaration | TypeAliasDeclaration | ClassDeclaration

/**
 * Extract property symbols from a property-bearing node.
 * Resolves through the type system (handles Partial<>, Pick<>, etc.).
 */
function getPropertySymbols(node: PropertyBearingNode): TsSymbol[] {
  return node.getType().getProperties()
}

/**
 * Check if a property symbol is readonly.
 *
 * Strategy:
 * 1. Check direct declarations — works for explicit `readonly` on
 *    interface properties and class properties.
 * 2. For mapped types like Readonly<T>, declarations point to the
 *    source type where isReadonly() returns false. Fall back to the
 *    TypeScript compiler's internal CheckFlags.Readonly (bit 3 = 8)
 *    on the symbol's links.
 *
 * Spike test confirmed: for Readonly<T>, Symbol.getDeclarations()
 * returns the inner type's declarations (not readonly), but
 * compilerSymbol.links.checkFlags has the Readonly bit set (8).
 */
function isPropertyReadonly(prop: TsSymbol): boolean {
  // Strategy 1: Check direct declarations for explicit `readonly` keyword.
  // Works for interface properties and class properties that are directly
  // declared with the readonly modifier.
  const decls = prop.getDeclarations()
  for (const d of decls) {
    if (Node.isPropertySignature(d) || Node.isPropertyDeclaration(d)) {
      if (d.isReadonly()) return true
    }
  }

  // Strategy 2: Check TS compiler's CheckFlags.Readonly (bit 3 = 8).
  // For mapped types like Readonly<T>, Symbol.getDeclarations() returns
  // the *original* type's declarations where isReadonly() is false,
  // but the compiler tracks the readonly modifier on the symbol itself.
  //
  // Spike results (ts-morph 27 / TS ~5.9):
  //   Readonly<{a: string}>.a → decl.isReadonly() = false, but
  //   compilerSymbol.links.checkFlags & 8 = 8 (readonly)
  //
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- JS interop boundary: accessing TS compiler internal checkFlags for Readonly<T> detection
  const links = (prop.compilerSymbol as unknown as Record<string, unknown>).links
  if (typeof links === 'object' && links !== null) {
    const flags = (links as Record<string, unknown>)['checkFlags']
    if (typeof flags === 'number' && (flags & 8) !== 0) {
      return true
    }
  }

  // Conservative: treat as mutable if neither strategy detected readonly.
  return false
}

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
 * types(p).that().resideInFolder('src/api')
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

/**
 * Assert all properties are readonly.
 *
 * Checks direct declarations for explicit `readonly` keyword, and
 * falls back to TypeScript compiler's CheckFlags for mapped types
 * like Readonly<T>.
 *
 * @example
 * types(p).that().resideInFolder('src/state')
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
