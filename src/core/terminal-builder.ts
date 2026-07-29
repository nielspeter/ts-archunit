import type { ArchViolation } from './violation.js'
import { severityFor } from './violation.js'
import type { GlobNode } from './glob-site.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import type { RuleDescription } from './rule-description.js'
import type { SilentExclusion } from './silent-exclusion.js'
import { isSilent } from './silent-exclusion.js'
import { executeCheck, executeWarn, applyFilters } from './execute-rule.js'
import { shallowClone } from './shallow-clone.js'

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
  // `protected`, not `private`. `RuleBuilder` declared these `protected` before
  // the single-root refactor and both classes are public exports, so narrowing
  // them is a compile break for an external subclass — the same argument that
  // kept `globs()` concrete rather than abstract.
  protected _exclusions: (string | RegExp)[] = []
  protected _silentIndices: Set<number> = new Set()

  /**
   * Attach a human-readable rationale to the rule.
   * Included in violation messages when `.check()` throws.
   */
  because(reason: string): this {
    const next = this.copy()
    next._reason = reason
    return next
  }

  /**
   * Attach rich metadata to the rule.
   * Provides educational context in violation output: why, how to fix, docs link.
   *
   * If `metadata.because` is set, it also sets the reason (same as `.because()`).
   */
  rule(metadata: RuleMetadata): this {
    const next = this.copy()
    next._metadata = metadata
    if (metadata.because) {
      next._reason = metadata.because
    }
    return next
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
    const next = this.copy()
    for (const p of patterns) {
      if (isSilent(p)) {
        next._exclusions.push(p.pattern)
        next._silentIndices.add(next._exclusions.length - 1)
      } else {
        next._exclusions.push(p)
      }
    }
    return next
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
   * A rule that asserts nothing about what it selects cannot fail, so it is
   * reported as a configuration finding (bug 0019, plan 0070).
   *
   * **Gate-first**, ahead of `collectViolations()`, for three measured reasons:
   * an assertion-less rule cannot produce a legitimate finding, so running it
   * buys nothing but a full AST walk; `CorrespondenceBuilder.collectViolations`
   * throws before returning, so a gate placed after it would never run for that
   * builder and its `RangeError` would escape the CLI's `ArchRuleError`-only
   * catch, dropping every remaining rule file; and the alternative ordering —
   * let an existing `bypassFilters` finding win — only functions for rules that
   * opted into `.expectNonEmpty()`, which is the opt-in this whole plan exists
   * because nobody uses.
   *
   * The consequence, accepted: a rule with a dead glob AND no condition reports
   * the missing assertion only. That is the right root cause — no selector
   * makes an assertion-less rule capable of failing — and the selector fault
   * resurfaces on the next run, once there is something to assert.
   *
   * `bypassFilters` makes it a configuration finding: `error` severity
   * regardless of `.asSeverity('warn')`, refused by `.excluding()`, and skipped
   * by diff and baseline. See `severityFor` and ADR-008 rule 1.
   */
  private collectWithAssertionGuard(): ArchViolation[] {
    if (this.assertsSomething()) return this.collectViolations()

    const described = this.describeRule()
    const name = described.id ?? (described.rule || this.constructor.name)
    const advice = this.assertionAdvice()
    return [
      {
        rule: name,
        ruleId: described.id,
        element: name,
        file: '',
        line: 0,
        message: advice,
        // Its own remedy, never the author's (bug 0021): their `suggestion`
        // describes how to fix a violation of the rule, and this finding says
        // the rule cannot produce one.
        suggestion: advice,
        because: this._reason,
        bypassFilters: true,
      },
    ]
  }

  /**
   * Execute the rule and return violations after exclusion filtering.
   * Does not throw — use for programmatic access (presets, aggregation).
   */
  violations(): ArchViolation[] {
    const raw = this.collectWithAssertionGuard()
    const filtered = applyFilters(raw, {
      reason: this._reason,
      metadata: this._metadata,
      exclusions: this._exclusions,
      silentIndices: this._silentIndices,
    })
    const sev: 'error' | 'warn' = this._severity ?? 'error'
    return filtered.map((v) => ({ ...v, severity: severityFor(v, sev) }))
  }

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   * This is the primary terminal method — use in test assertions.
   *
   * @param options - Optional baseline, diff filtering, and output format
   */
  check(options?: CheckOptions): void {
    const violations = this.collectWithAssertionGuard()
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
    const violations = this.collectWithAssertionGuard()
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
    const next = this.copy()
    next._severity = level
    return next
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
   * Whether this rule asserts anything about what it selects (plan 0070).
   *
   * `false` means the rule can never fail: `diagnose()` / `doctor` report it,
   * and the next minor makes it a configuration finding. Nothing at runtime
   * reads this in this release — the gate that did was withdrawn, because a
   * bespoke stderr channel bypassed the formatter, the JSON payload, the
   * annotation path and the exit code, and every one of those was where a
   * review found a defect in it. At 0.23.0 the same hook produces an
   * `ArchViolation`, which reaches all four surfaces by construction.
   *
   * Concrete with a `true` default rather than abstract: both roots are public
   * exports, so an abstract member is a compile break for an external subclass
   * (the `globs()` argument). The default makes a new builder EXEMPT by
   * default — the opposite polarity from `globs()`'s empty default, which only
   * makes a builder invisible. The classification test in
   * `tests/core/assertion-gate.test.ts` is what forces the decision for every
   * exported builder.
   *
   * Public, not protected — `diagnose()` duck-types it through
   * `DiagnosableRule`, and a protected member cannot satisfy a structural
   * interface. Same forcing as `assertsSomething` on `RuleBuilder`, which was
   * already shipped public.
   */
  assertsSomething(): boolean {
    return true
  }

  /**
   * The remedy for this builder's assertion-less state, as one string.
   *
   * The "one string, one place" channel: `diagnose()`'s advice and the
   * finding's message and `suggestion` all read this method, so the diagnostic
   * a consumer runs before upgrading and the failure they get after cannot
   * disagree — plan 0070 round 2 measured an earlier design shipping two
   * diverging texts for one state.
   *
   * Public for the same `DiagnosableRule` duck-typing reason as
   * `assertsSomething` — plan 0070 drafted this `protected`, and a protected
   * member cannot satisfy the structural interface `diagnose()` consumes.
   */
  assertionAdvice(): string {
    return 'this rule asserts nothing, so it can never fail. Add an assertion, or delete the rule.'
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
   * An independent copy of this builder.
   *
   * **A held selection is immutable** (bug 0016). Every method that adds to a
   * builder returns a copy instead of mutating `this`, so
   *
   * ```ts
   * const repositories = classes(p).that().extend('BaseRepository')
   * repositories.that().haveNameEndingWith('Legacy').should().notExist().check()
   * repositories.should().beExported().check()   // still ALL repositories
   * ```
   *
   * works. Before this, narrowing a held selection edited it in place: the
   * second rule silently inherited `Legacy` and reported on a subset — or on
   * nothing, and then passed. Same for `.excluding()`, which leaked a
   * suppression into every later rule off the same selection, and `.rule()`,
   * which leaked the id that `// ts-archunit-exclude <id>` comments are matched
   * against (`execute-rule.ts` gates the whole comment scan on `metadata.id`)
   * and that a preset's severity `overrides` are keyed on — so a later rule
   * inherited a suppression channel it never opted into.
   *
   * Not baselines: `hashViolation` keys on the rule *description*, never on
   * `metadata.id`. An earlier version of this docstring said baselines and a
   * `--rule` filter were keyed on the id. Neither is true, and `--rule` does
   * not exist — the only occurrences of it in the repo were three copies of
   * this sentence. ADR-008 rule 2: a failure may not assert a cause it cannot
   * verify, and that includes naming a flag the CLI does not have.
   *
   * Cost is one object per chain link, against a ts-morph walk. Irrelevant.
   */
  protected copy(): this {
    const clone = shallowClone(this)
    clone.adoptFilterState(this)
    clone._metadata = this._metadata ? { ...this._metadata } : undefined
    return clone
  }

  /**
   * Give this builder independent copies of another's filter state.
   *
   * `copy()` shallow-copies every field, so without this a copy would share
   * its parent's exclusion array by reference and `.excluding()` on one would
   * silently mutate the other. The copy lives here rather than inline in
   * `copy()` because the knowledge of what needs duplicating belongs with the
   * fields — the same reason every other state-holding class overrides
   * `copy()` instead of `copy()` knowing about their fields.
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
