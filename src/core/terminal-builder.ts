import type { ArchViolation } from './violation.js'
import { severityFor } from './violation.js'
import type { GlobNode } from './glob-site.js'
import type { GlobSite } from './glob-site.js'
import type { ArchProject } from './project.js'
import type { PathUniverse } from './path-universe.js'
import { pathUniverse } from './path-universe.js'
import { isDeadGlobTree, isDeadSite, globSitesOf } from './glob-evaluator.js'
import { diagnoseGlob, FAULT_ADVICE, ON_DISK_ADVICE } from './glob-diagnosis.js'
import { diskSet } from './disk-set.js'
import type { CheckOptions } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import type { RuleDescription } from './rule-description.js'
import type { SilentExclusion } from './silent-exclusion.js'
import { isSilent } from './silent-exclusion.js'
import { executeCheck, executeWarn, applyFilters } from './execute-rule.js'
import { shallowClone } from './shallow-clone.js'
import { UNSUPPRESSABLE } from './unsuppressable.js'

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
/**
 * Where the assertion-gate finding sends the reader. Same shape as `GLOB_DOCS`,
 * and it points at the section that states the grammar and the no-opt-out rule —
 * not at the builder's own page, which is about writing rules that work.
 */
export const ASSERTION_DOCS =
  'https://nielspeter.github.io/ts-archunit/violation-reporting#a-rule-must-assert-something'

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
    if (this.assertsSomething()) {
      // Plan 0074 (R3b). AFTER the assertion gate, deliberately: a rule with a
      // dead glob AND no condition reports the missing assertion only, which is
      // the right root cause — no selector makes an assertion-less rule capable
      // of failing. The comment above already committed to that ordering; this
      // is the branch that honours it.
      //
      // Gate-first within this branch, before `collectViolations()`: a rule
      // whose selector cannot match will walk the whole AST to select nothing.
      const deadGlobs = this.deadSelectorFindings()
      if (deadGlobs.length > 0) return deadGlobs
      return this.collectViolations()
    }

    const described = this.describeRule()
    const name = described.id || described.rule || this.constructor.name
    // ADR-008 rule 3: where there is deliberately no escape hatch, say so, and
    // say what to do instead. Stated on the finding rather than inside
    // `assertionAdvice()` so the seven per-shape remedies stay one sentence each
    // and this stays one sentence in one place. Measured before it was added: a
    // reader given only the remedy tries `.asSeverity('warn')`, `.excluding()`,
    // the baseline and `--changed` — four CI cycles — because nothing told them
    // those were refused.
    const advice = `${this.assertionAdvice()} ${UNSUPPRESSABLE}`
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
        // the rule cannot produce one. Same for `docs` — the author's link is
        // about their rule; this one is about the grammar the rule broke.
        suggestion: advice,
        docs: ASSERTION_DOCS,
        bypassFilters: true,
        // `ruleId` and `because` are deliberately NOT set here. `applyFilters`
        // fills both from the rule's metadata for every finding that leaves
        // them unset, and all three callers of this method go through it — so
        // setting them here was two lines that read as load-bearing and were
        // not: sabotage removed each with nothing failing. The remedy fields
        // above are the opposite case, and must stay, because `applyFilters`
        // deliberately refuses to supply those for a `bypassFilters` finding.
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
   * `false` means the rule can never fail, and as of 0.23.0
   * `collectWithAssertionGuard()` turns that into an unsuppressable
   * configuration finding on every terminal; `diagnose()` / `doctor` report it
   * without running the rule. 0.22.0 shipped this hook with nothing at runtime
   * reading it, because the gate drafted for that release wrote through a
   * bespoke stderr channel that bypassed the formatter, the JSON payload, the
   * annotation path and the exit code — a review found a defect at each of those
   * seams, so the channel was withdrawn and the hook shipped on its own. The
   * finding form reaches all four surfaces by construction, which is what the
   * withdrawal bought.
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
   * The project this rule was built against, when it has one.
   *
   * Concrete returning `undefined` rather than abstract, for the reason
   * `globs()` above records: both roots are public exports, so an abstract
   * member is a compile break for an external subclass. `RuleBuilder`
   * overrides it with the non-optional form.
   *
   * The glob gate needs it, and a builder that cannot name its project simply
   * has its globs left unchecked — the same fallback `diagnose()` takes, and
   * the honest one: satisfiability is meaningless without a path universe to
   * take it against.
   */
  getProject(): ArchProject | undefined {
    return undefined
  }

  /**
   * Selector globs that can never match — plan 0074 (R3b), the flip.
   *
   * 0069's decision table, not reopened here: a **selector** glob that is
   * unsatisfiable means the rule can never have subjects, so it certifies
   * nothing and passing is a lie. `discovery` already fails (0067-D, and the
   * slice builders own their own message). `condition` and `exclusion` are
   * **never** faults — a condition glob matching nothing is indistinguishable
   * from an armed tripwire that has not fired, and plan 0072 got that wrong
   * twice before it stayed written down.
   *
   * Negative polarity is excluded by `isDeadGlobTree` itself: `not(dead)`
   * over-selects rather than under-selecting, so it cannot be dead.
   *
   * This is the same computation `diagnose()` performs — deliberately, and
   * from the same functions, so the pre-flight and the gate can never disagree
   * about what is dead. `doctor` told adopters what R3b would fail on; if the
   * two used separate logic that promise would be worth nothing.
   */
  /**
   * Whether any condition on this rule declares emptiness as its passing state.
   *
   * Concrete `false` default for the reason `globs()` records — an abstract
   * member breaks external subclasses. `RuleBuilder` overrides it by reading
   * its own conditions; the builders that take their condition as a
   * constructor argument have no cardinality condition to declare.
   */
  protected assertsCardinality(): boolean {
    return false
  }

  protected deadSelectorFindings(): ArchViolation[] {
    const project = this.getProject()
    if (project === undefined) return []
    // A condition that asserts CARDINALITY is satisfied by having no subjects,
    // so an unsatisfiable selector is this rule working rather than failing —
    // the pre-emptive guard `.should().notExist()` expresses. Declared by the
    // condition, never probed: evaluating any condition against `[]` returns no
    // violations, so probing answers "satisfied" for all of them.
    if (this.assertsCardinality()) return []
    const trees = this.globs()
    if (trees.length === 0) return []

    const universe = pathUniverse(project)
    const findings: ArchViolation[] = []
    for (const tree of trees) {
      // Only inside a tree that is dead as a whole: `or(dead, live)` is a
      // working rule, and reporting its dead branch is the false red the tree
      // model exists to prevent.
      if (!isDeadGlobTree(tree, universe)) continue
      for (const site of globSitesOf(tree)) {
        if (site.position !== 'selector') continue
        if (!isDeadSite(site, universe)) continue
        findings.push(this.deadSelectorViolation(site, universe, project))
      }
    }
    return findings
  }

  /**
   * The finding for one dead selector glob.
   *
   * Carries the SAME cause and advice `doctor` prints, from the same two
   * tables — a reader who ran the pre-flight must not be told something
   * different by the build that fails. Bugs 0031 and 0032 are why the tables
   * are worth reusing rather than paraphrasing: both were cases where the
   * cause stated was wrong for the input, and both were fixed in one place.
   *
   * `bypassFilters` makes it a configuration finding: `error` severity
   * regardless of `.asSeverity('warn')`, refused by `.excluding()`, and
   * skipped by diff and baseline (ADR-008 rule 1). A rule that can never have
   * subjects is not a violation you triage; it is a rule that does not work.
   */
  private deadSelectorViolation(
    site: GlobSite,
    universe: PathUniverse,
    project: ArchProject,
  ): ArchViolation {
    const described = this.describeRule()
    const name = described.id || described.rule || this.constructor.name
    const diagnosis = diagnoseGlob(site, universe, diskSet(project))
    const onDisk = diagnosis.onDisk === undefined ? '' : ON_DISK_ADVICE[diagnosis.onDisk]
    const cause = onDisk === '' ? FAULT_ADVICE[diagnosis.fault] : onDisk
    const advice =
      `This rule's selector ${site.origin} can never match anything in this project, ` +
      `so it has no subjects and cannot fail — ${cause}. ` +
      `Correct the glob, or remove the rule. ${UNSUPPRESSABLE}`
    return {
      rule: name,
      ruleId: described.id,
      element: site.glob,
      file: '',
      line: 0,
      message: advice,
      // Its own remedy, never the author's (bug 0021): their `suggestion` is
      // for a violation of the rule, and this says the rule cannot produce one.
      suggestion: advice,
      bypassFilters: true,
    }
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
