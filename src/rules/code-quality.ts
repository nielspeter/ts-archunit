import { SyntaxKind } from 'ts-morph'
import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * All public methods must have JSDoc comments.
 *
 * Methods with no explicit scope or scope 'public' are checked.
 * Private and protected methods are skipped.
 *
 * @example
 * import { requireJsDocOnPublicMethods } from 'ts-archunit/rules/code-quality'
 *
 * classes(p).that().areExported()
 *   .should().satisfy(requireJsDocOnPublicMethods())
 *   .because('public API must be documented')
 *   .check()
 */
export function requireJsDocOnPublicMethods(): Condition<ClassDeclaration> {
  return {
    description: 'have JSDoc on all public methods',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const scope = method.getScope()
          const isPublic = scope === undefined || String(scope) === 'public'
          if (isPublic && method.getJsDocs().length === 0) {
            violations.push(
              createViolation(
                method,
                `${cls.getName() ?? '<anonymous>'}.${method.getName()} is public but has no JSDoc`,
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
 * Classes must not have public non-static mutable fields.
 *
 * Static readonly fields (constants) are allowed.
 * Use private fields with getters/setters instead.
 *
 * @example
 * ```typescript
 * import { noPublicFields } from 'ts-archunit/rules/code-quality'
 *
 * classes(p).that().resideInFolder('src/domain/')
 *   .should().satisfy(noPublicFields())
 *   .because('encapsulate state behind methods')
 *   .check()
 * ```
 */
export function noPublicFields(): Condition<ClassDeclaration> {
  return {
    description: 'have no public mutable fields',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const prop of cls.getProperties()) {
          const scope = prop.getScope()
          if (scope !== undefined && String(scope) !== 'public') continue
          // Allow static readonly (constants)
          if (prop.isStatic() && prop.isReadonly()) continue

          violations.push(
            createViolation(
              prop,
              `${cls.getName() ?? '<anonymous>'}.${prop.getName()} is a public field — use private + getter/setter`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}

/**
 * Method bodies must not contain magic numbers.
 *
 * Numbers 0, 1, -1, 2, 10, 100 are allowed by default.
 * Configure with options.allowed to customize.
 *
 * @example
 * import { noMagicNumbers } from 'ts-archunit/rules/code-quality'
 *
 * classes(p).that().haveNameEndingWith('Service')
 *   .should().satisfy(noMagicNumbers())
 *   .because('extract constants for readability')
 *   .warn()
 *
 * // Custom allowed list
 * classes(p).should().satisfy(noMagicNumbers({ allowed: [0, 1, -1, 200, 404] })).warn()
 */
export function noMagicNumbers(options?: { allowed?: number[] }): Condition<ClassDeclaration> {
  const allowedSet = new Set(options?.allowed ?? [0, 1, -1, 2, 10, 100])

  return {
    description: 'have no magic numbers in method bodies',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue

          const literals = body.getDescendantsOfKind(SyntaxKind.NumericLiteral)
          for (const lit of literals) {
            const value = Number(lit.getText())
            if (!allowedSet.has(value)) {
              violations.push(
                createViolation(
                  lit,
                  `${cls.getName() ?? '<anonymous>'}.${method.getName()} contains magic number ${String(value)} — extract to a named constant`,
                  context,
                ),
              )
            }
          }
        }
      }
      return violations
    },
  }
}
