import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * Class name must match a regex pattern.
 *
 * This is the condition version of the `haveNameMatching` predicate.
 * Use when you want to assert naming, not filter by it.
 *
 * @example
 * classes(p).that().resideInFolder('** /controllers/** ')
 *   .should().satisfy(mustMatchName(/Controller$/))
 *   .check()
 */
export function mustMatchName(pattern: RegExp): Condition<ClassDeclaration> {
  return {
    description: `have name matching ${String(pattern)}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const name = cls.getName() ?? '<anonymous>'
        if (!pattern.test(name)) {
          violations.push(
            createViolation(
              cls,
              `${name} does not match naming convention ${String(pattern)}`,
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
 * Class must not have a specific suffix (anti-pattern detection).
 *
 * @example
 * classes(p).that().resideInFolder('** /domain/** ')
 *   .should().satisfy(mustNotEndWith('Entity'))
 *   .check()
 */
export function mustNotEndWith(suffix: string): Condition<ClassDeclaration> {
  return {
    description: `not have name ending with "${suffix}"`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const name = cls.getName() ?? '<anonymous>'
        if (name.endsWith(suffix)) {
          violations.push(createViolation(cls, `${name} should not end with "${suffix}"`, context))
        }
      }
      return violations
    },
  }
}
