import fs from 'node:fs'
import type { ArchProject } from './project.js'
import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import { ArchRuleError } from './errors.js'
import { formatViolations } from './format.js'
import { formatViolationsJson } from './format-json.js'
import { formatViolationsGitHub } from './format-github.js'
import { parseExclusionComments, isExcludedByComment } from '../helpers/exclusion-comments.js'

/**
 * Abstract base class for all rule builders.
 *
 * Concrete entry points (plans 0007+) extend this and:
 * 1. Implement `getElements()` to return the elements to check
 * 2. Add predicate methods that call `addPredicate()`
 * 3. Add condition methods that call `addCondition()`
 *
 * The builder accumulates predicates and conditions. Nothing executes
 * until a terminal method (`.check()`, `.warn()`, `.severity()`) is called.
 */
export abstract class RuleBuilder<T> {
  protected _predicates: Predicate<T>[] = []
  protected _conditions: Condition<T>[] = []
  protected _reason?: string
  protected _metadata?: RuleMetadata
  protected _exclusions: (string | RegExp)[] = []

  constructor(protected readonly project: ArchProject) {}

  // --- Chain methods (grammar transitions) ---

  /**
   * Begin the predicate phase. Returns `this` for chaining.
   * Purely a readability marker — `.that().haveNameMatching(...)` reads like English.
   */
  that(): this {
    return this
  }

  /**
   * Add another predicate (AND). Returns `this` for chaining.
   * `.that().extend('Base').and().resideInFolder('src/repos/**')` means both must match.
   */
  and(): this {
    return this
  }

  /**
   * Begin the condition phase. Returns a forked builder for named selection safety.
   * Creates a fresh builder with the same predicates but empty conditions.
   */
  should(): this {
    const fork = this.fork()
    return fork
  }

  /**
   * Add another condition that must ALSO pass (AND).
   * `.should().notContain(call('x')).andShould().notContain(call('y'))` means both must hold.
   */
  andShould(): this {
    return this
  }

  /**
   * Plug in a custom predicate or condition.
   *
   * After `.that()` — pass a `Predicate<T>` to filter elements.
   * After `.should()` — pass a `Condition<T>` to assert against filtered elements.
   *
   * Dispatch is structural: if the object has a `test` method it is treated
   * as a predicate; if it has `evaluate` it is treated as a condition.
   */
  satisfy(custom: Predicate<T> | Condition<T>): this {
    if ('test' in custom) {
      return this.addPredicate(custom)
    }
    return this.addCondition(custom)
  }

  /**
   * Attach a human-readable rationale to the rule.
   * Included in violation messages when `.check()` throws.
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
   * Exclude specific elements from violation reporting.
   *
   * Matched violations are silently suppressed. Use for permanent,
   * intentional exceptions — not for temporary violations (use baseline for those).
   *
   * Matches against the violation's `element` field (e.g., 'Asset.getImageUrl').
   * Supports exact strings and regex patterns.
   *
   * Emits a warning if an exclusion matches zero violations (stale exclusion).
   */
  excluding(...patterns: (string | RegExp)[]): this {
    this._exclusions.push(...patterns)
    return this
  }

  // --- Terminal methods ---

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   * This is the primary terminal method — use in test assertions.
   *
   * @param options - Optional baseline and diff filtering
   */
  check(options?: CheckOptions): void {
    let violations = this.evaluate()

    // Apply baseline filter — remove known violations
    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }

    // Apply diff filter — only violations in changed files
    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      if (options?.format === 'github') {
        // Print GitHub annotations to stdout (GitHub reads stdout for commands)
        process.stdout.write(formatViolationsGitHub(violations, 'error') + '\n')
      }
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   * Use for rules that should warn but not fail CI.
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
   * `.severity('error')` is equivalent to `.check()`.
   * `.severity('warn')` is equivalent to `.warn()`.
   */
  severity(level: 'error' | 'warn'): void {
    if (level === 'error') {
      this.check()
    } else {
      this.warn()
    }
  }

  // --- Protected: for subclasses ---

  /**
   * Register a predicate. Called by concrete builder methods like
   * `.haveNameMatching()`, `.extend()`, etc.
   */
  protected addPredicate(predicate: Predicate<T>): this {
    this._predicates.push(predicate)
    return this
  }

  /**
   * Register a condition. Called by concrete builder methods like
   * `.notContain()`, `.notExist()`, etc.
   */
  protected addCondition(condition: Condition<T>): this {
    this._conditions.push(condition)
    return this
  }

  /**
   * Subclasses implement this to return the elements to check.
   * Called lazily during `.check()` / `.warn()`.
   */
  protected abstract getElements(): T[]

  /**
   * Create a fork of this builder with the same predicates but empty conditions.
   * Used by `.should()` to support named selections without mutation.
   *
   * Subclasses with additional constructor args MUST override this method.
   */
  protected fork(): this {
    // Object.create/getPrototypeOf return untyped — casts unavoidable at JS interop boundary
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const proto: object = Object.getPrototypeOf(this)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fork: this = Object.create(proto)
    Object.assign(fork, this)
    fork._predicates = [...this._predicates]
    fork._conditions = []
    fork._exclusions = [...this._exclusions]
    fork._metadata = this._metadata ? { ...this._metadata } : undefined
    fork._reason = fork._metadata?.because
    return fork
  }

  // --- Private: execution engine ---

  /**
   * Build the rule description from predicates and conditions.
   */
  private buildRuleDescription(): string {
    const predicateDesc = this._predicates.map((p) => p.description).join(' and ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    const parts: string[] = []
    if (predicateDesc) parts.push(`that ${predicateDesc}`)
    if (conditionDesc) parts.push(`should ${conditionDesc}`)
    return parts.join(' ')
  }

  /**
   * Execute the full pipeline: filter elements with predicates,
   * evaluate conditions, return violations.
   */
  private evaluate(): ArchViolation[] {
    // Step 1: Get all elements from the concrete builder
    const allElements = this.getElements()

    // Step 2: Filter with predicates (AND — all predicates must match)
    const filtered = allElements.filter((element) =>
      this._predicates.every((predicate) => predicate.test(element)),
    )

    // Step 3: If no elements match predicates or no conditions, no violations
    if (filtered.length === 0 || this._conditions.length === 0) {
      return []
    }

    // Step 4: Build context for conditions
    const context: ConditionContext = {
      rule: this.buildRuleDescription(),
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    // Step 5: Evaluate all conditions (AND — all must pass)
    let violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(filtered, context))
    }

    // Step 6: Scan source files for inline exclusion comments (when rule has an ID)
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

    // Step 7: Filter exclusions — track which patterns matched for stale detection
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
}
