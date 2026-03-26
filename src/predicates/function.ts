import type { Predicate } from '../core/predicate.js'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Matches async functions (declared with the `async` keyword).
 */
export function areAsync(): Predicate<ArchFunction> {
  return {
    description: 'are async',
    test: (fn) => fn.isAsync(),
  }
}

/**
 * Matches functions that are NOT async.
 */
export function areNotAsync(): Predicate<ArchFunction> {
  return {
    description: 'are not async',
    test: (fn) => !fn.isAsync(),
  }
}

/**
 * Matches functions with exactly `n` parameters.
 */
export function haveParameterCount(n: number): Predicate<ArchFunction> {
  return {
    description: `have ${String(n)} parameter${n === 1 ? '' : 's'}`,
    test: (fn) => fn.getParameters().length === n,
  }
}

/**
 * Matches functions with more than `n` parameters.
 */
export function haveParameterCountGreaterThan(n: number): Predicate<ArchFunction> {
  return {
    description: `have more than ${String(n)} parameter${n === 1 ? '' : 's'}`,
    test: (fn) => fn.getParameters().length > n,
  }
}

/**
 * Matches functions with fewer than `n` parameters.
 */
export function haveParameterCountLessThan(n: number): Predicate<ArchFunction> {
  return {
    description: `have fewer than ${String(n)} parameter${n === 1 ? '' : 's'}`,
    test: (fn) => fn.getParameters().length < n,
  }
}

/**
 * Matches functions that have a parameter with the given name.
 */
export function haveParameterNamed(name: string): Predicate<ArchFunction> {
  return {
    description: `have a parameter named "${name}"`,
    test: (fn) => fn.getParameters().some((p) => p.getName() === name),
  }
}

/**
 * Matches functions whose return type text matches the given pattern.
 *
 * The pattern is matched against the type checker's text representation
 * of the return type (e.g. "Promise<number>", "string", "void").
 *
 * @param pattern - RegExp or string (converted to RegExp)
 */
export function haveReturnType(pattern: RegExp | string): Predicate<ArchFunction> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    description: `have return type matching ${String(regex)}`,
    test: (fn) => regex.test(fn.getReturnType().getText()),
  }
}
