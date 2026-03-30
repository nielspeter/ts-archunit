import { Node } from 'ts-morph'
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

/**
 * Collect property names from an ObjectLiteralExpression node.
 *
 * Handles both PropertyAssignment (`{ schema: {} }`) and
 * ShorthandPropertyAssignment (`{ schema }`).
 */
function getObjectLiteralPropertyNames(node: Node): Set<string> {
  const names = new Set<string>()
  if (!Node.isObjectLiteralExpression(node)) return names
  for (const prop of node.getProperties()) {
    if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
      names.add(prop.getName())
    }
  }
  return names
}

/**
 * Assert that at least one object literal argument has ALL named properties.
 *
 * Scans all arguments of each call for ObjectLiteralExpression nodes.
 * Passes if at least one object literal argument contains every
 * specified property name.
 *
 * @throws {Error} if called with zero property names
 */
export function haveArgumentWithProperty(...names: string[]): Condition<ArchCall> {
  if (names.length === 0) {
    throw new Error('haveArgumentWithProperty requires at least one property name')
  }
  const quotedNames = names.map((n) => `"${n}"`).join(', ')
  const description =
    names.length === 1
      ? `have argument with property "${names[0]!}"`
      : `have argument with properties ${quotedNames}`

  return {
    description,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        let found = false
        for (const arg of args) {
          const propNames = getObjectLiteralPropertyNames(arg)
          if (propNames.size > 0 && names.every((name) => propNames.has(name))) {
            found = true
            break
          }
        }
        if (!found) {
          const callName = archCall.getName() ?? '<call>'
          violations.push(
            createCallViolation(
              archCall,
              `${callName} has no argument with properties ${quotedNames}`,
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
 * Assert that NO object literal argument has ANY of the named properties.
 *
 * Scans all arguments of each call for ObjectLiteralExpression nodes.
 * Reports one violation per forbidden property found in any argument.
 *
 * @throws {Error} if called with zero property names
 */
export function notHaveArgumentWithProperty(...names: string[]): Condition<ArchCall> {
  if (names.length === 0) {
    throw new Error('notHaveArgumentWithProperty requires at least one property name')
  }
  const quotedNames = names.map((n) => `"${n}"`).join(', ')
  const description =
    names.length === 1
      ? `not have argument with property "${names[0]!}"`
      : `not have argument with properties ${quotedNames}`

  return {
    description,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        for (const arg of args) {
          const propNames = getObjectLiteralPropertyNames(arg)
          for (const name of names) {
            if (propNames.has(name)) {
              violations.push(
                createCallViolation(
                  archCall,
                  `${archCall.getName() ?? '<call>'} argument has forbidden property "${name}"`,
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

/**
 * Assert that at least one argument subtree contains a match.
 *
 * Searches ALL arguments of each call recursively using `findMatchesInNode`.
 * This is a superset of `haveCallbackContaining` — it searches the entire
 * subtree of every argument (object literals, callbacks, nested expressions),
 * not just function-like arguments. Use `haveCallbackContaining` when you
 * only want to search callback bodies.
 */
export function haveArgumentContaining(matcher: ExpressionMatcher): Condition<ArchCall> {
  return {
    description: `have argument containing ${matcher.description}`,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        let found = false
        for (const arg of args) {
          const matches = findMatchesInNode(arg, matcher)
          if (matches.length > 0) {
            found = true
            break
          }
        }
        if (!found) {
          violations.push(
            createCallViolation(
              archCall,
              `${archCall.getName() ?? '<call>'} has no argument containing ${matcher.description}`,
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
 * Assert that NO argument subtree contains a match.
 *
 * Searches ALL arguments of each call recursively using `findMatchesInNode`.
 * Produces one violation per matching node found in any argument.
 *
 * This is a superset of `notHaveCallbackContaining` — it searches the entire
 * subtree of every argument (object literals, callbacks, nested expressions),
 * not just function-like arguments. Use `notHaveCallbackContaining` when you
 * only want to search callback bodies.
 */
export function notHaveArgumentContaining(matcher: ExpressionMatcher): Condition<ArchCall> {
  return {
    description: `not have argument containing ${matcher.description}`,
    evaluate(elements: ArchCall[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const archCall of elements) {
        const args = archCall.getArguments()
        for (const arg of args) {
          const matches = findMatchesInNode(arg, matcher)
          for (const match of matches) {
            violations.push(
              createCallViolation(
                archCall,
                `${archCall.getName() ?? '<call>'} argument contains ${matcher.description} at line ${String(match.getStartLineNumber())}`,
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
