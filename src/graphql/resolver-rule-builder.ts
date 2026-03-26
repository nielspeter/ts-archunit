import type { SourceFile } from 'ts-morph'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { CheckOptions } from '../core/check-options.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import type { Predicate } from '../core/predicate.js'
import { ArchRuleError } from '../core/errors.js'
import { formatViolations } from '../core/format.js'
import { formatViolationsJson } from '../core/format-json.js'
import { formatViolationsGitHub } from '../core/format-github.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchFunction } from '../models/arch-function.js'
import { collectFunctions } from '../models/arch-function.js'
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
export class ResolverRuleBuilder {
  private _predicates: Predicate<ArchFunction>[] = []
  private _conditions: Condition<ArchFunction>[] = []
  private _reason?: string
  private _metadata?: RuleMetadata

  constructor(private readonly sourceFiles: SourceFile[]) {}

  // --- Predicate methods ---

  /**
   * Filter to resolver functions for fields returning types matching the pattern.
   */
  resolveFieldReturning(pattern: RegExp | string): this {
    this._predicates.push(resolveFieldReturning(pattern))
    return this
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
    this._conditions.push(functionContain(matcher))
    return this
  }

  /**
   * Assert that the resolver body does NOT contain any match.
   */
  notContain(matcher: ExpressionMatcher): this {
    this._conditions.push(functionNotContain(matcher))
    return this
  }

  /**
   * Assert: must NOT contain 'bad' AND must contain 'good'.
   */
  useInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher): this {
    this._conditions.push(functionUseInsteadOf(bad, good))
    return this
  }

  // --- Metadata methods ---

  /**
   * Attach a human-readable rationale to the rule.
   */
  because(reason: string): this {
    this._reason = reason
    return this
  }

  /**
   * Attach rich metadata to the rule.
   */
  rule(metadata: RuleMetadata): this {
    this._metadata = metadata
    if (metadata.because) {
      this._reason = metadata.because
    }
    return this
  }

  // --- Terminal methods ---

  /**
   * Execute the rule and throw ArchRuleError if any violations are found.
   */
  check(options?: CheckOptions): void {
    let violations = this.evaluate()

    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }
    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(violations, 'error') + '\n')
      }
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   */
  warn(options?: CheckOptions): void {
    let violations = this.evaluate()

    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }
    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      if (options?.format === 'json') {
        console.warn(formatViolationsJson(violations, this._reason))
      } else if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(violations, 'warning') + '\n')
      } else {
        console.warn(formatViolations(violations, this._reason))
      }
    }
  }

  /**
   * Execute the rule with the given severity.
   */
  severity(level: 'error' | 'warn'): void {
    if (level === 'error') {
      this.check()
    } else {
      this.warn()
    }
  }

  // --- Private ---

  private evaluate(): ArchViolation[] {
    const allElements = this.getElements()

    const filtered = allElements.filter((element) =>
      this._predicates.every((predicate) => predicate.test(element)),
    )

    if (filtered.length === 0 || this._conditions.length === 0) {
      return []
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
    return violations
  }

  private getElements(): ArchFunction[] {
    return this.sourceFiles.flatMap((sf) => collectFunctions(sf))
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
