import type { Type } from 'ts-morph'

/**
 * A function that tests a ts-morph Type against a condition.
 *
 * All matchers MUST call getNonNullableType() internally to handle
 * optional properties (strip `undefined` from `T | undefined`).
 * This was a critical finding from the PoC (plan 0001).
 */
export type TypeMatcher = (type: Type) => boolean
