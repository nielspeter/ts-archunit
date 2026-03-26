import type { Type } from 'ts-morph'

/**
 * A function that tests a ts-morph Type against a condition.
 *
 * All matchers MUST call getNonNullableType() internally to handle
 * optional properties (strip `undefined` from `T | undefined`).
 * This was a critical finding from the PoC (plan 0001).
 */
export type TypeMatcher = (type: Type) => boolean

/**
 * Negates a matcher. The property type must NOT satisfy the inner matcher.
 *
 * @example
 * not(isString())  // any type except bare string
 */
export function not(matcher: TypeMatcher): TypeMatcher {
  return (type) => !matcher(type)
}

/**
 * Matches bare `string` type.
 * Does NOT match string literal types like `'foo'` or unions of string literals.
 *
 * @example
 * isString()  // matches `string`, not `'a' | 'b'`
 */
export function isString(): TypeMatcher {
  return (type) => type.getNonNullableType().isString()
}

/**
 * Matches bare `number` type.
 * Does NOT match number literal types like `42` or unions of number literals.
 */
export function isNumber(): TypeMatcher {
  return (type) => type.getNonNullableType().isNumber()
}

/**
 * Matches bare `boolean` type.
 */
export function isBoolean(): TypeMatcher {
  return (type) => type.getNonNullableType().isBoolean()
}

/**
 * Matches a union of string literals OR number literals.
 * Requires at least 2 union members (a single literal is not a "union of literals").
 *
 * Handles: `'a' | 'b'`, `1 | 2 | 3`, NOT `string`, NOT `'a' | string`.
 *
 * @example
 * isUnionOfLiterals()  // matches `'asc' | 'desc'`, not `string`
 */
export function isUnionOfLiterals(): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    if (!t.isUnion()) return false
    const members = t.getUnionTypes()
    if (members.length < 2) return false
    return members.every((m) => m.isStringLiteral() || m.isNumberLiteral())
  }
}

/**
 * Matches a specific string literal type (e.g., `'created_at'`).
 * If no value is provided, matches ANY string literal type.
 *
 * @example
 * isStringLiteral()            // matches any string literal
 * isStringLiteral('created_at') // matches only 'created_at'
 */
export function isStringLiteral(value?: string): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    if (!t.isStringLiteral()) return false
    if (value === undefined) return true
    return t.getLiteralValue() === value
  }
}

/**
 * Matches an array type where the element type satisfies the inner matcher.
 *
 * @example
 * arrayOf(isString())  // matches `string[]`
 * arrayOf(isUnionOfLiterals())  // matches `('a' | 'b')[]`
 */
export function arrayOf(elementMatcher: TypeMatcher): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    if (!t.isArray()) return false
    const elementType = t.getArrayElementTypeOrThrow()
    return elementMatcher(elementType)
  }
}

/**
 * Matches when the type's text representation matches the given regex.
 * Escape hatch for types not covered by semantic matchers.
 *
 * Operates on the result of `type.getText()` which returns the type
 * as TypeScript would display it.
 *
 * @example
 * matching(/^Record</)  // matches Record<string, unknown>, etc.
 * matching(/Promise/)   // matches Promise<T> types
 */
export function matching(regex: RegExp): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    return regex.test(t.getText())
  }
}

/**
 * Matches when the type text is exactly the given string.
 * Useful for matching specific type references.
 *
 * @example
 * exactly('SortColumn')  // matches the SortColumn type alias
 */
export function exactly(typeText: string): TypeMatcher {
  return (type) => {
    const t = type.getNonNullableType()
    return t.getText() === typeText
  }
}
