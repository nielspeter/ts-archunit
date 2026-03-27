import type { ArchFunction } from '../models/arch-function.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import { cyclomaticComplexity, linesOfCode } from '../helpers/complexity.js'

/**
 * Function must not exceed the given cyclomatic complexity.
 *
 * Uses fn.getBody() which returns the body Node for all function
 * kinds (declarations, arrow functions, methods).
 *
 * @example
 * ```ts
 * import { maxFunctionComplexity } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * functions(p).that().resideInFolder('src/**')
 *   .should().satisfy(maxFunctionComplexity(15))
 *   .check()
 * ```
 */
export function maxFunctionComplexity(threshold: number): Condition<ArchFunction> {
  return {
    description: `have cyclomatic complexity <= ${String(threshold)}`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const cc = cyclomaticComplexity(fn.getBody())
        if (cc > threshold) {
          violations.push(
            createViolation(
              fn.getNode(),
              `${fn.getName() ?? '<anonymous>'} has cyclomatic complexity ${String(cc)} (max: ${String(threshold)})`,
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
 * Function must not exceed the given number of lines (span lines).
 *
 * @example
 * ```ts
 * import { maxFunctionLines } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * functions(p).should().satisfy(maxFunctionLines(40)).warn()
 * ```
 */
export function maxFunctionLines(threshold: number): Condition<ArchFunction> {
  return {
    description: `have no more than ${String(threshold)} lines`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const loc = linesOfCode(fn.getNode())
        if (loc > threshold) {
          violations.push(
            createViolation(
              fn.getNode(),
              `${fn.getName() ?? '<anonymous>'} has ${String(loc)} lines (max: ${String(threshold)})`,
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
 * Function must not have more than the given number of parameters.
 *
 * Uses fn.getParameters() from the ArchFunction interface.
 *
 * @example
 * ```ts
 * import { maxFunctionParameters } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * functions(p).that().areExported()
 *   .should().satisfy(maxFunctionParameters(4))
 *   .check()
 * ```
 */
export function maxFunctionParameters(threshold: number): Condition<ArchFunction> {
  return {
    description: `have no more than ${String(threshold)} parameters`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const params = fn.getParameters().length
        if (params > threshold) {
          violations.push(
            createViolation(
              fn.getNode(),
              `${fn.getName() ?? '<anonymous>'} has ${String(params)} parameters (max: ${String(threshold)}) — use an options object`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}
