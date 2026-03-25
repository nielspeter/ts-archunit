import type { Node } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * Create a condition that checks each element individually.
 *
 * The predicate function returns true if the element satisfies the condition.
 * Elements that return false produce a violation using the message function.
 *
 * @param description - Human-readable condition description
 * @param predicate - Returns true if element satisfies the condition
 * @param messageFn - Produces a violation message for a failing element
 */
export function elementCondition<T extends Node>(
  description: string,
  predicate: (element: T) => boolean,
  messageFn: (element: T) => string,
): Condition<T> {
  return {
    description,
    evaluate(elements: T[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        if (!predicate(element)) {
          violations.push(createViolation(element, messageFn(element), context))
        }
      }
      return violations
    },
  }
}
