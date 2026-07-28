import type { ArchProject } from './project.js'
import type { Predicate } from './predicate.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'
import type { RuleDescription } from './rule-description.js'
import type { DeclaredGlob, GlobNode } from './glob-site.js'
import { countDeclaredGlobs, stampGlobs } from './glob-site.js'
import { TerminalBuilder } from './terminal-builder.js'

/**
 * Abstract base class for the predicate/condition rule builders.
 *
 * Concrete entry points (plans 0007+) extend this and:
 * 1. Implement `getElements()` to return the elements to check
 * 2. Add predicate methods that call `addPredicate()`
 * 3. Add condition methods that call `addCondition()`
 *
 * The builder accumulates predicates and conditions. Nothing executes
 * until a terminal method (`.check()`, `.warn()`, `.severity()`) is called.
 *
 * Extends `TerminalBuilder`, which owns everything that is not about the
 * predicate/condition pipeline: `because`, `rule`, `excluding`, `violations`,
 * `check`, `warn`, `asSeverity`, `severity`. Those used to exist twice, once
 * here and once there, and the two copies had already drifted — this class's
 * `excluding()` documented matching against element/file/message while the
 * other still claimed element only, and the more accurate one was the one
 * fewer builders inherited.
 *
 * The cost of the second root was not duplication, it was silent
 * non-coverage: the materialized subject set (plan 0064) and the
 * empty-selector guard (plan 0067) were added here and never reached the
 * seven builders on the other branch. Plan 0069 needs `globs()` to reach all
 * thirteen, so it goes on the root and the root is now singular.
 */
export abstract class RuleBuilder<T> extends TerminalBuilder {
  protected _predicates: Predicate<T>[] = []
  protected _conditions: Condition<T>[] = []
  protected _phase: 'predicate' | 'condition' = 'predicate'
  // Plan 0070: state for the assertion-less remedies. `_phase` cannot carry
  // either fact — `.should().that()` legally returns to the predicate phase,
  // so `_phase === 'predicate'` does not mean `.should()` was never reached,
  // and a predicate applied after `should()` leaves no other trace.
  protected _reachedShould = false
  protected _misplaced: string[] = []
  protected _requireNonEmpty = false

  constructor(protected readonly project: ArchProject) {
    super()
  }

  // --- Chain methods (grammar transitions) ---

