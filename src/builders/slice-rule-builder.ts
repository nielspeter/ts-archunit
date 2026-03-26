import fs from 'node:fs'
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { CheckOptions } from '../core/check-options.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import { ArchRuleError } from '../core/errors.js'
import { formatViolations } from '../core/format.js'
import { formatViolationsJson } from '../core/format-json.js'
import { formatViolationsGitHub } from '../core/format-github.js'
import type { Slice, SliceDefinition } from '../models/slice.js'
import { resolveByMatching, resolveByDefinition } from '../models/slice.js'
import {
  beFreeOfCycles as beFreeOfCyclesCondition,
  respectLayerOrder as respectLayerOrderCondition,
  notDependOn as notDependOnCondition,
} from '../conditions/slice.js'
import { parseExclusionComments, isExcludedByComment } from '../helpers/exclusion-comments.js'

/**
 * Rule builder for slice-level architecture rules.
 *
 * Unlike other builders that extend RuleBuilder<T>, SliceRuleBuilder
 * has its own chain because the grouping step (matching/assignedFrom)
 * replaces the predicate phase entirely.
 *
 * Usage:
 *   slices(project).matching(glob).should().beFreeOfCycles().check()
 *   slices(project).assignedFrom(def).should().respectLayerOrder(...).check()
 */
export class SliceRuleBuilder {
  private _slices: Slice[] = []
  private _conditions: Condition<Slice>[] = []
  private _reason?: string
  private _metadata?: RuleMetadata
  private _exclusions: (string | RegExp)[] = []

  constructor(private readonly project: ArchProject) {}

  /**
   * Define slices by glob matching. Each directory matching the glob
   * becomes a slice named after that directory.
   *
   * @param glob - A glob pattern where the wildcard segment identifies slices
   *
   * @example
   * slices(project).matching('src/features/*\/')
   * // Slices: auth, billing, orders, etc.
   */
  matching(glob: string): this {
    this._slices = resolveByMatching(this.project, glob)
    return this
  }

  /**
   * Define slices from an explicit name-to-glob mapping.
   *
   * @param definition - Map of slice names to glob patterns
   *
   * @example
   * slices(project).assignedFrom({
   *   presentation: 'src/controllers/**',
   *   domain: 'src/domain/**',
   * })
   */
  assignedFrom(definition: SliceDefinition): this {
    this._slices = resolveByDefinition(this.project, definition)
    return this
  }

  /**
   * Begin the condition phase. Returns `this` for chaining.
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

  /**
   * Assert that no circular dependencies exist between slices.
   */
  beFreeOfCycles(): this {
    this._conditions.push(beFreeOfCyclesCondition())
    return this
  }

  /**
   * Assert that slices respect a layered dependency order.
   * Layer N may depend on layers N+1, N+2, ... but NOT on layers with lower index.
   *
   * @param layers - Ordered layer names from highest to lowest
   */
  respectLayerOrder(...layers: string[]): this {
    this._conditions.push(respectLayerOrderCondition(...layers))
    return this
  }

  /**
   * Assert that no slice depends on any of the listed slices.
   *
   * @param sliceNames - Names of forbidden dependency targets
   */
  notDependOn(...sliceNames: string[]): this {
    this._conditions.push(notDependOnCondition(...sliceNames))
    return this
  }

  /**
   * Exclude specific elements from violation reporting.
   *
   * Matched violations are silently suppressed. Use for permanent,
   * intentional exceptions — not for temporary violations (use baseline for those).
   *
   * Matches against the violation's `element` field.
   * Supports exact strings and regex patterns.
   *
   * Emits a warning if an exclusion matches zero violations (stale exclusion).
   */
  excluding(...patterns: (string | RegExp)[]): this {
    this._exclusions.push(...patterns)
    return this
  }

  /**
   * Attach a human-readable rationale to the rule.
   */
  because(reason: string): this {
    this._reason = reason
    return this
  }

  /**
   * Attach rich metadata to the rule.
   * Provides educational context in violation output: why, how to fix, docs link.
   *
   * If `metadata.because` is set, it also sets the reason (same as `.because()`).
   */
  rule(metadata: RuleMetadata): this {
    this._metadata = metadata
    if (metadata.because) {
      this._reason = metadata.because
    }
    return this
  }

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   *
   * @param options - Optional baseline and diff filtering
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
   *
   * @param options - Optional baseline and diff filtering
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

  private evaluate(): ArchViolation[] {
    if (this._slices.length === 0 || this._conditions.length === 0) {
      return []
    }

    const context: ConditionContext = {
      rule: this.buildRuleDescription(),
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    let violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(this._slices, context))
    }

    // Scan source files for inline exclusion comments (when rule has an ID)
    if (this._metadata?.id && violations.length > 0) {
      const filePaths = new Set(violations.map((v) => v.file))
      const allComments = [...filePaths].flatMap((filePath) => {
        try {
          const sourceText = fs.readFileSync(filePath, 'utf-8')
          const result = parseExclusionComments(sourceText, filePath)
          for (const warning of result.warnings) {
            console.warn(`[ts-archunit] ${warning.message}`)
          }
          return result.exclusions
        } catch {
          return []
        }
      })

      if (allComments.length > 0) {
        violations = violations.filter((v) => !isExcludedByComment(v, allComments))
      }
    }

    // Filter exclusions — track which patterns matched for stale detection
    if (this._exclusions.length > 0) {
      const matchedPatterns = new Set<number>()
      violations = violations.filter((v) => {
        const matchIndex = this._exclusions.findIndex((pattern) =>
          typeof pattern === 'string' ? v.element === pattern : pattern.test(v.element),
        )
        if (matchIndex >= 0) {
          matchedPatterns.add(matchIndex)
          return false
        }
        return true
      })

      const ruleId = this._metadata?.id ?? 'unnamed'
      this._exclusions.forEach((pattern, index) => {
        if (!matchedPatterns.has(index)) {
          console.warn(
            `[ts-archunit] Unused exclusion '${String(pattern)}' in rule '${ruleId}'. ` +
              `It matched zero violations — it may be stale after a rename.`,
          )
        }
      })
    }

    return violations
  }

  private buildRuleDescription(): string {
    const sliceDesc = this._slices.map((s) => s.name).join(', ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    return `slices [${sliceDesc}] should ${conditionDesc}`
  }
}

/**
 * Entry point: create a slice-level rule builder.
 *
 * @param p - The loaded ArchProject
 * @returns A SliceRuleBuilder — call `.matching()` or `.assignedFrom()` next
 *
 * @example
 * slices(project)
 *   .matching('src/features/*\/')
 *   .should().beFreeOfCycles()
 *   .check()
 */
export function slices(p: ArchProject): SliceRuleBuilder {
  return new SliceRuleBuilder(p)
}
