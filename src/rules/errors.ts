import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import { newExpr } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'

/**
 * No throwing generic Error — use typed domain errors instead.
 *
 * @example
 * classes(p).that().extend('BaseService')
 *   .should().satisfy(noGenericErrors())
 *   .because('use DomainError, NotFoundError, etc.')
 *   .check()
 */
export function noGenericErrors(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('Error'))
}

/**
 * No throwing TypeError — usually indicates a programming error, not a domain error.
 */
export function noTypeErrors(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('TypeError'))
}