  /**
   * Begin the predicate phase. Returns a COPY, per bug 0016 — a held selection
   * is never edited by narrowing it. Every ordinary chain is unaffected,
   * because the copy is what the chain continues on; what changed is that
   * `held.that()...` no longer reaches back into `held`.
   * Purely a readability marker — `.that().haveNameMatching(...)` reads like English.
   * Explicitly resets phase to 'predicate' — defensive against `.should().that()` misuse.
   */
  that(): this {
    const next = this.copy()
    next._phase = 'predicate'
    return next
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
    fork._reachedShould = true
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
   * Assert that the predicate chain matches at least one subject. If the
   * filtered subject set is empty, the rule FAILS with a config-level
   * meta-finding instead of passing vacuously — the "0 === 0" false-green
   * ADR-008 forbids. Opt-in: legitimately-empty selections (e.g. "no
   * repositories yet") stay green without it. Built on the materialized
   * subject set (plan 0064); the finding bypasses diff/baseline (plan 0067).
   */
  expectNonEmpty(): this {
    const next = this.copy()
    next._requireNonEmpty = true
    return next
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
   * The selector and condition globs this rule declares.
   *
   * `position` is derived, not declared: a predicate registered while
   * `_phase` is `'predicate'` is a selector, one registered after `.should()`
   * is a condition. That is a structural fact about where the code is, which
   * is why it is not on `DeclaredGlob` for an author to get wrong.
   */
  override globs(): readonly GlobNode[] {
    const trees: GlobNode[] = []
    for (const predicate of this._predicates) {
      if (predicate.globs) {
        const count = countDeclaredGlobs(predicate.globs)
        trees.push(
          stampGlobs(predicate.globs, 'selector', (g) =>
            describeOrigin(predicate.description, g, count),
          ),
        )
      }
    }
    for (const condition of this._conditions) {
      if (condition.globs) {
        const count = countDeclaredGlobs(condition.globs)
        trees.push(
          stampGlobs(condition.globs, 'condition', (g) =>
            describeOrigin(condition.description, g, count),
          ),
        )
      }
    }
    return trees
  }

  /**
   * The project this rule was built against.
   *
   * Used by `within()` to create scoped builders, and by `doctor` to find the
   * project to compare globs against — which must be the one the rules
   * actually ran on, not one the CLI guessed at.
   */
  getProject(): ArchProject {
    return this.project
  }

  /**
   * Whether this rule asserts anything about the elements it selected.
   *
   * `.that()...` with no `.should()` selects a set and then says nothing about
   * it, so it can never fail — proposal 019. Exposed as a method because
   * `_conditions` is protected and `doctor` must not duck-type a private name.
   */
  override assertsSomething(): boolean {
    return this._conditions.length > 0
  }

  /**
   * Three assertion-less states, three remedies (plan 0070). Branching on
   * `_reachedShould`/`_misplaced`, never `_phase` — `.should().that()` lands
   * in the predicate phase having reached `.should()`, and would be told a
   * verifiable falsehood by any phase-derived message.
   */
  override assertionAdvice(): string {
    if (!this._reachedShould) {
      return (
        'this rule never reached .should(), so it asserts nothing and can never fail. ' +
        'Add .should() and a condition, or delete the rule.'
      )
    }
    if (this._misplaced.length > 0) {
      const names = this._misplaced.map((d) => `"${d}"`).join(', ')
      const verb =
        this._misplaced.length === 1
          ? 'is a predicate, which filters'
          : 'are predicates, which filter'
      return (
        `this rule asserts nothing: ${names} ${verb} subjects rather than asserting ` +
        `anything about them. Move ${this._misplaced.length === 1 ? 'it' : 'them'} before .should(), then add a condition.`
      )
    }
    return (
      'this rule reached .should() but no condition follows, so it asserts nothing and can ' +
      'never fail. Add a condition after .should() — or, if this rule is generated from ' +
      'configuration, skip generating it when there is nothing to assert; if it comes from ' +
      'a preset (ruleId "preset/..."), report it to the preset\'s author.'
    )
  }

  /**
   * The root's collection hook. `evaluate()` is this builder's pipeline —
   * filter by predicates, run conditions, add the empty-selector finding —
   * and the root's terminal methods do the rest.
   */
  protected collectViolations(): ArchViolation[] {
    return this.evaluate()
  }

  // --- Protected: for subclasses ---

  /**
   * Register a predicate. Called by concrete builder methods like
   * `.haveNameMatching()`, `.extend()`, etc.
   */
  protected addPredicate(predicate: Predicate<T>): this {
    const next = this.copy()
    next._predicates.push(predicate)
    // A predicate-only method used after `.should()` (dual-use methods
    // dispatch to conditions in that phase and never land here). Recorded so
    // the assertion-less remedy can say "move it before .should()" — the one
    // state whose fix is not "add a condition" (plan 0070, state 2).
    if (next._phase === 'condition') {
      next._misplaced.push(predicate.description)
    }
    return next
  }

  /**
   * Register a condition. Called by concrete builder methods like
   * `.notContain()`, `.notExist()`, etc.
   */
  protected addCondition(condition: Condition<T>): this {
    const next = this.copy()
    next._conditions.push(condition)
    return next
  }

  /**
   * Subclasses implement this to return the elements to check.
   * Called lazily during `.check()` / `.warn()`.
   */
  protected abstract getElements(): T[]

  /**
   * An independent copy, carrying **both** lists. See `TerminalBuilder.copy`.
   *
   * `fork()` below clears the conditions because it exists for `should()`;
   * this one must not, or `.should().beExported().that().areAsync()` would
   * silently drop `beExported` — a rule that asserted something turned into
   * one that asserts nothing, by the fix for a bug about rules that assert
   * nothing.
   */
  protected override copy(): this {
    const clone = super.copy()
    clone._predicates = [...this._predicates]
    clone._conditions = [...this._conditions]
    clone._misplaced = [...this._misplaced]
    return clone
  }

  /**
   * A copy with the conditions cleared. Used by `.should()`.
   *
   * The clearing is all that distinguishes this from `copy()` — its original
   * job, "support named selections without mutation", is what `copy()` does as
   * of bug 0016. And the clearing is a defect in its own right
   * ([bug 0020](../../bugs/0020-should-twice-silently-drops-the-first-assertion.md)):
   * a second `.should()` on a builder that already carries a condition
   * discards it, so `.should().notExist().should().beExported()` enforces only
   * the second and loses four findings with no output. Measured. It ships with
   * R3b, because the rule it produces — zero conditions — must fail before the
   * silent drop can be turned into an over-report.
   */
  protected fork(): this {
    const fork = this.copy()
    fork._conditions = []
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
   * (the post-`.that()` set), before any condition runs. Shared by the
   * `RuleBuilder` execution pipeline (`evaluate`) and the public `subjects()`
   * accessor so those two cannot diverge (F1). Note: a few builders keep their
   * own separate materialization for other paths (e.g. `CallRuleBuilder`'s
   * `within()` matcher) — those are not routed through here.
   */
  protected filterElements(): T[] {
    // AND semantics — every predicate must match.
    return this.getElements().filter((element) =>
      this._predicates.every((predicate) => predicate.test(element)),
    )
  }

  /**
   * Build the config-level meta-finding for an empty selector under
   * `.expectNonEmpty()`. A typed literal (no `createViolation` — there is no
   * Node), ADR-005-clean, flagged `bypassFilters` so diff/baseline keep it.
   */
  private emptySelectionViolation(): ArchViolation {
    const description = this.buildRuleDescription() || 'selector'
    return {
      rule: description,
      ruleId: this._metadata?.id,
      element: this._metadata?.id ?? description,
      file: '',
      line: 0,
      message:
        'Selector matched 0 subjects, but .expectNonEmpty() requires at least one — ' +
        'likely a wrong glob or filter. If an empty match is valid here, remove .expectNonEmpty().',
      because: this._reason,
      // Its own remedy, and only its own. The two actions below are the whole set
      // for this finding, and both are true whichever way the selector is empty.
      suggestion:
        'Widen the selector until it matches at least one subject, or drop ' +
        '.expectNonEmpty() if matching nothing is valid here.',
      // No `suggestion`/`docs` from `this._metadata` (bug 0021). This finding says
      // the selector matched nothing; the author's remedy is for a violation of the
      // rule, and inheriting it prints an unrelated `Fix:`. The guard in
      // `execute-rule.ts` cannot help here — this producer was copying the fields
      // itself, which is why the two shipped config-finding producers disagreed
      // about policy and the misleading one won.
      bypassFilters: true,
    }
  }

  /**
   * Execute the full pipeline: filter elements with predicates,
   * evaluate conditions, return violations.
   */
  private evaluate(): ArchViolation[] {
    // Step 1+2: Get elements and narrow by predicates (see filterElements).
    const filtered = this.filterElements()

    // Step 3: No elements match the predicate chain.
    if (filtered.length === 0) {
      // Opt-in non-vacuity guard (plan 0067): a selector the author asserted
      // must match is a config error when empty, not a pass. Meta-finding —
      // bypasses diff/baseline so it survives the standard CI mode (ADR-008).
      if (this._requireNonEmpty) {
        return [this.emptySelectionViolation()]
      }
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

/**
 * Where a glob was written, for the message.
 *
 * The predicate's own description already names the API and the glob
 * (`reside in folder matching "**\/src/x/**"`), so the origin is that
 * description unless one predicate declared several globs — in which case the
 * glob is appended to tell them apart.
 */
function describeOrigin(description: string, glob: DeclaredGlob, siteCount: number): string {
  // Keyed on the COUNT, not on whether the description happens to contain the
  // glob. A variadic predicate's description contains every one of its globs
  // (`import from "**/a/**", "**/b/**"`), so a substring test collapsed the
  // one case this exists to separate.
  return siteCount > 1 ? `${description} ("${glob.glob}")` : description
}
