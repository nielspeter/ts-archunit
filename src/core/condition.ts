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
  /**
   * Index of the call argument to fold into the violation element/message.
   *
   * Read by `calls()` conditions in `src/conditions/call.ts` when building
   * violations — threaded into `archCall.getName({ withArgument: ... })`
   * so identity-keyed registrations (HTTP routes, event handlers,
   * registry entries, etc.) can be excluded individually rather than
   * only by file. See proposal 011 / plan 0057.
   *
   * Conditions for other builder types (class, function, module, JSX,
   * etc.) simply ignore this field — it's a `calls()`-specific concern
   * placed on the shared context because abstraction cost would exceed
   * the leak for one optional primitive.
   */
  identifyByArgument?: number
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
