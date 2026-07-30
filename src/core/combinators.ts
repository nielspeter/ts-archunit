import type { Predicate } from './predicate.js'
import type { TypeMatcher } from './type-matcher.js'
import { combineGlobs, negateGlobs } from './glob-site.js'

/**
 * Negates a predicate or type matcher.
 *
 * Accepts both `Predicate<T>` objects (used in `.that()` chains) and
 * `TypeMatcher` functions (used in `.should()` condition arguments).
 *
 * @example
 * // Negate a predicate:
 * functions(p).that().satisfy(not(areAsync())).should()...
 *
 * // Negate a type matcher:
 * .should().haveReturnTypeMatching(not(matching(/void/)))
 */
export function not<T>(input: Predicate<T>): Predicate<T>
export function not(input: TypeMatcher): TypeMatcher
export function not<T>(input: Predicate<T> | TypeMatcher): Predicate<T> | TypeMatcher {
  if (typeof input === 'function') {
    return (type) => !input(type)
  }
  return {
    description: `not (${input.description})`,
    test: (element: T) => !input.test(element),
    // Negation-normal-form push-down: `op` inverts as well as `polarity`.
    // `not(unsatisfiable)` selects everything, so a negated site is
    // over-selection rather than vacuity and can never be a fault — but a
    // `not` nested inside the subtree flips it back, which is why this cannot
    // just flip polarity. See `negateGlobs`.
    globs: input.globs && negateGlobs(input.globs),
  }
}

function assertHomogeneous<T>(inputs: (Predicate<T> | TypeMatcher)[]): void {
  if (inputs.length === 0) return
  const firstIsFunction = typeof inputs[0] === 'function'
  if (inputs.some((i) => (typeof i === 'function') !== firstIsFunction)) {
    throw new TypeError('Cannot mix Predicate objects and TypeMatcher functions in and()/or()')
  }
}

/**
 * Combines predicates or type matchers with AND logic.
 *
 * All inputs must be the same kind: either all `Predicate<T>` or all
 * `TypeMatcher`. Requires at least one argument.
 *
 * @example
 * // Combine predicates:
 * functions(p).that().satisfy(and(areAsync(), areExported())).should()...
 *
 * // Combine type matchers:
 * .should().haveReturnTypeMatching(and(matching(/Promise/), not(matching(/void/))))
 */
export function and<T>(...predicates: Predicate<T>[]): Predicate<T>
export function and(...matchers: TypeMatcher[]): TypeMatcher
export function and<T>(...inputs: (Predicate<T> | TypeMatcher)[]): Predicate<T> | TypeMatcher {
  assertHomogeneous(inputs)
  if (typeof inputs[0] === 'function') {
    const matchers = inputs.filter((input): input is TypeMatcher => typeof input === 'function')
    const fn: TypeMatcher = (type) => matchers.every((m) => m(type))
    return fn
  }
  const predicates = inputs.filter((input): input is Predicate<T> => typeof input !== 'function')
  return {
    description: predicates.map((p) => p.description).join(' and '),
    test: (element: T) => predicates.every((p) => p.test(element)),
    // A conjunction selects nothing as soon as ONE input does.
    globs: combineGlobs(
      'all',
      predicates.map((p) => p.globs),
    ),
  }
}

/**
 * Combines predicates or type matchers with OR logic.
 *
 * All inputs must be the same kind: either all `Predicate<T>` or all
 * `TypeMatcher`. Requires at least one argument.
 *
 * @example
 * // Combine predicates:
 * functions(p).that().satisfy(or(areAsync(), areExported())).should()...
 *
 * // Combine type matchers:
 * .should().haveReturnTypeMatching(or(matching(/Promise/), matching(/Collection/)))
 */
export function or<T>(...predicates: Predicate<T>[]): Predicate<T>
export function or(...matchers: TypeMatcher[]): TypeMatcher
export function or<T>(...inputs: (Predicate<T> | TypeMatcher)[]): Predicate<T> | TypeMatcher {
  assertHomogeneous(inputs)
  if (typeof inputs[0] === 'function') {
    const matchers = inputs.filter((input): input is TypeMatcher => typeof input === 'function')
    return (type) => matchers.some((m) => m(type))
  }
  const predicates = inputs.filter((input): input is Predicate<T> => typeof input !== 'function')
  return {
    description: predicates.map((p) => p.description).join(' or '),
    test: (element: T) => predicates.some((p) => p.test(element)),
    // A disjunction selects nothing only when EVERY input does. Inputs that
    // declare no globs become retained opaque children rather than being
    // dropped — dropping them here is what would red `or(deadGlob, byName)`.
    globs: combineGlobs(
      'any',
      predicates.map((p) => p.globs),
    ),
  }
}
