import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchCall } from '../models/arch-call.js'
import { getFunctionBody, findMatchesInNode } from '../helpers/body-traversal.js'

/**
 * Helper to create a violation from an ArchCall.
 */
function createCallViolation(
  archCall: ArchCall,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: archCall.getName() ?? '<call>',
    file: archCall.getSourceFile().getFilePath(),
    line: archCall.getStartLineNumber(),
    message,
    because: context.because,
  }
}

/**
 * The filtered call set must be empty --- no calls should match the predicates.
 */
export function notExist(): Condition<ArchCall> {
  return {
    description: 'not exist',
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      return elements.map((archCall) =>
        createCallViolation(
          archCall,
          `${archCall.getName() ?? '<call>'} should not exist`,
          context,
        ),
      )
    },
  }
}

/**
 * Assert that at least one callback argument contains a match.
 *
 * Searches all function-like arguments (ArrowFunction, FunctionExpression)
 * for a node matching the given ExpressionMatcher.
 */
export function haveCallbackContaining(matcher: ExpressionMatcher): Condition<ArchCall> {
  return {
    description: `have callback containing ${matcher.description}`,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const found = searchCallbacksFor(archCall, matcher)
        if (!found) {
          violations.push(
            createCallViolation(
              archCall,
              `${archCall.getName() ?? '<call>'} does not have a callback containing ${matcher.description}`,
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
 * Assert that NO callback argument contains a match.
 *
 * Produces one violation per matching node found in any callback.
 */
export function notHaveCallbackContaining(matcher: ExpressionMatcher): Condition<ArchCall> {
  return {
    description: `not have callback containing ${matcher.description}`,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        for (const arg of args) {
          const body = getFunctionBody(arg)
          if (!body) continue
          const matches = findMatchesInNode(body, matcher)
          for (const match of matches) {
            violations.push(
              createCallViolation(
                archCall,
                `${archCall.getName() ?? '<call>'} has callback containing ${matcher.description} at line ${String(match.getStartLineNumber())}`,
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
 * Search all callback arguments of a call for a matcher hit.
 */
function searchCallbacksFor(archCall: ArchCall, matcher: ExpressionMatcher): boolean {
  const args = archCall.getArguments()
  for (const arg of args) {
    const body = getFunctionBody(arg)
    if (!body) continue
    const matches = findMatchesInNode(body, matcher)
    if (matches.length > 0) return true
  }
  return false
}
