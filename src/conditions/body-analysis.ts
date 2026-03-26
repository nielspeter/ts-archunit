import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementName } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import { searchClassBody } from '../helpers/body-traversal.js'

// ─── Class body conditions ──────────────────────────────────────────

/**
 * Class body must contain at least one node matching the matcher.
 *
 * Violation if NO method in the class contains a match.
 */
export function classContain(matcher: ExpressionMatcher): Condition<ClassDeclaration> {
  return {
    description: `contain ${matcher.description}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const result = searchClassBody(cls, matcher)
        if (!result.found) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} does not contain ${matcher.description}`,
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
 * Class body must NOT contain any node matching the matcher.
 *
 * Violation for EACH matching node found in any method.
 * Reports the specific line where the violation occurs.
 */
export function classNotContain(matcher: ExpressionMatcher): Condition<ClassDeclaration> {
  return {
    description: `not contain ${matcher.description}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const result = searchClassBody(cls, matcher)
        for (const node of result.matchingNodes) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} contains ${matcher.description} at line ${String(node.getStartLineNumber())}`,
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
 * Class body must use the 'good' pattern instead of the 'bad' pattern.
 *
 * Combines notContain(bad) and contain(good) into a single condition
 * with better violation messages.
 *
 * Two types of violations:
 * 1. Class contains the 'bad' pattern — "use X instead of Y at line N"
 * 2. Class does not contain the 'good' pattern — "expected X but not found"
 */
export function classUseInsteadOf(
  bad: ExpressionMatcher,
  good: ExpressionMatcher,
): Condition<ClassDeclaration> {
  return {
    description: `use ${good.description} instead of ${bad.description}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const badResult = searchClassBody(cls, bad)
        const goodResult = searchClassBody(cls, good)

        // Report each occurrence of the bad pattern
        for (const node of badResult.matchingNodes) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} contains ${bad.description} at line ${String(node.getStartLineNumber())} — use ${good.description} instead`,
              context,
            ),
          )
        }

        // If the good pattern is missing entirely, report that too
        if (!goodResult.found) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} does not contain ${good.description}`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}
