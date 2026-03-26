import type { Predicate } from '../core/predicate.js'
import type { GraphQLFieldLike, GraphQLObjectTypeLike } from './schema-loader.js'

/**
 * A schema element that predicates and conditions operate on.
 *
 * Represents either an object type or a field within a type.
 */
export interface SchemaElement {
  /** The type this element belongs to (or is) */
  readonly typeName: string
  /** The field name (undefined if the element is a type itself) */
  readonly fieldName?: string
  /** The GraphQL object type */
  readonly objectType: GraphQLObjectTypeLike
  /** The GraphQL field (present when element is a field) */
  readonly field?: GraphQLFieldLike
  /** Source file path (for violation reporting) */
  readonly filePath?: string
}

/**
 * Filter to only Query root type fields.
 */
export function queries(): Predicate<SchemaElement> {
  return {
    description: 'are queries',
    test(element: SchemaElement): boolean {
      return element.typeName === 'Query' && element.field !== undefined
    },
  }
}

/**
 * Filter to only Mutation root type fields.
 */
export function mutations(): Predicate<SchemaElement> {
  return {
    description: 'are mutations',
    test(element: SchemaElement): boolean {
      return element.typeName === 'Mutation' && element.field !== undefined
    },
  }
}

/**
 * Filter to object types whose name matches the given pattern.
 *
 * @param pattern - Regex or exact string to match type names
 */
export function typesNamed(pattern: RegExp | string): Predicate<SchemaElement> {
  const desc = typeof pattern === 'string' ? `"${pattern}"` : String(pattern)
  if (typeof pattern === 'string') {
    return {
      description: `types named ${desc}`,
      test(element: SchemaElement): boolean {
        return element.field === undefined && element.typeName === pattern
      },
    }
  }
  return {
    description: `types named ${desc}`,
    test(element: SchemaElement): boolean {
      return element.field === undefined && pattern.test(element.typeName)
    },
  }
}

/**
 * Filter to fields whose return type is a list of the given type.
 *
 * Matches GraphQL return types like `[User]`, `[User!]`, `[User!]!`.
 *
 * @param typeName - The inner type name (exact string or regex)
 */
export function returnListOf(typeName: string | RegExp): Predicate<SchemaElement> {
  const desc = typeof typeName === 'string' ? `"${typeName}"` : String(typeName)
  return {
    description: `return list of ${desc}`,
    test(element: SchemaElement): boolean {
      if (!element.field) return false
      const typeStr = element.field.type.toString()
      // Match [TypeName], [TypeName!], [TypeName!]!, [TypeName]!
      const listMatch = /^\[(.+?)!?\]!?$/.exec(typeStr)
      if (!listMatch) return false
      const innerType = listMatch[1]
      if (innerType === undefined) return false
      if (typeof typeName === 'string') {
        return innerType === typeName
      }
      return typeName.test(innerType)
    },
  }
}
