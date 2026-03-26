import type { ArchProject } from './project.js'
import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import { executeCheck, executeWarn } from './execute-rule.js'

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
    const violations = this.evaluate()
    executeCheck(
      violations,
      {
        reason: this._reason,
        metadata: this._metadata,
        exclusions: this._exclusions,
      },
      options,
    )
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   * Use for rules that should warn but not fail CI.
   *
   * @param options - Optional baseline and diff filtering
   */
  warn(options?: CheckOptions): void {
    const violations = this.evaluate()
    executeWarn(
      violations,
      {
        reason: this._reason,
        metadata: this._metadata,
        exclusions: this._exclusions,
      },
      options,
    )
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
    fork._reason = fork._metadata?.because ?? this._reason
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

    // Step 3: If no elements match predicates, no violations
    if (filtered.length === 0) {
      return []
    }

    // Step 3b: Warn if no conditions were added — likely a predicate/condition mixup
    if (this._conditions.length === 0) {
      const ruleId = this._metadata?.id ?? (this.buildRuleDescription() || 'unnamed')
      console.warn(
        `[ts-archunit] Rule '${ruleId}' has predicates but no conditions. ` +
          `Did you use a predicate method after .should()? ` +
          `Predicate methods (e.g. notImportFrom) filter elements; ` +
          `use the condition variant (e.g. notImportFromCondition) after .should().`,
      )
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
    const violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(filtered, context))
    }

    return violations
  }
}
