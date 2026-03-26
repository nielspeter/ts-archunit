import { Node, type InterfaceDeclaration, type TypeAliasDeclaration } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'

/**
 * Union type representing both interface and type alias declarations.
 * Used as the element type for TypeRuleBuilder.
 */
export type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration

/**
 * Matches only InterfaceDeclaration elements.
 *
 * @example
 * types(project).that().areInterfaces()  // only interfaces, not type aliases
 */
export function areInterfaces(): Predicate<TypeDeclaration> {
  return {
    description: 'are interfaces',
    test: (element) => Node.isInterfaceDeclaration(element),
  }
}

/**
 * Matches only TypeAliasDeclaration elements.
 *
 * @example
 * types(project).that().areTypeAliases()  // only type aliases, not interfaces
 */
export function areTypeAliases(): Predicate<TypeDeclaration> {
  return {
    description: 'are type aliases',
    test: (element) => Node.isTypeAliasDeclaration(element),
  }
}

/**
 * Matches types that have a property with the given name.
 * Works for both interfaces (direct properties) and type aliases
 * (resolved type properties).
 *
 * @example
 * types(project).that().haveProperty('sortBy')
 */
export function haveProperty(name: string): Predicate<TypeDeclaration> {
  return {
    description: `have property "${name}"`,
    test: (element) => {
      const type = getResolvedType(element)
      return type.getProperty(name) !== undefined
    },
  }
}

/**
 * Matches types that have a property whose type satisfies the given matcher.
 * Resolves through type aliases, Partial<>, Pick<>, etc.
 *
 * @example
 * types(project).that().havePropertyOfType('sortBy', isString())
 */
export function havePropertyOfType(name: string, matcher: TypeMatcher): Predicate<TypeDeclaration> {
  return {
    description: `have property "${name}" of matching type`,
    test: (element) => {
      const propType = getPropertyType(element, name)
      if (propType === undefined) return false
      return matcher(propType)
    },
  }
}

/**
 * Matches interfaces that extend the given type name.
 * For type aliases, checks if the type text references the name.
 *
 * @example
 * types(project).that().extendType('BaseConfig')
 */
export function extendType(name: string): Predicate<TypeDeclaration> {
  return {
    description: `extend type "${name}"`,
    test: (element) => {
      if (Node.isInterfaceDeclaration(element)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const nameRegex = new RegExp(`^${escaped}(\\b|$|<)`)
        return element.getExtends().some((ext) => nameRegex.test(ext.getText()))
      }
      // For type aliases, check if the type directly references the named type
      // Use word boundary matching to avoid false positives (e.g., "BaseConfig" inside "{ bar: BaseConfig }")
      const typeText = element.getType().getText()
      const nameRegex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      return nameRegex.test(typeText)
    },
  }
}

// --- Internal helpers ---

/**
 * Resolve a TypeDeclaration to its ts-morph Type.
 */
function getResolvedType(element: TypeDeclaration) {
  return element.getType()
}

/**
 * Get the Type of a named property on a TypeDeclaration.
 *
 * Uses getTypeAtLocation() to resolve in context, which is critical
 * for Partial<T>, Pick<T, K>, and other mapped types.
 */
function getPropertyType(element: TypeDeclaration, name: string) {
  const type = getResolvedType(element)
  const prop = type.getProperty(name)
  if (prop === undefined) return undefined

  // getTypeAtLocation resolves the property type in the context of the declaration.
  // Without this, Partial<StrictOptions>['sortBy'] would not resolve correctly.
  return prop.getTypeAtLocation(element)
}
