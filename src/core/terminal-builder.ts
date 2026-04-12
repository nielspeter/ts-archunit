import type { ArchViolation } from './violation.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import type { RuleDescription } from './rule-description.js'
import type { SilentExclusion } from './silent-exclusion.js'
import { isSilent } from './silent-exclusion.js'
import { executeCheck, executeWarn, applyFilters } from './execute-rule.js'

/**
 * Abstract base class for builders that share the terminal method pattern
 * (because, rule, excluding, check, warn, severity) but have different
 * element collection and evaluation models.
 *
 * Used by SliceRuleBuilder, SchemaRuleBuilder, ResolverRuleBuilder,
 * PairFinalBuilder, and SmellBuilder — all of which implement the same
 * terminal methods but differ in how they collect and evaluate elements.
 *
 * RuleBuilder<T> does NOT extend this because it predates it and has
 * additional concerns (predicate/condition pipeline, fork semantics).
 */
export abstract class TerminalBuilder {
  protected _reason?: string
  protected _metadata?: RuleMetadata
  private readonly _exclusions: (string | RegExp)[] = []
  private readonly _silentIndices: Set<number> = new Set()

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
   * Matches against the violation's `element` field.
   * Supports exact strings and regex patterns.
   *
   * Emits a warning if an exclusion matches zero violations (stale exclusion).
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

  /**
   * Return a structured description of this rule without executing it.
   * Used by the `explain` CLI subcommand.
   */
  describeRule(): RuleDescription {
    return {
      rule: this._metadata?.id ?? 'unnamed',
      id: this._metadata?.id,
      because: this._reason,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }
  }

  /**
   * Execute the rule and return violations after exclusion filtering.
   * Does not throw — use for programmatic access (presets, aggregation).
   */
  violations(): ArchViolation[] {
    const raw = this.collectViolations()
    return applyFilters(raw, {
      reason: this._reason,
      metadata: this._metadata,
      exclusions: this._exclusions,
      silentIndices: this._silentIndices,
    })
  }

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   * This is the primary terminal method — use in test assertions.
   *
   * @param options - Optional baseline, diff filtering, and output format
   */
  check(options?: CheckOptions): void {
    const violations = this.collectViolations()
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
   * @param options - Optional baseline, diff filtering, and output format
   */
  warn(options?: CheckOptions): void {
    const violations = this.collectViolations()
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

  /**
   * Subclasses implement this to collect and evaluate violations.
   * Called lazily during `.check()` / `.warn()`.
   */
  protected abstract collectViolations(): ArchViolation[]
}
