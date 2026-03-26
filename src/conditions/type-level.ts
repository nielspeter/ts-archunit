import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'
import type { TypeDeclaration } from '../predicates/type.js'

/**
 * Assert that a named property's type satisfies the given matcher.
 *
 * This is the key condition for type-level architecture rules.
 * Resolves through type aliases, Partial<>, Pick<>, etc.
 *
 * Elements without the named property are skipped (no violation).
 * Use the `haveProperty()` predicate to filter to types that have the property.
 *
 * @example
 * // sortBy must not be bare string
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .check()
 *
 * // sortBy must be a union of string literals
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', isUnionOfLiterals())
 *   .check()
 */
export function havePropertyType(
  propertyName: string,
  matcher: TypeMatcher,
): Condition<TypeDeclaration> {
  return {
    description: `have property "${propertyName}" with matching type`,
    evaluate(elements: TypeDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []

      for (const element of elements) {
        const type = element.getType()
        const prop = type.getProperty(propertyName)

        // Skip elements without the property — not a violation.
        // The predicate haveProperty() should be used to filter these out.
        if (prop === undefined) continue

        // Resolve property type in context (critical for Partial<>, Pick<>)
        const propType = prop.getTypeAtLocation(element)
        const stripped = propType.getNonNullableType()
        const typeText = stripped.getText()

        if (!matcher(propType)) {
          violations.push(
            createViolation(
              element,
              `property "${propertyName}" has type '${typeText}' which does not match the expected type constraint`,
              context,
            ),
          )
        }
      }

      return violations
    },
  }
}
