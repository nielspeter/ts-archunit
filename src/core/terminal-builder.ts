import type { ArchViolation } from './violation.js'
import { severityFor } from './violation.js'
import type { GlobNode } from './glob-site.js'
import type { GlobSite } from './glob-site.js'
import type { ArchProject } from './project.js'
import type { PathUniverse } from './path-universe.js'
import { pathUniverse } from './path-universe.js'
import { isDeadGlobTree, isDeadSite, globSitesOf } from './glob-evaluator.js'
import { isFaultPosition } from './glob-site.js'
import { diagnoseGlob, FAULT_ADVICE, ON_DISK_ADVICE } from './glob-diagnosis.js'
import { diskSet } from './disk-set.js'
import { emptyProjectAdvice, loadedNothing } from './empty-project-advice.js'
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

/**
 * Declaring both emptiness assertions is a contradiction, and 0069's appendix
 * says it "must fail at build time, not silently pick one".
 *
 * Thrown when the chain is built rather than reported as a finding: this is not
 * a property of the codebase under test, it is a rule that cannot be evaluated,
 * and the author is standing right there.
 *
 * `TypeError`, following `combinators.ts`'s "cannot mix Predicate objects and
 * TypeMatcher functions" — the same class of build-time misuse. A bare `Error`
 * was written first and this project's own `quality/typed-errors` rule rejected
 * it, which is the third time in this plan's implementation that the dogfooding
 * caught the new code.
 */
const CONTRADICTION =
  '.expectEmpty() and .expectNonEmpty() on the same rule contradict each other — ' +
  'a selection cannot be required to be both empty and non-empty. Keep the one you mean.'

/**
 * What a family returns from `collectViolations()` — plan 0098.
 *
 * Part of the extension surface [ADR-010](../../adr/010-the-extension-surface-is-a-contract.md)
 * rule 1 names as contract, so changing this shape is a breaking change.
 */
