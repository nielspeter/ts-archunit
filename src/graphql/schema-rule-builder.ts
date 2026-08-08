import type { RuleDescription } from '../core/rule-description.js'
import type { CollectResult } from '../core/terminal-builder.js'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import type { Predicate } from '../core/predicate.js'
import type { LoadedSchema, GraphQLObjectTypeLike, GraphQLTypeLike } from './schema-loader.js'
import { selectionMemo } from '../core/selection-memo.js'
import type { SchemaElement } from './schema-predicates.js'
import {
  queries as queriesPredicate,
  mutations as mutationsPredicate,
  typesNamed as typesNamedPredicate,
  returnListOf as returnListOfPredicate,
} from './schema-predicates.js'
import {
  haveFields as haveFieldsCondition,
  acceptArgs as acceptArgsCondition,
  haveMatchingResolver as haveMatchingResolverCondition,
} from './schema-conditions.js'

/**
 * Structural type guard: check if a GraphQL type has `getFields()`.
 * Only GraphQLObjectType, GraphQLInterfaceType, and GraphQLInputObjectType have getFields.
 * Scalars, enums, and unions do not.
 */
function isObjectType(type: GraphQLTypeLike): type is GraphQLObjectTypeLike {
  if (typeof type !== 'object' || type === null) return false
  if (!('getFields' in type)) return false
  // At this point TypeScript knows type has 'getFields', verify it's a function
  const candidate: { getFields?: unknown } = type
  return typeof candidate.getFields === 'function'
}

/**
 * Fluent rule builder for GraphQL schema architecture rules.
 *
 * Operates on SchemaElements extracted from .graphql files.
 * Follows the same builder pattern as SliceRuleBuilder (standalone, not extending RuleBuilder).
 *
 * @example
 * ```typescript
 * schema(p, 'src/schema/*.graphql')
 *   .typesNamed(/Collection$/)
 *   .should()
 *   .haveFields('total', 'skip', 'limit', 'items')
 *   .check()
 * ```
 */
const selectionOf = selectionMemo<SchemaElement>()

export class SchemaRuleBuilder extends TerminalBuilder {
  private _predicates: Predicate<SchemaElement>[] = []
  private _conditions: Condition<SchemaElement>[] = []

  constructor(private readonly loaded: LoadedSchema) {
    super()
  }

  // --- Predicate methods ---

  /**
   * Filter to only Query root type fields.
   */
  queries(): this {
    const next = this.copy()
    next._predicates.push(queriesPredicate())
    return next
  }

  /**
   * Filter to only Mutation root type fields.
   */
  mutations(): this {
    const next = this.copy()
    next._predicates.push(mutationsPredicate())
    return next
  }

  /**
   * Filter to object types matching the given name pattern.
   */
  typesNamed(pattern: RegExp | string): this {
    const next = this.copy()
    next._predicates.push(typesNamedPredicate(pattern))
    return next
  }

  /**
   * Filter to fields returning a list of the given type.
   */
  returnListOf(typeName: string | RegExp): this {
    const next = this.copy()
    next._predicates.push(returnListOfPredicate(typeName))
    return next
  }

  // --- Chain methods ---

  /**
   * Begin the predicate phase. Purely a readability marker.
   */
  that(): this {
    return this
  }

  /**
   * Add another predicate (AND).
   */
  and(): this {
    return this
  }

  /**
   * Begin the condition phase.
   */
  should(): this {
    return this
  }

  /**
   * Add another condition (AND).
   */
  andShould(): this {
    return this
  }

  // --- Condition methods ---

  /**
   * Assert that types have all listed fields.
   */
  haveFields(...names: string[]): this {
    const next = this.copy()
    next._conditions.push(haveFieldsCondition(...names))
    return next
  }

  /**
   * Assert that fields accept all listed arguments.
   */
  acceptArgs(...names: string[]): this {
    const next = this.copy()
    next._conditions.push(acceptArgsCondition(...names))
    return next
  }

