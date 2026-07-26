import type { ArchViolation } from './violation.js'
import type { GlobNode } from './glob-site.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import type { RuleDescription } from './rule-description.js'
import type { SilentExclusion } from './silent-exclusion.js'
import { isSilent } from './silent-exclusion.js'
import { executeCheck, executeWarn, applyFilters } from './execute-rule.js'

/**
 * The single root of every rule builder.
 *
 * Owns the terminal-method pattern — `because`, `rule`, `excluding`,
 * `describeRule`, `violations`, `check`, `warn`, `asSeverity`, `severity` —
 * and leaves subclasses only `collectViolations()`, which differs because
 * each builder has its own collection and evaluation model.
 *
 * `RuleBuilder<T>` extends this too, as of plan 0069. It used not to, and the
 * old docstring here said so plainly: "RuleBuilder does NOT extend this
 * because it predates it." The cost was not the duplicated methods, it was
 * that every safety feature added to one root silently did not reach the
 * builders on the other — which is what bug 0013 cost. Anything that must
 * hold for all thirteen builders now has exactly one place to live.
 */
export abstract class TerminalBuilder {
  protected _reason?: string
  protected _metadata?: RuleMetadata
  protected _severity?: 'error' | 'warn'
  private _exclusions: (string | RegExp)[] = []
  private _silentIndices: Set<number> = new Set()

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
   * A configuration meta-finding — one that reports the rule enforces
   * nothing — is never excludable, and an exclusion that would have matched
   * one is reported as refused rather than as stale.
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
      imperative: this._metadata?.imperative ?? this._reason,
    }
  }

  /**
   * Execute the rule and return violations after exclusion filtering.
   * Does not throw — use for programmatic access (presets, aggregation).
   */
  violations(): ArchViolation[] {
    const raw = this.collectViolations()
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

  /**
   * Every glob declaration this rule makes, as independent trees.
   *
   * One entry per independent declaration, because each one dies on its own:
   * a rule whose selector is satisfiable and whose discovery glob is not has
   * exactly one fault, and reporting them as one tree would lose that.
   *
   * Concrete with an empty default rather than abstract. Making it abstract
   * would enumerate every builder at compile time — genuinely attractive, and
   * how the census refactor did it — but `RuleBuilder` and `TerminalBuilder`
   * are both public exports, so an abstract member is a compile break for
   * anyone who has subclassed them. R2a is the release people install in order
   * to MEASURE before R3 flips anything; it cannot be the one that fails to
   * compile. The vacuity that `abstract` would have caught is caught instead
   * by a test that reflects over both entry points and fails a `return []`
   * stub, which the compiler could not have done anyway.
   */
  globs(): readonly GlobNode[] {
    return []
  }

  /**
   * Give this builder independent copies of another's filter state.
   *
   * `RuleBuilder.fork()` shallow-copies every field, so without this a fork
   * would share its parent's exclusion array by reference and `.excluding()`
   * on one would silently mutate the other. The copy lives here rather than in
   * `fork()` because these fields are private to this class — the knowledge of
   * what needs deep-copying belongs where the fields do.
   */
  protected adoptFilterState(source: TerminalBuilder): void {
    this._exclusions = [...source._exclusions]
    this._silentIndices = new Set(source._silentIndices)
  }

  /**
   * Subclasses implement this to collect and evaluate violations.
   * Called lazily during `.check()` / `.warn()`.
   */
  protected abstract collectViolations(): ArchViolation[]
}
