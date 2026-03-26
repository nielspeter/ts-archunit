import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Helper to create a per-element condition for ArchFunction.
 */
function functionCondition(
  description: string,
  predicate: (fn: ArchFunction) => boolean,
  messageFn: (fn: ArchFunction) => string,
): Condition<ArchFunction> {
  return {
    description,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        if (!predicate(fn)) {
          violations.push({
            rule: context.rule,
            element: fn.getName() ?? '<anonymous>',
            file: fn.getSourceFile().getFilePath(),
            line: fn.getStartLineNumber(),
            message: messageFn(fn),
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * The predicate set must be empty — no functions should match.
 *
 * If ANY functions exist after predicate filtering, each one
 * becomes a violation.
 *
 * @example
 * functions(project)
 *   .that().haveNameMatching(/^parse\w+Order$/)
 *   .should(notExist())
 *   .because('use shared parseOrder() utility instead')
 */
export function notExist(): Condition<ArchFunction> {
  return {
    description: 'not exist',
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      return elements.map((fn) => ({
        rule: context.rule,
        element: fn.getName() ?? '<anonymous>',
        file: fn.getSourceFile().getFilePath(),
        line: fn.getStartLineNumber(),
        message: `${fn.getName() ?? '<anonymous>'} should not exist`,
        because: context.because,
      }))
    },
  }
}

/**
 * Functions must be exported from their module.
 */
export function beExported(): Condition<ArchFunction> {
  return functionCondition(
    'be exported',
    (fn) => fn.isExported(),
    (fn) => `${fn.getName() ?? '<anonymous>'} is not exported`,
  )
}

/**
 * Functions must be async.
 */
export function beAsync(): Condition<ArchFunction> {
  return functionCondition(
    'be async',
    (fn) => fn.isAsync(),
    (fn) => `${fn.getName() ?? '<anonymous>'} is not async`,
  )
}

/**
 * Functions must have a name matching the given pattern.
 */
export function haveNameMatching(pattern: RegExp): Condition<ArchFunction> {
  return functionCondition(
    `have name matching ${String(pattern)}`,
    (fn) => {
      const name = fn.getName()
      return name !== undefined && pattern.test(name)
    },
    (fn) => `${fn.getName() ?? '<anonymous>'} does not have a name matching ${String(pattern)}`,
  )
}
