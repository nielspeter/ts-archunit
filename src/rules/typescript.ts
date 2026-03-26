import { Node, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * Class properties must not be typed as `any`.
 *
 * Detects both explicit `any` and untyped properties that resolve to `any`.
 * Use `unknown` with type narrowing instead.
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
                `${cls.getName() ?? '<anonymous>'}.${prop.getName()} is typed as 'any' — use a specific type or 'unknown'`,
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
 * Method bodies must not contain `as` type assertions.
 *
 * Allows `as const` (narrows types, doesn't widen).
 * Use type guards or explicit type annotations instead.
 *
 * @example
 * classes(p).that().haveNameEndingWith('Service')
 *   .should().satisfy(noTypeAssertions())
 *   .check()
 */
export function noTypeAssertions(): Condition<ClassDeclaration> {
  return {
    description: 'have no type assertions (as) in method bodies',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue
          for (const asExpr of body.getDescendantsOfKind(SyntaxKind.AsExpression)) {
            const typeNode = asExpr.getTypeNode()
            if (typeNode && Node.isTypeReference(typeNode) && typeNode.getText() === 'const') {
              continue
            }
            violations.push(
              createViolation(
                asExpr,
                `${cls.getName() ?? '<anonymous>'}.${method.getName()} uses type assertion — use type guards instead`,
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
 * Method bodies must not contain non-null assertions (`!`).
 *
 * Handle null/undefined explicitly instead of asserting it away.
 *
 * @example
 * classes(p).that().resideInFolder('** /domain/** ')
 *   .should().satisfy(noNonNullAssertions())
 *   .check()
 */
export function noNonNullAssertions(): Condition<ClassDeclaration> {
  return {
    description: 'have no non-null assertions (!) in method bodies',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue
          for (const expr of body.getDescendantsOfKind(SyntaxKind.NonNullExpression)) {
            violations.push(
              createViolation(
                expr,
                `${cls.getName() ?? '<anonymous>'}.${method.getName()} uses non-null assertion — handle the null case explicitly`,
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
