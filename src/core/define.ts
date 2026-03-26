import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'

/**
 * Create a custom predicate for use in `.that().satisfy()` chains.
 *
 * The predicate filters elements — return `true` to keep, `false` to exclude.
 *
 * @example
 * ```ts
 * const isAbstract = definePredicate<ClassDeclaration>(
 *   'is abstract',
 *   (cls) => cls.isAbstract()
 * )
 *
 * classes(p).that().satisfy(isAbstract).should().beExported().check()
 * ```
 */
export function definePredicate<T>(
  description: string,
  test: (element: T) => boolean,
): Predicate<T> {
  return { description, test }
}

/**
 * Create a custom condition for use in `.should().satisfy()` chains.
 *
 * The callback receives the filtered element array and rule context.
 * Return an `ArchViolation[]` for elements that fail the condition.
 *
 * @example
 * ```ts
 * const useSharedHelper = defineCondition<ClassDeclaration>(
 *   'use shared count helper',
 *   (classes, context) => {
 *     return classes
 *       .filter(cls => !usesHelper(cls))
 *       .map(cls => createViolation(cls, 'should use shared count helper', context))
 *   }
 * )
 *
 * classes(p).that().extend('Base').should().satisfy(useSharedHelper).check()
 * ```
 */
export function defineCondition<T>(
  description: string,
  evaluate: (elements: T[], context: ConditionContext) => ArchViolation[],
): Condition<T> {
  return { description, evaluate }
}