  /**
   * Assert that schema fields have matching resolver implementations.
   *
   * @param resolverFileTexts - Map of file paths to source text
   */
  haveMatchingResolver(resolverFileTexts: ReadonlyMap<string, string>): this {
    const next = this.copy()
    next._conditions.push(haveMatchingResolverCondition(resolverFileTexts))
    return next
  }

  // --- Evaluation ---

  /**
   * An independent copy, carrying both lists.
   *
   * This builder does not extend `RuleBuilder`, so it does not inherit that
   * class's override — and neither `that()` nor `should()` forked here at all,
   * which made the bug 0016 leak worse on this hierarchy than on the main one:
   * a held `schema()` selection accumulated every predicate and condition of
   * every rule derived from it. `docs/graphql.md` teaches exactly that shape.
   */
  protected override copy(): this {
    const clone = super.copy()
    clone._predicates = [...this._predicates]
    clone._conditions = [...this._conditions]
    return clone
  }

  override assertsSomething(): boolean {
    return this._conditions.length > 0
  }

  override assertionAdvice(): string {
    return (
      'this rule has no condition, so it asserts nothing and can never fail. Add a ' +
      'condition after .should(), e.g. haveFields(...) or acceptArgs(...).'
    )
  }

  /** Named by id or description, not 'unnamed' (plan 0070 §4). */
  override describeRule(): RuleDescription {
    return {
      ...super.describeRule(),
      rule: this._metadata?.id ?? this.buildRuleDescription(),
    }
  }

  /**
   * The set the conditions receive — plan 0096, and the ONE method both readers
   * call. See `ResolverRuleBuilder.selected()` for why sharing it is the point.
   */
  private selected(): SchemaElement[] {
    return selectionOf(this, () =>
      this.getElements().filter((element) =>
        this._predicates.every((predicate) => predicate.test(element)),
      ),
    )
  }

  /** Units this rule examined — plan 0096. */

  /**
   * This family counts schema types — the SDL types it selected.
   *
   * Plan 0099: `CollectResult.examined` is unit-typed per family (ADR-009 part
   * 1), and the zero-examined message prints the noun. Inheriting the base
   * `'subjects'` is a category error in a sentence whose whole job is naming what
   * was and was not looked at.
   */
  protected override examinedUnitNoun(): string {
    return 'schema types'
  }

  examinedUnits(): number {
    return this.selected().length
  }

  protected collectViolations(): CollectResult {
    const filtered = this.selected()

    if (filtered.length === 0) {
      // Plan 0098: the early exit IS the zero-evidence case, stated rather than
      // implied by an empty violation list.
      return { violations: [], examined: 0 }
    }

    const context: ConditionContext = {
      rule: this.buildRuleDescription(),
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    const violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(filtered, context))
    }
    return { violations, examined: filtered.length }
  }

  private getElements(): SchemaElement[] {
    const elements: SchemaElement[] = []
    const typeMap = this.loaded.schema.getTypeMap()
    const firstFile = this.loaded.documents[0]?.filePath

    for (const [typeName, typeObj] of Object.entries(typeMap)) {
      // Skip introspection types (start with __)
      if (typeName.startsWith('__')) continue

      // Skip scalar types that don't have getFields — use structural type guard
      if (!isObjectType(typeObj)) continue

      const objectType = typeObj

      // Add type-level element
      elements.push({
        typeName,
        objectType,
        filePath: firstFile,
      })

      // Add field-level elements
      const fields = objectType.getFields()
      for (const [fieldName, field] of Object.entries(fields)) {
        elements.push({
          typeName,
          fieldName,
          objectType,
          field,
          filePath: firstFile,
        })
      }
    }

    return elements
  }

  private buildRuleDescription(): string {
    const predicateDesc = this._predicates.map((p) => p.description).join(' and ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    const parts: string[] = ['schema']
    if (predicateDesc) parts.push(`that ${predicateDesc}`)
    if (conditionDesc) parts.push(`should ${conditionDesc}`)
    return parts.join(' ')
  }
}
