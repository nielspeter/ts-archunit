import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { SchemaElement } from './schema-predicates.js'

/**
 * Assert that a type has all listed fields.
 *
 * When applied to a type-level SchemaElement, checks that the object type
 * defines all the named fields. When applied to a field-level element,
 * checks the parent type.
 *
 * @param names - Field names that must exist on the type
 */
export function haveFields(...names: string[]): Condition<SchemaElement> {
  return {
    description: 'have fields ' + names.map((n) => `"${n}"`).join(', '),
    evaluate(elements: SchemaElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        const fields = element.objectType.getFields()
        const fieldNames = Object.keys(fields)
        for (const name of names) {
          if (!fieldNames.includes(name)) {
            violations.push({
              rule: context.rule,
              ruleId: context.ruleId,
              element: element.typeName,
              file: element.filePath ?? '<schema>',
              line: 1,
              message: `Type "${element.typeName}" is missing field "${name}"`,
              because: context.because,
              suggestion: context.suggestion,
              docs: context.docs,
            })
          }
        }
      }
      return violations
    },
  }
}

/**
 * Assert that a field accepts all listed arguments.
 *
 * Only applies to field-level SchemaElements. Type-level elements are skipped.
 *
 * @param names - Argument names that must exist on the field
 */
export function acceptArgs(...names: string[]): Condition<SchemaElement> {
  return {
    description: 'accept args ' + names.map((n) => `"${n}"`).join(', '),
    evaluate(elements: SchemaElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const element of elements) {
        if (!element.field) continue
        const argNames = element.field.args.map((a) => a.name)
        for (const name of names) {
          if (!argNames.includes(name)) {
            violations.push({
              rule: context.rule,
              ruleId: context.ruleId,
              element: `${element.typeName}.${element.fieldName ?? element.field.name}`,
              file: element.filePath ?? '<schema>',
              line: 1,
              message: `Field "${element.typeName}.${element.fieldName ?? element.field.name}" is missing argument "${name}"`,
              because: context.because,
              suggestion: context.suggestion,
              docs: context.docs,
            })
          }
        }
      }
      return violations
    },
  }
}

/**
 * Assert that each schema field has a matching resolver export.
 *
 * Cross-references schema fields with TypeScript resolver files.
 * A field "users" on type "Query" is matched if any resolver file exports
 * a function/variable named "users" or contains a property assignment "Query.users".
 *
 * @param resolverFileTexts - Map of file paths to their source text (for matching)
 */
export function haveMatchingResolver(
  resolverFileTexts: ReadonlyMap<string, string>,
): Condition<SchemaElement> {
  return {
    description: 'have matching resolver',
    evaluate(elements: SchemaElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      const allText = [...resolverFileTexts.values()].join('\n')

      for (const element of elements) {
        if (!element.field) continue
        const fieldName = element.fieldName ?? element.field.name

        // Check if any resolver file references this field name
        // Look for: export function fieldName, export const fieldName,
        // or TypeName.fieldName patterns
        const patterns = [
          new RegExp(`\\b${fieldName}\\b`),
          new RegExp(`${element.typeName}\\.${fieldName}`),
        ]

        const hasResolver = patterns.some((p) => p.test(allText))
        if (!hasResolver) {
          violations.push({
            rule: context.rule,
            ruleId: context.ruleId,
            element: `${element.typeName}.${fieldName}`,
            file: element.filePath ?? '<schema>',
            line: 1,
            message: `Field "${element.typeName}.${fieldName}" has no matching resolver`,
            because: context.because,
            suggestion: context.suggestion,
            docs: context.docs,
          })
        }
      }
      return violations
    },
  }
}
