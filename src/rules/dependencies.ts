import type { SourceFile } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import {
  onlyImportFrom,
  notImportFrom,
  onlyHaveTypeImportsFrom,
} from '../conditions/dependency.js'

/**
 * Module must only import from allowed paths.
 *
 * Convenience wrapper around the onlyImportFrom condition.
 *
 * @example
 * modules(p).that().resideInFolder('** /domain/** ')
 *   .should().satisfy(onlyDependOn('** /domain/** ', '** /shared/** '))
 *   .check()
 */
export function onlyDependOn(...globs: string[]): Condition<SourceFile> {
  return onlyImportFrom(...globs)
}

/**
 * Module must not import from forbidden paths.
 *
 * @example
 * modules(p).that().resideInFolder('** /domain/** ')
 *   .should().satisfy(mustNotDependOn('** /infrastructure/** '))
 *   .check()
 */
export function mustNotDependOn(...globs: string[]): Condition<SourceFile> {
  return notImportFrom(...globs)
}

/**
 * Imports from specific paths must be type-only.
 *
 * @example
 * modules(p).that().resideInFolder('** /services/** ')
 *   .should().satisfy(typeOnlyFrom('** /domain/** '))
 *   .check()
 */
export function typeOnlyFrom(...globs: string[]): Condition<SourceFile> {
  return onlyHaveTypeImportsFrom(...globs)
}
