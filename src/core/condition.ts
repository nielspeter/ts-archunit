import type { ArchViolation } from './violation.js'
import type { DeclaredGlobs } from './glob-site.js'
import type { ASSERTS_CARDINALITY } from './cardinality.js'

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

  /**
   * The path globs this condition matches against, if any. See
   * `Predicate.globs` — same contract, stamped with `position: 'condition'`.
   */
  readonly globs?: DeclaredGlobs

  /**
   * Whether this condition asserts **cardinality** — that zero subjects is the
   * answer, rather than the absence of one.
   *
   * Plan 0074 (R3b). Every condition is vacuously satisfied by an empty subject
   * set (∀ over ∅), so "did it pass because it holds, or because there was
   * nothing to check?" is undecidable from the outside. 0069 tried the general
   * form — "an empty selector fails unless the condition is satisfied by
   * emptiness" — and it is true of every condition and derivable from none.
   * The workable rule is narrower: a condition may **declare** that emptiness
   * is its passing state.
   *
   * **Declared, never probed.** Evaluating a condition against `[]` to see
   * whether it returns violations answers "yes, it passed" for all of them.
   *
   * Keyed by a module-private symbol so it cannot be set from outside this
   * library — see `cardinality.ts`. `defineCondition` has no parameter for it.
   *
   * `notExist()` is the only shipped condition of this kind, in all four of its
   * element-specific forms. It makes the pre-emptive guard legitimate:
   * `modules(p).that().resideInFolder('**\/legacy/**').should().notExist()`
   * asserts that a folder must not appear, so a selector matching nothing is
   * the rule being **satisfied** — not the rule being broken. Without this the
   * glob gate reds it, which is a false red on a correct rule; measured, it was
   * one of the nine failures the gate produced on this repo's own suite.
   */
  readonly [ASSERTS_CARDINALITY]?: true
}
