import type { TypeMatcher } from '../helpers/type-matchers.js'

/**
 * A shape constraint for a single property in a return type.
 *
 * - `string` — matched as regex against `Type.getText()` (e.g. `'number'`, `'string'`)
 * - `'T[]'` — matches any array type regardless of element type
 * - `TypeMatcher` — full programmatic control (reuse existing matchers)
 */
export type PropertyConstraint = string | TypeMatcher

/**
 * A named architectural pattern that describes expected return type shape.
 */
export interface ArchPattern {
  /** Human-readable pattern name, e.g. 'paginated-collection' */
  readonly name: string
  /** Required properties and their type constraints on the return type */
  readonly returnShape: Record<string, PropertyConstraint>
}

/**
 * Define a reusable architectural pattern.
 *
 * @example
 * ```ts
 * const paginatedCollection = definePattern('paginated-collection', {
 *   returnShape: {
 *     total: 'number',
 *     skip: 'number',
 *     limit: 'number',
 *     items: 'T[]',
 *   },
 * })
 * ```
 */
export function definePattern(
  name: string,
  options: { returnShape: Record<string, PropertyConstraint> },
): ArchPattern {
  return {
    name,
    returnShape: options.returnShape,
  }
}
