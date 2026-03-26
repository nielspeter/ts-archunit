import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchPattern, PropertyConstraint } from '../helpers/pattern.js'
import type { ArchFunction } from '../models/arch-function.js'
import type { Type } from 'ts-morph'

/**
 * Condition: functions must return a type matching the pattern's returnShape.
 *
 * For each property in `pattern.returnShape`:
 * 1. The return type must have a property with that name.
 * 2. The property's type must satisfy the constraint.
 *
 * @example
 * ```ts
 * functions(p)
 *   .that().resideInFolder('src/routes/**')
 *   .should().followPattern(paginatedCollection)
 *   .check()
 * ```
 */
export function followPattern(pattern: ArchPattern): Condition<ArchFunction> {
  return {
    description: `follow pattern "${pattern.name}"`,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []

      for (const fn of elements) {
        const returnType = fn.getReturnType()
        // Unwrap Promise<T> to inspect the resolved type
        const resolvedType = unwrapPromise(returnType)
        const missing = getMissingProperties(resolvedType, pattern)

        if (missing.length > 0) {
          const fnName = fn.getName() ?? '<anonymous>'
          const node = fn.getNode()
          violations.push({
            rule: context.rule,
            element: fnName,
            file: node.getSourceFile().getFilePath(),
            line: fn.getStartLineNumber(),
            message: `"${fnName}" does not follow pattern "${pattern.name}": ${missing.join('; ')}`,
            because: context.because,
          })
        }
      }

      return violations
    },
  }
}

/**
 * Unwrap Promise<T> -> T so async functions can be checked against
 * the same pattern as sync ones.
 */
function unwrapPromise(type: Type): Type {
  const typeText = type.getText()
  if (typeText.startsWith('Promise<')) {
    const typeArgs = type.getTypeArguments()
    if (typeArgs.length === 1 && typeArgs[0] !== undefined) {
      return typeArgs[0]
    }
  }
  return type
}

/**
 * Check each property constraint in the pattern against the resolved type.
 * Returns human-readable descriptions of missing/mismatched properties.
 */
function getMissingProperties(type: Type, pattern: ArchPattern): string[] {
  const problems: string[] = []

  for (const [propName, constraint] of Object.entries(pattern.returnShape)) {
    const prop = type.getProperty(propName)

    if (prop === undefined) {
      problems.push(`missing property "${propName}"`)
      continue
    }

    // Get a declaration node for resolving property type.
    // Try the type's own symbol declarations first, then fall back to the property's declarations.
    const typeDeclarations = type.getSymbol()?.getDeclarations()
    const propDeclarations = prop.getDeclarations()
    const declarationNode =
      (typeDeclarations !== undefined && typeDeclarations.length > 0
        ? typeDeclarations[0]
        : undefined) ?? (propDeclarations.length > 0 ? propDeclarations[0] : undefined)

    if (declarationNode === undefined) {
      problems.push(`property "${propName}" has no resolvable declaration`)
      continue
    }

    const propType = prop.getTypeAtLocation(declarationNode)
    if (!matchesConstraint(propType, constraint)) {
      const actual = propType.getNonNullableType().getText()
      const expected = typeof constraint === 'string' ? constraint : '<custom matcher>'
      problems.push(`property "${propName}" has type '${actual}', expected '${expected}'`)
    }
  }

  return problems
}

/**
 * Test whether a resolved property type satisfies a PropertyConstraint.
 */
function matchesConstraint(propType: Type, constraint: PropertyConstraint): boolean {
  const stripped = propType.getNonNullableType()

  if (typeof constraint === 'function') {
    // TypeMatcher — delegate directly
    return constraint(propType)
  }

  // String constraint
  if (constraint === 'T[]') {
    // Special: any array type
    return stripped.isArray()
  }

  // Match constraint as regex against type text
  const regex = new RegExp(`^${constraint}$`)
  return regex.test(stripped.getText())
}
