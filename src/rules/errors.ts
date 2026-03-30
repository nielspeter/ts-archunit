import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import type { ArchFunction } from '../models/arch-function.js'
import { newExpr } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'
import { functionNotContain } from '../conditions/body-analysis-function.js'

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

// ─── Function variants ────────────────────────────────────────────

export function functionNoGenericErrors(): Condition<ArchFunction> {
  return functionNotContain(newExpr('Error'))
}

export function functionNoTypeErrors(): Condition<ArchFunction> {
  return functionNotContain(newExpr('TypeError'))
}
