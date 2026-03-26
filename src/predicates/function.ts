import type { Predicate } from '../core/predicate.js'
import type { ArchFunction } from '../models/arch-function.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'

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

/**
 * Matches functions that have at least one rest parameter (...args).
 */
export function haveRestParameter(): Predicate<ArchFunction> {
  return {
    description: 'have a rest parameter',
    test: (fn) => fn.getParameters().some((p) => p.isRestParameter()),
  }
}

/**
 * Matches functions that have at least one optional or default-valued parameter.
 *
 * Includes both `x?: string` (optional) and `x = 10` (default value).
 */
export function haveOptionalParameter(): Predicate<ArchFunction> {
  return {
    description: 'have an optional or default-valued parameter',
    test: (fn) => fn.getParameters().some((p) => p.isOptional() || p.hasInitializer()),
  }
}

/**
 * Matches functions that have a parameter at the given index
 * whose type matches the given TypeMatcher.
 *
 * Note: For rest parameters (...args: string[]), the type is string[] not string.
 * Use arrayOf(isString()) or exactly('string[]') to match rest param types.
 * For optional parameters (x?: string), TypeMatcher strips undefined automatically.
 * Out-of-bounds or negative indices return false.
 */
export function haveParameterOfType(index: number, matcher: TypeMatcher): Predicate<ArchFunction> {
  return {
    description: `have parameter at index ${String(index)} with matching type`,
    test: (fn) => {
      const params = fn.getParameters()
      const param = params[index]
      if (!param) return false
      return matcher(param.getType())
    },
  }
}

/**
 * Matches functions that have a parameter whose name matches the given regex.
 * Unlike haveParameterNamed (exact match), this accepts a regex.
 */
export function haveParameterNameMatching(pattern: RegExp): Predicate<ArchFunction> {
  return {
    description: `have a parameter name matching ${String(pattern)}`,
    test: (fn) => fn.getParameters().some((p) => pattern.test(p.getName())),
  }
}
