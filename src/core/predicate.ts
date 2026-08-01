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

  /**
   * What to call this predicate's globs in a **configuration finding**, when
   * the call the user made is not the call the predicate makes.
   *
   * Plan 0074, the second consequence of 0069's appendix item 4: presets must
   * thread the option name into the site's origin (`shared: "…"`, not
   * `resideInFolder("…")`), or the message names a call the user never made.
   *
   * A preset option is one name that expands to several predicates —
   * `shared: ['…']` becomes `atPath()`, which is `or(resideInFile,
   * resideInFolder)`. Measured before this existed, the finding read "This
   * rule's selector reside in file matching … or reside in folder matching …
   * can never match anything", naming two calls the author never wrote and
   * omitting the option they did.
   *
   * Deliberately **not** `description`, which is overloaded: that renders the
   * human-readable rule text, and rewriting it would change every violation
   * message the preset produces, not just the configuration finding.
   */
  readonly originLabel?: string
}
