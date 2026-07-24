import type { ArchProject } from './project.js'
import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import type { RuleDescription } from './rule-description.js'
import type { SilentExclusion } from './silent-exclusion.js'
import { isSilent } from './silent-exclusion.js'
import { executeCheck, executeWarn, applyFilters } from './execute-rule.js'

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
  protected _silentIndices: Set<number> = new Set()
  protected _phase: 'predicate' | 'condition' = 'predicate'
  protected _severity?: 'error' | 'warn'

  constructor(protected readonly project: ArchProject) {}

  // --- Chain methods (grammar transitions) ---

  /**
   * Begin the predicate phase. Returns `this` for chaining.
   * Purely a readability marker — `.that().haveNameMatching(...)` reads like English.
   * Explicitly resets phase to 'predicate' — defensive against `.should().that()` misuse.
   */
  that(): this {
    this._phase = 'predicate'
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
   * Sets phase to 'condition' so dual-use methods dispatch correctly.
   */
  should(): this {
    const fork = this.fork()
    fork._phase = 'condition'
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
   * Exclude specific violations from reporting by matching against
   * the violation's `element`, `file`, or `message` fields.
   *
   * Matched violations are silently suppressed. Use for permanent,
   * intentional exceptions — not for temporary violations (use baseline for those).
   *
   * Patterns are matched against all three fields. Prefer anchored regexes
   * or full string matches over short substrings, especially for `message`
   * matching, to avoid accidentally suppressing unrelated violations whose
   * messages happen to contain the same text.
   *
   * Emits a warning if an exclusion matches zero violations — so renamed
   * or deleted exceptions don't silently stay in the rule.
   *
   * For narrowing a rule's scope at the predicate phase (so the rule never
   * evaluates the excluded element), use `satisfy(not(<predicate>))` instead.
   * See the "Excluding a file from a rule's scope" recipe in docs/recipes.md.
   *
   * @example
   * // Exclude by element name (fully qualified)
   * .excluding('Asset.getImageUrl')
   *
   * @example
   * // Exclude by file path (regex anchored to suffix)
   * .excluding(/repositories\/index\.ts$/)
   *
   * @example
   * // Multiple exclusions, mixed forms
   * .excluding('Asset.getImageUrl', /\/legacy\//, /generated/)
   */
  excluding(...patterns: (string | RegExp | SilentExclusion)[]): this {
    for (const p of patterns) {
      if (isSilent(p)) {
        this._exclusions.push(p.pattern)
        this._silentIndices.add(this._exclusions.length - 1)
      } else {
        this._exclusions.push(p)
      }
    }
    return this
  }

  // --- Terminal methods ---

  /**
   * Return a structured description of this rule without executing it.
   * Used by the `explain` CLI subcommand.
   */
  describeRule(): RuleDescription {
    return {
      rule: this.buildRuleDescription(),
      id: this._metadata?.id,
      because: this._reason,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
      imperative: this._metadata?.imperative ?? this.buildImperative(),
    }
  }

  /**
   * Execute the rule and return violations after exclusion filtering.
   * Does not throw — use for programmatic access (presets, aggregation).
   */
  violations(): ArchViolation[] {
    const raw = this.evaluate()
    const filtered = applyFilters(raw, {
      reason: this._reason,
      metadata: this._metadata,
      exclusions: this._exclusions,
      silentIndices: this._silentIndices,
    })
    const sev: 'error' | 'warn' = this._severity ?? 'error'
    return filtered.map((v) => ({ ...v, severity: sev }))
  }

  /**
   * Return the subject set this rule would evaluate: the elements matched by
   * the predicate chain (`.that()...`), before any condition runs. Executes the
   * predicate filter and returns the materialized set.
   *
   * Distinct from the abstract `getElements()`, which is the *pre-filter*
   * population. This is the materialization contract (F1, plan 0064) that
   * composable primitives build on — `correspondence().side(selection, keyFn)`
   * keys each subject, and `.expectNonEmpty()` (plan 0064+) asserts the set is
   * non-empty. It does not evaluate conditions and never warns about their
   * absence, so it is safe to call on a bare `.that()` selection.
   *
   * Note (ADR-007): the returned `T` is the builder's element type (e.g. a
   * ts-morph `ClassDeclaration` for `classes()`), so this is an acknowledged
   * raw-node seam for callers that derive keys from subjects.
   */
  subjects(): readonly T[] {
    return this.filterElements()
  }

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
        silentIndices: this._silentIndices,
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
        silentIndices: this._silentIndices,
      },
      options,
    )
  }

  /**
   * Set the severity this rule reports at WITHOUT executing it (non-terminal).
   * Returns `this` so the builder can be collected into a rule array and run by
   * the CLI pipeline; its `.violations()` stamp each result with this severity.
   * Distinct from the terminal `.severity()` below, which executes immediately.
   */
  asSeverity(level: 'error' | 'warn'): this {
    this._severity = level
    return this
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
    fork._silentIndices = new Set(this._silentIndices)
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
   * Build an imperative "Do NOT … / MUST …" sentence for AI-agent system
   * prompts (`explain --format agent`). Heuristic FALLBACK — a rule author's
   * `.rule({ imperative })` overrides it.
   */
  private buildImperative(): string {
    // The Do-NOT/MUST transform only reads the polarity of a single condition.
    // For zero or multiple (`and`-joined) conditions, negating the joined string
    // would mis-handle mixed polarity ("not X and not Y"), so fall back to the
    // plain, always-correct rule description.
    if (this._conditions.length !== 1) {
      return this.buildRuleDescription() || 'Follow the architecture rule.'
    }
    const cond = this._conditions[0]!.description
    const isNegative = /^(not|no)\b/i.test(cond)
    const body = cond.replace(/^(not|no)\s+/i, '')
    const scope = this._predicates.map((p) => p.description).join(' and ')
    const scopeSuffix = scope ? ` (in code that ${scope})` : ''
    return `${isNegative ? 'Do NOT' : 'MUST'} ${body}${scopeSuffix}`
  }

  /**
   * Materialize the subject set: all elements narrowed by the predicate chain
   * (the post-`.that()` set), before any condition runs. The single place
   * predicate filtering happens — shared by the execution engine (`evaluate`)
   * and the public `subjects()` accessor so the two can never diverge (F1).
   */
  protected filterElements(): T[] {
    // AND semantics — every predicate must match.
    return this.getElements().filter((element) =>
      this._predicates.every((predicate) => predicate.test(element)),
    )
  }

  /**
   * Execute the full pipeline: filter elements with predicates,
   * evaluate conditions, return violations.
   */
  private evaluate(): ArchViolation[] {
    // Step 1+2: Get elements and narrow by predicates (see filterElements).
    const filtered = this.filterElements()

    // Step 3: If no elements match predicates, no violations
    if (filtered.length === 0) {
      return []
    }

    // Step 3b: Warn if no conditions were added and phase is still 'predicate'
    // — likely a predicate-only method was called after .should().
    // Phase-aware methods dispatch correctly, so this only fires for predicate-only methods.
    if (this._conditions.length === 0 && this._phase === 'predicate') {
      const ruleId = this._metadata?.id ?? (this.buildRuleDescription() || 'unnamed')
      console.warn(
        `[ts-archunit] Rule '${ruleId}' has predicates but no conditions. ` +
          `Did you use a predicate-only method after .should()? ` +
          `Predicate-only methods (e.g. areExported, areAsync) filter elements; ` +
          `use a condition method or .satisfy() after .should().`,
      )
      return []
    }

    // Step 4: Build context for conditions
    const context = this.buildConditionContext()

    // Step 5: Evaluate all conditions (AND — all must pass)
    const violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(filtered, context))
    }

    return violations
  }

  /**
   * Build the `ConditionContext` passed to each condition.
   *
   * Subclasses with builder-specific context fields (e.g. `CallRuleBuilder`'s
   * `_identifyByArgument`) override this to extend the base context.
   * Call `super.buildConditionContext()` and spread the result.
   */
  protected buildConditionContext(): ConditionContext {
    return {
      rule: this.buildRuleDescription(),
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }
  }
}
