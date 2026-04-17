import type { ClassDeclaration, SourceFile } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementName } from '../core/violation.js'
import type { ArchFunction } from '../models/arch-function.js'
import { typeAssertion, nonNullAssertion } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { moduleNotContain } from '../conditions/body-analysis-module.js'

/**
 * Class properties must not be typed as `any`.
 *
 * Detects both explicit `any` and untyped properties that resolve to `any`.
 * Use `unknown` with type narrowing instead.
 *
 * Uses custom `evaluate()` — inspects type resolution via `getType().getText()`,
 * not AST nodes. Not expressible via the `ExpressionMatcher` pattern used by
 * the other rules in this file.
 *
 * @example
 * classes(p).that().resideInFolder('** /src/** ')
 *   .should().satisfy(noAnyProperties())
 *   .because('any bypasses the type checker')
 *   .check()
 */
export function noAnyProperties(): Condition<ClassDeclaration> {
  return {
    description: 'have no properties typed as any',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const prop of cls.getProperties()) {
          if (prop.getType().getText() === 'any') {
            violations.push(
              createViolation(
                prop,
                `${getElementName(cls)}.${prop.getName()} is typed as 'any' — use a specific type or 'unknown'`,
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

// ─── Class variants ──────────────────────────────────────────────

/**
 * Class bodies must not contain `as` type assertions.
 * Allows `as const` (narrows types, doesn't widen).
 * Scans methods, constructors, getters, and setters.
 *
 * @example
 * classes(p).that().haveNameEndingWith('Service')
 *   .should().satisfy(noTypeAssertions())
 *   .check()
 */
export function noTypeAssertions(): Condition<ClassDeclaration> {
  return classNotContain(typeAssertion())
}

/**
 * Class bodies must not contain non-null assertions (`!`).
 * Handle null/undefined explicitly instead of asserting it away.
 * Scans methods, constructors, getters, and setters.
 *
 * @example
 * classes(p).that().resideInFolder('** /domain/** ')
 *   .should().satisfy(noNonNullAssertions())
 *   .check()
 */
export function noNonNullAssertions(): Condition<ClassDeclaration> {
  return classNotContain(nonNullAssertion())
}

// ─── Function variants ───────────────────────────────────────────

/**
 * Function bodies must not contain `as` type assertions (allows `as const`).
 * Use type guards or explicit type annotations instead.
 *
 * @example
 * functions(p).that().resideInFolder('** /src/** ')
 *   .should().satisfy(functionNoTypeAssertions())
 *   .check()
 */
export function functionNoTypeAssertions(): Condition<ArchFunction> {
  return functionNotContain(typeAssertion())
}

/**
 * Function bodies must not contain non-null assertions (`!`).
 * Handle null/undefined explicitly instead of asserting it away.
 */
export function functionNoNonNullAssertions(): Condition<ArchFunction> {
  return functionNotContain(nonNullAssertion())
}

// ─── Module variants ─────────────────────────────────────────────

/**
 * Source file must not contain any `as` type assertions (allows `as const`).
 * Broader than the function/class variants — catches top-level code,
 * class methods, functions, arrow functions, and any other expressions.
 *
 * @example
 * modules(p).that().resideInFolder('** /src/** ')
 *   .should().satisfy(moduleNoTypeAssertions())
 *   .check()
 */
export function moduleNoTypeAssertions(): Condition<SourceFile> {
  return moduleNotContain(typeAssertion())
}

/**
 * Source file must not contain any `!` non-null assertions.
 */
export function moduleNoNonNullAssertions(): Condition<SourceFile> {
  return moduleNotContain(nonNullAssertion())
}
