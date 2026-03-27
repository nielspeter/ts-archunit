/**
 * A predicate that tests whether an architectural element matches a condition.
 * Used in `.that()` clauses to filter elements before rule evaluation.
 */
export interface Predicate<T> {
  /** Human-readable description for violation messages, e.g. "have name matching /^parse/" */
  readonly description: string
  /** Returns true if the element matches this predicate. */
  test(element: T): boolean
}
