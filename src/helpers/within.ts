import type { CallRuleBuilder } from '../builders/call-rule-builder.js'
import { ScopedFunctionRuleBuilder } from '../builders/scoped-function-rule-builder.js'

/**
 * A scoped context that restricts entry points to elements found
 * inside the callback arguments of matched call expressions.
 *
 * Created by `within()`. Provides the same entry point functions
 * as the top-level API, but scoped to the matched callbacks.
 */
export interface ScopedContext {
  /**
   * Function-level rules scoped to callbacks of the matched calls.
   * Only examines functions that appear as inline arguments.
   */
  functions(): ScopedFunctionRuleBuilder
}

/**
 * Scope rules to a call selection context.
 *
 * `within(selection)` restricts the search space to callback arguments
 * of the matched call expressions. Instead of scanning all source files,
 * scoped entry points only examine functions that are inline arguments
 * to the matched calls.
 *
 * @param selection - A CallRuleBuilder with predicates already applied.
 *   The predicates are evaluated lazily when a terminal method is called.
 *
 * @example
 * ```typescript
 * const routes = calls(p)
 *   .that()
 *   .onObject('app')
 *   .and()
 *   .withMethod(/^(get|post|put|delete|patch)$/)
 *
 * // Only check functions inside route handler callbacks
 * within(routes).functions().should().contain(call('normalizePagination')).check()
 * ```
 */
export function within(selection: CallRuleBuilder): ScopedContext {
  return {
    functions(): ScopedFunctionRuleBuilder {
      return new ScopedFunctionRuleBuilder(selection)
    },
  }
}
