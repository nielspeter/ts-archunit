import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchFunction } from '../models/arch-function.js'
import { searchFunctionBody } from '../helpers/body-traversal.js'

/**
 * Create an ArchViolation from an ArchFunction (not a Node).
 *
 * ArchFunction is not a Node, so we can't use createViolation directly.
 * This helper bridges the gap.
 */
function createFunctionViolation(
  fn: ArchFunction,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: fn.getName() ?? '<anonymous>',
    file: fn.getSourceFile().getFilePath(),
    line: fn.getStartLineNumber(),
    message,
    because: context.because,
  }
}

/**
 * Function body must contain at least one node matching the matcher.
 */
export function functionContain(matcher: ExpressionMatcher): Condition<ArchFunction> {
  return {
    description: `contain ${matcher.description}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const result = searchFunctionBody(fn, matcher)
        if (!result.found) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} does not contain ${matcher.description}`,
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
 * Function body must NOT contain any node matching the matcher.
 */
export function functionNotContain(
  matcher: ExpressionMatcher,
): Condition<ArchFunction> {
  return {
    description: `not contain ${matcher.description}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const result = searchFunctionBody(fn, matcher)
        for (const node of result.matchingNodes) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} contains ${matcher.description} at line ${String(node.getStartLineNumber())}`,
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
 * Function body must use the 'good' pattern instead of the 'bad' pattern.
 */
export function functionUseInsteadOf(
  bad: ExpressionMatcher,
  good: ExpressionMatcher,
): Condition<ArchFunction> {
  return {
    description: `use ${good.description} instead of ${bad.description}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const badResult = searchFunctionBody(fn, bad)
        const goodResult = searchFunctionBody(fn, good)

        for (const node of badResult.matchingNodes) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} contains ${bad.description} at line ${String(node.getStartLineNumber())} — use ${good.description} instead`,
              context,
            ),
          )
        }

        if (!goodResult.found) {
          violations.push(
            createFunctionViolation(
              fn,
              `${fn.getName() ?? '<anonymous>'} does not contain ${good.description}`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}
