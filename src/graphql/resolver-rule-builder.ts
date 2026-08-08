import type { RuleDescription } from '../core/rule-description.js'
import type { CollectResult } from '../core/terminal-builder.js'
import type { SourceFile } from 'ts-morph'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { Predicate } from '../core/predicate.js'
import type { ArchProject } from '../core/project.js'
import type { GlobNode } from '../core/glob-site.js'
import { globAnyOf, stampGlobs } from '../core/glob-site.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchFunction } from '../models/arch-function.js'
import { collectFunctions } from '../models/arch-function.js'
import { selectionMemo } from '../core/selection-memo.js'
import {
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
} from '../conditions/body-analysis-function.js'

/**
 * Predicate: filter to resolver functions for fields returning types matching the pattern.
 *
 * Heuristic: a resolver function is one whose name starts with an uppercase letter
 * (type name) or matches common resolver naming conventions. The return type is
 * checked against the pattern.
 *
 * @param pattern - Regex or string to match against the resolved return type text
 */
export function resolveFieldReturning(pattern: RegExp | string): Predicate<ArchFunction> {
  const desc = typeof pattern === 'string' ? `"${pattern}"` : String(pattern)
  return {
    description: `resolve field returning ${desc}`,
    test(fn: ArchFunction): boolean {
      const returnType = fn.getReturnType().getText()
      if (typeof pattern === 'string') {
        return returnType.includes(pattern)
      }
      return pattern.test(returnType)
    },
  }
}

/**
 * Fluent rule builder for GraphQL resolver architecture rules.
 *
 * Operates on TypeScript resolver files analyzed through the ArchFunction model.
 * Reuses the body analysis engine from plan 0011 for conditions like contain/notContain.
 *
 * @example
 * ```typescript
 * resolvers(p, 'src/resolvers/**')
 *   .that()
 *   .resolveFieldReturning(/^[A-Z]/)
 *   .should()
 *   .contain(call('loader.load'))
 *   .because('prevent N+1 queries')
 *   .check()
 * ```
 */
const selectionOf = selectionMemo<ArchFunction>()

export class ResolverRuleBuilder extends TerminalBuilder {
  private _predicates: Predicate<ArchFunction>[] = []
  private _conditions: Condition<ArchFunction>[] = []

  /**
   * @param sourceFiles - The resolver files, already filtered by `resolvers()`.
   * @param glob - The glob they were filtered by, for diagnostics only.
   *
   * `glob` is **optional** because this class is re-exported from the public
   * `./graphql` subpath, so its constructor is public API and a required
   * second parameter would break anyone constructing it directly — which
   * would make R2a a breaking release, and R2a is the one people install in
   * order to measure before R3. `resolvers()` always passes it.
   *
   * Threading it at all is the point: `resolvers()` filters eagerly and hands
   * this builder only the surviving files, so without the glob string no
   * `globs()` could ever report `resolvers(p, 'src/reslvers/**')` — the rule
   * would silently examine zero resolvers and pass.
   */
  constructor(
    private readonly sourceFiles: SourceFile[],
    private readonly glob?: string,
    private readonly project?: ArchProject,
  ) {
    super()
  }

  /** The project this rule was built against. See `RuleBuilder.getProject`. */
  getProject(): ArchProject | undefined {
    return this.project
  }

  /**
   * The discovery glob, if `resolvers()` supplied it.
   *
   * `tsconfig-relative` is load-bearing, not cosmetic: it is what exempts this
   * glob from the anchor check, because `resolvers(p, 'src/resolvers/**')` — the
   * spelling in this class's own example — is correct as written. Declared
   * `'absolute'` it would be reported unanchored, telling the author to break a
   * working rule.
   */
  override globs(): readonly GlobNode[] {
    if (this.glob === undefined) return []
    return [
      stampGlobs(
        globAnyOf([this.glob], 'file-path', 'tsconfig-relative'),
        'discovery',
        (g) => `resolvers(p, "${g.glob}")`,
      ),
    ]
  }

  // --- Predicate methods ---

  /**
   * Filter to resolver functions for fields returning types matching the pattern.
   */
  resolveFieldReturning(pattern: RegExp | string): this {
    const next = this.copy()
    next._predicates.push(resolveFieldReturning(pattern))
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

  // --- Condition methods (reuse body analysis) ---

  /**
   * Assert that the resolver body contains at least one match.
   */
  contain(matcher: ExpressionMatcher): this {
    const next = this.copy()
    next._conditions.push(functionContain(matcher))
    return next
  }

  /**
   * Assert that the resolver body does NOT contain any match.
   */
  notContain(matcher: ExpressionMatcher): this {
    const next = this.copy()
    next._conditions.push(functionNotContain(matcher))
    return next
  }

  /**
   * Assert: must NOT contain 'bad' AND must contain 'good'.
   */
  useInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher): this {
    const next = this.copy()
    next._conditions.push(functionUseInsteadOf(bad, good))
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
      'condition after .should(), e.g. contain(...), notContain(...) or useInsteadOf(...).'
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
   * call.
   *
   * The first attempt at 0096 let `collectViolations()` and the evidence
   * accessor derive this separately, and they disagreed inside one commit: this
   * builder counted PRE-predicate while its sibling `SchemaRuleBuilder` counted
   * post. Measured, a chain whose `.that()` selected nothing reported 14 units
   * examined, handed its conditions 0, and passed green with `diagnose()`
   * silent — the fail-open cell ADR-009 exists to close, inside the wave that
   * closes it. Sharing the method is what makes "the preview derives from the
   * same computation the gate uses" structural rather than a claim.
   */
  private selected(): ArchFunction[] {
    return selectionOf(this, () =>
      this.getElements().filter((element) =>
        this._predicates.every((predicate) => predicate.test(element)),
      ),
    )
  }

  /** Units this rule examined — plan 0096. The selection, not what precedes it. */

  /**
   * This family counts resolvers — the resolver functions it selected.
   *
   * Plan 0099: `CollectResult.examined` is unit-typed per family (ADR-009 part
   * 1), and the zero-examined message prints the noun. Inheriting the base
   * `'subjects'` is a category error in a sentence whose whole job is naming what
   * was and was not looked at.
   */
  protected override examinedUnitNoun(): string {
    return 'resolvers'
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

  private getElements(): ArchFunction[] {
    // Object-literal collection is opt-in for `functions()`, where turning it on
    // by default would flood every rule with inline callbacks. Here it is the
    // opposite: a GraphQL resolver map IS an object literal
    // (`{ Query: { assetCollection: async () => {} } }`), so without this the
    // builder named `resolvers()` selects the helper functions that happen to
    // sit beside the resolvers and none of the resolvers themselves — measured
    // on a real schema as 60 subjects, 0 of them resolvers. Every rule written
    // against it then passes on the wrong subjects (ADR-008).
    return this.sourceFiles.flatMap((sf) =>
      collectFunctions(sf, { includeObjectLiteralFunctions: true }),
    )
  }

  private buildRuleDescription(): string {
    const predicateDesc = this._predicates.map((p) => p.description).join(' and ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    const parts: string[] = ['resolvers']
    if (predicateDesc) parts.push(`that ${predicateDesc}`)
    if (conditionDesc) parts.push(`should ${conditionDesc}`)
    return parts.join(' ')
  }
}
