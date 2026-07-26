import type { DeclaredGlobs } from './glob-site.js'

/**
 * A predicate that tests whether an architectural element matches a condition.
 * Used in `.that()` clauses to filter elements before rule evaluation.
 */
export interface Predicate<T> {
  /** Human-readable description for violation messages, e.g. "have name matching /^parse/" */
  readonly description: string
  /** Returns true if the element matches this predicate. */
  test(element: T): boolean
  /**
   * The path globs this predicate matches against, if any.
   *
   * Declaring them lets the builder answer "can this rule ever have subjects?"
   * without running it (plan 0069). Optional: a predicate that matches on
   * something other than a path — a name, a decorator, a type — declares
   * nothing and is treated as opaque, which is never a fault.
   *
   * Leaves are `DeclaredGlob`, so a predicate cannot claim a `position`; the
   * builder stamps that on according to where the predicate was registered.
   */
  readonly globs?: DeclaredGlobs
}
