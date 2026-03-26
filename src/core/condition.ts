import type { ArchViolation } from './violation.js'

/**
 * Context passed to conditions during evaluation.
 *
 * Provides the rule description and optional rationale so that
 * violations can include meaningful error messages.
 */
export interface ConditionContext {
  /** Human-readable rule description assembled from the fluent chain */
  rule: string
  /** Optional rationale provided via .because() */
  because?: string
  /** Unique rule identifier from .rule({ id }) */
  ruleId?: string
  /** Actionable fix suggestion from .rule({ suggestion }) */
  suggestion?: string
  /** Link to documentation from .rule({ docs }) */
  docs?: string
}

/**
 * A condition that evaluates filtered elements and returns violations.
 *
 * Conditions receive the elements that passed predicate filtering.
 * They return violations for elements that DON'T satisfy the condition.
 *
 * Most conditions check each element individually. Some (like notExist)
 * check the entire set.
 */
export interface Condition<T> {
  /** Human-readable description of what this condition checks */
  readonly description: string

  /**
   * Evaluate elements against this condition.
   *
   * @param elements - The filtered elements (after predicates)
   * @param context - Rule description and rationale
   * @returns Violations for elements that don't satisfy the condition
   */
  evaluate(elements: T[], context: ConditionContext): ArchViolation[]
}
