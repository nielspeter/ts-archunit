import type { Predicate } from './predicate.js'
import type { TypeMatcher } from './type-matcher.js'

/**
 * Negates a predicate or type matcher.
 *
 * Accepts both `Predicate<T>` objects (used in `.that()` chains) and
 * `TypeMatcher` functions (used in `.should()` condition arguments).
 *
 * @example
 * // Negate a predicate:
 * functions(p).that(not(areAsync())).should()...
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
 * functions(p).that(and(areAsync(), areExported())).should()...
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
 * functions(p).that(or(areAsync(), areExported())).should()...
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
  }
}
