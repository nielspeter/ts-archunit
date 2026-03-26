import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import { call, newExpr, access } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'

/**
 * No eval() calls in class methods.
 *
 * @example
 * classes(p).should().satisfy(noEval()).check()
 */
export function noEval(): Condition<ClassDeclaration> {
  return classNotContain(call('eval'))
}

/**
 * No new Function() constructor (equivalent to eval).
 *
 * @example
 * classes(p).should().satisfy(noFunctionConstructor()).check()
 */
export function noFunctionConstructor(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('Function'))
}

/**
 * No direct process.env access in class methods.
 *
 * Use dependency injection for configuration instead.
 *
 * @example
 * classes(p).that().resideInFolder('** /domain/** ')
 *   .should().satisfy(noProcessEnv())
 *   .because('use Config injection instead')
 *   .check()
 */
export function noProcessEnv(): Condition<ClassDeclaration> {
  return classNotContain(access('process.env'))
}

/**
 * No console.log calls in class methods.
 *
 * Use a logger abstraction instead.
 *
 * @example
 * classes(p).that().resideInFolder('** /src/** ')
 *   .should().satisfy(noConsoleLog())
 *   .check()
 */
export function noConsoleLog(): Condition<ClassDeclaration> {
  return classNotContain(call('console.log'))
}
