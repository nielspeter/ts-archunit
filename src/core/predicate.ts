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

/**
 * Returns a predicate that matches when ALL given predicates match.
 * Description: "have name matching /foo/ and are exported"
 */
export function and<T>(...predicates: Predicate<T>[]): Predicate<T> {
  return {
    description: predicates.map((p) => p.description).join(' and '),
    test: (element) => predicates.every((p) => p.test(element)),
  }
}

/**
 * Returns a predicate that matches when ANY given predicate matches.
 * Description: "have name matching /foo/ or have name matching /bar/"
 */
export function or<T>(...predicates: Predicate<T>[]): Predicate<T> {
  return {
    description: predicates.map((p) => p.description).join(' or '),
    test: (element) => predicates.some((p) => p.test(element)),
  }
}

/**
 * Returns a predicate that matches when the given predicate does NOT match.
 * Description: "not (are exported)"
 */
export function not<T>(predicate: Predicate<T>): Predicate<T> {
  return {
    description: `not (${predicate.description})`,
    test: (element) => !predicate.test(element),
  }
}
