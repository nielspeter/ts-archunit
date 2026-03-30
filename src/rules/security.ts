import type { ClassDeclaration, SourceFile } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import type { ArchFunction } from '../models/arch-function.js'
import { call, newExpr, access } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { moduleNotContain } from '../conditions/body-analysis-module.js'

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

/**
 * No direct console access (any method: log, warn, error, debug, info).
 * Stricter than noConsoleLog — catches all console methods.
 */
export function noConsole(): Condition<ClassDeclaration> {
  return classNotContain(access(/^console\./))
}

/**
 * No JSON.parse calls — centralize deserialization.
 */
export function noJsonParse(): Condition<ClassDeclaration> {
  return classNotContain(call('JSON.parse'))
}

// ─── Function variants ────────────────────────────────────────────

export function functionNoEval(): Condition<ArchFunction> {
  return functionNotContain(call('eval'))
}

export function functionNoFunctionConstructor(): Condition<ArchFunction> {
  return functionNotContain(newExpr('Function'))
}

export function functionNoProcessEnv(): Condition<ArchFunction> {
  return functionNotContain(access('process.env'))
}

export function functionNoConsoleLog(): Condition<ArchFunction> {
  return functionNotContain(call('console.log'))
}

export function functionNoConsole(): Condition<ArchFunction> {
  return functionNotContain(access(/^console\./))
}

export function functionNoJsonParse(): Condition<ArchFunction> {
  return functionNotContain(call('JSON.parse'))
}

// ─── Module variants ──────────────────────────────────────────────

export function moduleNoEval(): Condition<SourceFile> {
  return moduleNotContain(call('eval'))
}

export function moduleNoProcessEnv(): Condition<SourceFile> {
  return moduleNotContain(access('process.env'))
}

export function moduleNoConsoleLog(): Condition<SourceFile> {
  return moduleNotContain(call('console.log'))
}