export interface CollectResult {
  /** The violations the family found. Unchanged in meaning from the array this replaced. */
  violations: ArchViolation[]
  /**
   * Units this family's own semantics examined — subjects, bodies, pairs, keys,
   * declared requirements. **Never a file count**: counting one layer too high
   * reads healthy on exactly the input this evidence exists to catch, which is a
   * rule whose own narrowing removed everything the project loaded.
   */
  examined: number
}

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
   * The declared-empty grammar — plan 0097, and [ADR-010](../../adr/010-the-extension-surface-is-a-contract.md)
   * rule 3(a).
   *
   * These lived on `RuleBuilder<T>`, so the smell family — the one bug 0066 is
   * filed against — could not reach them: that bug listed "is `.expectEmpty()`
   * reachable on a smell builder at all?" under Not measured, and the answer was
   * no. ADR-009 part 3 requires every family's grammar to expose a declaration
   * path, so they belong on the root every family shares.
   *
   * Booleans rather than registry membership, deliberately. `shallowClone` in
   * `copy()` carries an own property for free on every chain step, where a
   * `WeakSet` keyed on the builder would be lost at the first `copy()` — and the
   * threat model differs from the one that forced the cardinality registry,
   * which guards user-CONSTRUCTIBLE condition objects. These sit behind a
   * sanctioned method on a class whose only other audience is ADR-010's
   * contract.
   */
  protected _requireNonEmpty = false
  protected _expectEmpty = false

  /**
   * Assert that the predicate chain matches at least one subject. If the
   * filtered subject set is empty, the rule FAILS with a config-level
   * meta-finding instead of passing vacuously — the "0 === 0" false-green
   * ADR-008 forbids. Opt-in: legitimately-empty selections (e.g. "no
   * repositories yet") stay green without it. Built on the materialized
   * subject set (plan 0064); the finding bypasses diff/baseline (plan 0067).
   */
  expectNonEmpty(): this {
    if (this._expectEmpty) throw new TypeError(CONTRADICTION)
    const next = this.copy()
    next._requireNonEmpty = true
    return next
  }

  /**
   * Assert that this selector matches **nothing**, and fail the day it matches
   * something.
   *
   * Plan 0074 (R3b). Since an empty selection is now a failure by default, a
   * rule whose selection is legitimately empty needs a way to say so — and
   * 0069's appendix rejected `.allowEmpty()` for being "one word, silent
   * forever, typo or not, and nothing revisits it". This is the shape that
   * survived review, and the difference is that it is an **assertion**:
   *
   * ```ts
   * classes(p).that().haveDecorator('Deprecated')
   *   .expectEmpty()          // nothing is deprecated yet
   *   .should().beExported()
   *
   * // the day someone deprecates a class:
   * //   FAIL: .expectEmpty() asserted 0 subjects, found 1
   * ```
   *
   * An agent that reaches for this to silence a real typo gets a different
   * failure the moment the typo is fixed, and until then the intent is stated
   * in the rule where a reader sees it — rather than in a baseline, or nowhere.
   *
   * Symmetric with {@link expectNonEmpty} for the rule builders. A family may **refuse** the zero-arg form where a whole-rule notion of empty has no meaning — `CorrespondenceBuilder` throws, because it declares per side — so a consumer walking `TerminalBuilder[]` must not call it unguarded. Exactly symmetric, and the two together mean
   * the empty/non-empty question is always answerable from the rule text.
   * Declaring both is a contradiction and throws here rather than silently
   * picking one.
   */
  expectEmpty(): this {
    if (this._requireNonEmpty) throw new TypeError(CONTRADICTION)
    const next = this.copy()
    next._expectEmpty = true
    return next
  }

  /**
   * True when this rule's emptiness is DECLARED — plan 0097, consumed by 0098.
   *
   * The base answer is the whole-rule flag. It is `protected` and overridable
   * because a family whose declaration is not whole-rule must be able to say so:
   * `CorrespondenceBuilder` declares per SIDE and refuses the zero-arg form
   * entirely, so `_expectEmpty` is unreachable there and this default would
   * answer `false` for a rule whose every side the author declared — reporting a
   * finding that tells them to declare what they declared, which is ADR-008
   * rule 2's loop.
   *
   * PUBLIC, and forced rather than chosen — the same reason `assertsSomething()`
   * is: `DiagnosableRule` is a structural interface, and a protected member
   * cannot satisfy it. Plan 0096's preview is the first reader, and a preview
   * that ignored the declaration would report a finding on a rule the gate will
   * accept — over-reporting against the very thing it previews, which is the
   * rule 5 violation inside the migration that plan warns about.
   *
   * It exists now, ahead of the floor that reads it, for a reason worth stating:
   * a private version of this lived on `CorrespondenceBuilder` and was deleted
   * as dead code, correctly — but the deletion also removed the only expression
   * of the concept, so the override 0098 needs would have gone missing SILENTLY
   * rather than as the compile error a narrowed-visibility clash would have
   * produced. Declaring it here makes the coupling loud again.
   */
  declaresEmpty(): boolean {
    return this._expectEmpty
  }

  /**
   * How THIS family spells the declaration, for a remedy that names a real call.
   *
   * The sibling of `assertionAdvice()`, and it exists for the same reason: a
   * remedy is only verified to remediate if following it works, and the generic
   * `.expectEmpty()` is a `TypeError` on `CorrespondenceBuilder`, which declares
   * per side. Advice that names the one form the reader cannot call is ADR-008
   * rule 2's failure with extra confidence.
   *
   * Overriding `expectEmpty()` and not this leaves a remedy that throws, so the
   * classification census in `evidence-at-every-seam.test.ts` requires both
   * together rather than trusting the next author to remember.
   */
  emptyDeclarationAdvice(): string {
    // A preset user holds no builder, so `.expectEmpty()` is a call they cannot
    // make — the same "impossible on the path that produced it" fault this method
    // exists to fix for `CorrespondenceBuilder`, in the population that meets it
    // most. Plan 0089 shipped the reachable spelling; without this, every message
    // that would send them to it still named the unreachable one, and none of them
    // printed the id they would have to type (the default formatter prints the
    // chain description, never `ruleId`).
    //
    // The id is the discriminator because it is also the argument: a preset rule
    // id is exactly what goes in the array.
    const id = this._metadata?.id
    return id !== undefined && id.startsWith('preset/')
      ? `expectEmpty: ['${id}'] in this preset's options`
      : '.expectEmpty()'
  }

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
      // Gate-first for a dead SELECTOR, before `collectViolations()`: a rule whose
      // selector cannot match will walk the whole AST to select nothing.
      //
      // But NOT gate-first for a dead **discovery** glob, and that asymmetry is
      // plan 0080's whole design. Admitting discovery globs to the gate without
      // it is destructive rather than additive: this early return means the gate
      // REPLACES a builder's own finding rather than adding to it, and the slice
      // builders already produce a better one (`emptyDiscoveryViolation`). Review
      // measured the cost of getting this wrong — **15 slice tests, 13 of them
      // the whole bug-0009 remedy corpus**, whose stated subject is that each
      // branch's advice is true. Trading a rule 1 defect for a rule 2 defect.
      //
      // So the owner **declares itself** — `ownsDiscoveryDiagnosis()` — rather than
      // the gate naming who to skip. An "except slice" list would be the same
      // unchecked claim about who owns what that this file used to carry in a
      // comment, and that comment being wrong is what plan 0080 exists to fix.
      // The precedent is `assertsCardinality()` directly above: knowledge lives
      // with the builder that has it.
      //
      // A first attempt derived it instead — run `collectViolations()` and prefer
      // any `bypassFilters` finding it produced. That cannot work, and slice is
      // the counterexample: for a **partially** empty `assignedFrom` it produces
      // nothing *deliberately* (a slice with no files yet is legitimate, and that
      // guard was withdrawn before release for firing on real projects). So
      // "prefer what it produced" reads silence as "no opinion" when it is in
      // fact the opinion.
      const dead = this.deadSelectorFindings()
      if (dead.selector.length > 0) return dead.selector
      if (dead.discovery.length > 0 && !this.ownsDiscoveryDiagnosis()) return dead.discovery
      // Plan 0098 is the SEAM only: the evidence is now produced and discarded
      // here. Plan 0099 is where this stops being a discard and becomes a floor.
      // Deliberately behaviour-neutral — see this file's `CollectResult`.
      return this.collectViolations().violations
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
   *
   * **PUBLIC since plan 0098**, for the same structural reason as
   * `assertsSomething()` and `declaresEmpty()`: `diagnose()` reads it through a
   * structural interface and a protected member cannot satisfy one. It became a
   * reader the moment the rule-builder family started reporting evidence —
   * `.should().notExist()` examines zero subjects *because that is what it
   * asserts*, and previewing it as a fault tells the author their working rule
   * is broken. Caught by this repo's own 53-rule suite, on the one rule in it
   * that ends in `.notExist()`.
   *
   * Deliberately NOT folded into `declaresEmpty()`, though both suppress the
   * same finding. They are different facts and plan 0099 needs them apart: its
   * expiry branch reads the declaration flag alone, because `.notExist()` over a
   * selection that has grown is the condition doing its job, never a declaration
   * that has expired.
   */
  assertsCardinality(): boolean {
    return false
  }

  /**
   * Does this builder diagnose its own empty discovery?
   *
   * `false` — the gate reports a dead `discovery` glob, which is the fix for
   * [bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)'s
   * silence half: two of three cross-layer conditions reported **nothing** when a
   * layer resolved to no files.
   *
   * `true` — the builder owns it, and the gate stays out. Two builders override,
   * and for different reasons, which is the thing to understand before adding a
   * third:
   *
   * - `SliceRuleBuilder` returns a constant `true`, because its discovery
   *   semantics are **not** per-tree and cannot be expressed by a position filter
   *   (below). Nothing about that varies by condition.
   * - `PairFinalBuilder` **asks its condition**, via the registry in
   *   `owns-empty-discovery.ts` (plan 0081). There, ownership does vary by
   *   condition, and a blanket `true` once suppressed the gate for the one
   *   condition that did not self-report — which is why this used to say
   *   "`SliceRuleBuilder` is the one that does" and was wrong.
   *
   * A hand-maintained roster of which builders override is the defect class plan
   * 0081 was filed to remove, so this names the two shapes rather than the two
   * classes:
   *
   * | builder | one dead tree among live ones |
   * | --- | --- |
   * | `crossLayer` | a **fault** — that layer's pairs are unchecked |
   * | slice `assignedFrom` | **legitimate** — a slice with no files yet is a real shape |
   *
   * `slice-rule-builder.ts` records that second guard being withdrawn before
   * release for firing on real projects: "a layer not created yet, and the
   * `strict-boundaries` scaffold itself". Slice already handles the all-empty case
   * with a better message than the gate's, so it owns both halves.
   *
   * Declared, never named from the outside. A list of exceptions in the gate is
   * an unchecked claim about who owns what — which is exactly the comment this
   * plan was filed to correct.
   */
  protected ownsDiscoveryDiagnosis(): boolean {
    return false
  }

  /**
   * A dead glob's findings, **split by whether the builder might own the message**.
   *
   * `selector` and `discovery` are both faults (`isFaultPosition`), but the caller
   * treats them differently: a dead selector short-circuits before the AST walk,
   * while a dead discovery glob defers to whatever the builder produced. An
   * `ArchViolation` carries no position, so the split happens here rather than
   * being recovered by inspecting findings downstream.
   */
  protected deadSelectorFindings(): { selector: ArchViolation[]; discovery: ArchViolation[] } {
    // Annotated: inferred, this is `{ selector: never[]; discovery: never[] }`,
    // and it is returned from four early-exit paths. Nothing mutates it today —
    // but a `push` onto a `never[]` is a type error whose message points at the
    // literal rather than at the caller that meant to add a finding.
    const empty: { selector: ArchViolation[]; discovery: ArchViolation[] } = {
      selector: [],
      discovery: [],
    }
    const project = this.getProject()
    if (project === undefined) return empty
    // A condition that asserts CARDINALITY is satisfied by having no subjects,
    // so an unsatisfiable selector is this rule working rather than failing —
    // the pre-emptive guard `.should().notExist()` expresses. Declared by the
    // condition, never probed: evaluating any condition against `[]` returns no
    // violations, so probing answers "satisfied" for all of them.
    if (this.assertsCardinality()) return empty
    const trees = this.globs()
    if (trees.length === 0) return empty

    // The project loaded nothing, so no glob can match and none of them is at
    // fault — [bug 0048](../../bugs/fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md).
    //
    // Without this the gate reported every selector glob dead and told the
    // reader to *"Correct the glob, or remove the rule"*, which is a remedy for
    // a fault that is not theirs: measured on an empty tsconfig, the glob was
    // correct and the tsconfig had loaded 0 files. `diagnose()` short-circuited
    // here (bug 0031) and `SliceRuleBuilder` had its own branch; this gate had
    // neither, so the wrong remedy sat on the path every `modules()`,
    // `classes()`, `functions()` and `types()` rule takes.
    //
    // One finding for the project, not one per glob — the identity of this fault
    // is the tsconfig, which is what ADR-008 rule 4 asks be named, and it is why
    // `diagnose()` dedupes by project too.
    if (loadedNothing(project))
      return { selector: [this.emptyProjectViolation(project)], discovery: [] }

    const universe = pathUniverse(project)
    const selector: ArchViolation[] = []
    const discovery: ArchViolation[] = []
    for (const tree of trees) {
      // Only inside a tree that is dead as a whole: `or(dead, live)` is a
      // working rule, and reporting its dead branch is the false red the tree
      // model exists to prevent.
      if (!isDeadGlobTree(tree, universe)) continue
      for (const site of globSitesOf(tree)) {
        // `isFaultPosition`, shared with `diagnose()` — the two used inverse
        // hand-maintained lists and disagreed about exactly `discovery`, which
        // is why `doctor` reported a dead layer glob and the build did not.
        if (!isFaultPosition(site.position)) continue
        if (!isDeadSite(site, universe)) continue
        const finding = this.deadSelectorViolation(site, universe, project)
        if (site.position === 'discovery') discovery.push(finding)
        else selector.push(finding)
      }
    }
    return { selector, discovery }
  }

  /**
   * The finding for a project that loaded no source files.
   *
   * Deliberately **not** `deadSelectorViolation` with different text: that one
   * names a glob as its `element`, and here no glob is at fault. The element is
   * the rule, matching how `diagnose()` reports this state.
   *
   * Carries the same advice `doctor` prints, from the one owner
   * (`empty-project-advice.ts`) — the parity `deadSelectorViolation`'s docstring
   * claims for the whole gate, which was false for this input until bug 0048.
   */
  protected emptyProjectViolation(project: ArchProject): ArchViolation {
    const described = this.describeRule()
    const name = described.id || described.rule || this.constructor.name
    // `emptyProjectAdvice` deliberately returns a lowercase, period-less clause so
    // each caller can frame it. Capitalised inline rather than via a shared helper:
    // `slice-rule-builder.ts` has its own local `capitalize` and core has none, so
    // importing across that boundary for one character would be the worse trade.
    const shared = emptyProjectAdvice(project)
    const advice = `${shared.charAt(0).toUpperCase()}${shared.slice(1)}. ${UNSUPPRESSABLE}`
    return {
      rule: name,
      ruleId: described.id,
      element: name,
      file: '',
      line: 0,
      message: advice,
      // Its own remedy, never the author's (bug 0021).
      suggestion: advice,
      bypassFilters: true,
    }
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
    // Position-aware in BOTH clauses, not just the noun (plan 0080).
    //
    // Admitting `discovery` globs made this sentence wrong twice over for them.
    // The noun was the obvious half — a `smells.duplicateBodies().inFolder()` glob
    // is not a "selector". The **consequence clause** was the part that actually
    // lied: "it has no subjects and cannot fail" describes a rule that selects
    // nothing, while a dead discovery glob means the rule discovered nothing to
    // compare — there may be plenty of subjects. Review flagged that fixing the
    // noun alone ships a grammatical sentence that is still false.
    const isDiscovery = site.position === 'discovery'
    const what = isDiscovery ? 'discovery glob' : 'selector'
    const consequence = isDiscovery
      ? 'so it discovers nothing to check and cannot fail'
      : 'so it has no subjects and cannot fail'
    const advice =
      `This rule's ${what} ${site.origin} can never match anything in this project, ` +
      `${consequence} — ${cause}. ` +
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
   * Subclasses implement this to collect and evaluate violations, **and to say
   * how many units they examined while doing it** — plan 0098.
   *
   * Called lazily during `.check()` / `.warn()`.
   *
   * ## Why the return type carries the evidence
   *
   * Plan 0096 gave five families an `examinedUnits()` accessor and `diagnose()`
   * reads it — but it is **optional**, and four waves of vacuity guards have each
   * closed their own enumeration only for the next family to land outside it
   * ([ADR-009](../../adr/009-a-pass-is-constructed-from-evidence.md)'s Context
   * table). A guard is something you can forget to add. A required return type is
   * not: a new family cannot compile without stating its number.
   *
   * Nothing acts on `examined` in this release — plan 0099 adds the floor that
   * fails a rule which produced nothing from nothing. This plan ships the seam
   * alone so that the break to
   * [ADR-010](../../adr/010-the-extension-surface-is-a-contract.md)'s contract
   * lands in a commit whose only job is the break.
   *
   * ## What the compiler cannot force, and what does
   *
   * The type forces the field to **exist**; it cannot force it to mean anything,
   * and every implementer could satisfy it with `examined: 0`. That is a real
   * hole and it is half-closed:
   *
   * - **The numbers are guarded.** Every family exposes `examinedUnits()` and
   *   `tests/core/evidence-at-every-seam.test.ts` requires each to show its count
   *   **responding to input** — zero on a narrowed selection, non-zero on a wide
   *   one, over a corpus that loaded files either way. A constant fails one half
   *   of that pair whichever constant it is; measured, six sabotage rows caught.
   * - **The WIRING is not, and cannot be, in this release.** `examined` is
   *   produced here and discarded by the one consumer, so nothing observes it:
   *   rewriting any family's `collectViolations()` to `examined: 0` while leaving
   *   `examinedUnits()` correct leaves the entire suite green — measured, for the
   *   smell family and for `RuleBuilder`. An ADR-008 rule 5 equivalence, recorded
   *   rather than guarded by an instrument invented for it.
   *
   * **That equivalence expires in plan 0099**, which reads `examined` at the
   * floor. The commit that gives a claim its first reader is the commit that must
   * retire it — this repo has already had one recorded equivalence outlive its
   * truth by exactly one commit (`CorrespondenceBuilder.declaresEmpty`), and a
   * sabotage row for the wiring belongs in 0099's matrix on day one.
   */
  protected abstract collectViolations(): CollectResult
}
