import type { RuleDescription } from '../core/rule-description.js'
import type { CollectResult } from '../core/terminal-builder.js'
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { GlobNode } from '../core/glob-site.js'
import { globAnyOf, stampGlobs } from '../core/glob-site.js'
import type { GlobFault } from '../core/glob-diagnosis.js'
import { FAULT_ADVICE, GLOB_DOCS, syntacticFault } from '../core/glob-diagnosis.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import { emptyProjectAdvice, loadedNothing } from '../core/empty-project-advice.js'
import type { Slice, SliceDefinition } from '../models/slice.js'
import {
  resolveByMatching,
  resolveByDefinition,
  matchingGlobPrefix,
  matchingGlobPattern,
} from '../models/slice.js'
import type { ImportOptions } from '../core/import-options.js'
import { splitGlobArgs } from '../core/import-options.js'
import {
  beFreeOfCycles as beFreeOfCyclesCondition,
  respectLayerOrder as respectLayerOrderCondition,
  notDependOn as notDependOnCondition,
} from '../conditions/slice.js'
import { isProjectRelative } from '../core/project-relative.js'

/**
 * How slices were sourced. Recorded so an empty-discovery failure can state the
 * remedy that actually works: `matching()` takes one glob whose literal prefix
 * locates the slices, `assignedFrom()` takes globs matched against the whole
 * absolute path, and their failure modes differ — so one generic hint would
 * misdirect half of all callers (ADR-008 — a failure must carry its sanctioned
 * fix). Declared before the class's own doc block so it does not detach it.
 */
type DiscoverySource =
  | { readonly mode: 'matching'; readonly glob: string }
  | {
      readonly mode: 'assignedFrom'
      readonly entries: readonly { readonly name: string; readonly glob: string }[]
    }

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
/** The shared advice starts lowercase for `diagnose`; here it opens a sentence. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export class SliceRuleBuilder extends TerminalBuilder {
  private _slices: Slice[] = []
  private _discovery?: DiscoverySource
  private _conditions: Condition<Slice>[] = []

  constructor(private readonly project: ArchProject) {
    super()
  }

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
    const next = this.copy()
    next._discovery = { mode: 'matching', glob }
    next._slices = resolveByMatching(this.project, glob)
    return next
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
    const entries = Object.entries(definition).map(([name, glob]) => ({ name, glob }))
    const next = this.copy()
    next._discovery = { mode: 'assignedFrom', entries }
    next._slices = resolveByDefinition(this.project, definition)
    return next
  }

  /** The project this rule was built against. See `RuleBuilder.getProject`. */
  getProject(): ArchProject {
    return this.project
  }

  /**
   * The discovery globs this rule was scoped with.
   *
   * `assignedFrom` fans out into one slice per entry, so each entry is its own
   * tree: one dead layer glob is one empty slice, and folding them into an
   * `any` node would say "no fault unless every slice is empty" — a false
   * green. This is the same reason a preset's option list is not an `any`
   * node.
   *
   * `matching()` needs no `base` special case, because it declares the glob
   * `parseMatchingGlob` produces rather than the one the author wrote — and
   * that one is already anchored. Declaring the author's spelling and
   * exempting it via `base` was the earlier design, and it reported every
   * nested-layout rule as dead while looking correct on a flat fixture.
   */
  override globs(): readonly GlobNode[] {
    if (!this._discovery) return []
    if (this._discovery.mode === 'matching') {
      // Declare the glob picomatch is given, not the one the author wrote.
      // `parseMatchingGlob` strips './' and '**/', normalises a trailing
      // slash, and appends '*/**' — so the author's spelling is matched
      // against nothing at runtime and declaring it reports every correct
      // nested-layout rule as dead. `origin` keeps the spelling, which is what
      // the reader needs to find the line.
      const authored = this._discovery.glob
      // `resolveByMatching` bails before matching anything when the glob has no
      // literal directory prefix ('*', '**', 'src'), because the slice name is
      // the segment after that prefix and there is none. Decidable from the
      // glob alone, so declare a glob that cannot match rather than let the
      // pre-flight stay silent about a rule the runtime guard will fail.
      const unresolvable = matchingGlobPrefix(authored) === ''
      return [
        stampGlobs(
          globAnyOf([unresolvable ? NEVER_MATCHES : matchingGlobPattern(authored)], 'file-path'),
          'discovery',
          () => `matching("${authored}")`,
        ),
      ]
    }
    return this._discovery.entries.map((entry) =>
      stampGlobs(
        // `base: 'normalized'` for a project-relative glob — bug 0033. The
        // anchor check calls an unanchored glob dead against absolute paths,
        // and since this entry point now resolves one against the project root
        // it stops being dead exactly when it starts working. Without this,
        // `doctor` reds a rule that discovers slices correctly: measured, a
        // relative `assignedFrom` glob gave 0 violations and a `dead-glob`
        // diagnosis in the same run.
        globAnyOf(
          [entry.glob],
          'file-path',
          isProjectRelative(entry.glob) ? 'normalized' : 'absolute',
        ),
        'discovery',
        (g) => `assignedFrom({ ${entry.name}: "${g.glob}" })`,
      ),
    )
  }

  /**
   * An independent copy, carrying the condition list and the resolved slices.
   *
   * `_slices` is replaced wholesale by both discovery methods, so only the
   * condition array needs its own copy — but it is listed here anyway, because
   * the next person to add a field will read this method, not the two callers.
   */
  protected override copy(): this {
    const clone = super.copy()
    clone._slices = [...this._slices]
    clone._conditions = [...this._conditions]
    return clone
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
  /**
   * @param options - `ignoreTypeImports` defaults to **true**: a type-only import
   *   is erased at compile time and creates no runtime dependency, so counting it
   *   as a cycle edge reports cycles that cannot exist (plan 0084). Pass
   *   `{ ignoreTypeImports: false }` to count type-only edges too.
   *   NOT a way back to the pre-0.47 graph: since v0.48.0 re-exports are counted as
   *   well, so type edges plus re-export edges is WIDER than 0.46.1 ever was.
   */
  beFreeOfCycles(options?: ImportOptions): this {
    const next = this.copy()
    next._conditions.push(beFreeOfCyclesCondition(options))
    return next
  }

  /**
   * Assert that slices respect a layered dependency order.
   * Layer N may depend on layers N+1, N+2, ... but NOT on layers with lower index.
   *
   * @param layers - Ordered layer names from highest to lowest
   */
  respectLayerOrder(layers: string[], options: ImportOptions): this
  respectLayerOrder(...layers: string[]): this
  respectLayerOrder(...args: [string[], ImportOptions] | string[]): this {
    // Split and re-dispatch rather than spreading `args` straight through: TypeScript
    // cannot match a tuple-union spread to an overload, and ADR-005 bars the `as` that
    // would force it. `splitGlobArgs` exists for exactly this (it removed ten casts).
    const { globs: layers, options } = splitGlobArgs(args)
    const next = this.copy()
    next._conditions.push(
      options === undefined
        ? respectLayerOrderCondition(...layers)
        : respectLayerOrderCondition(layers, options),
    )
    return next
  }

  /**
   * Assert that no slice depends on any of the listed slices.
   *
   * **Type-only edges COUNT by default here**, unlike `beFreeOfCycles()`. It looks
   * inconsistent and it is deliberate: a cycle is about runtime module-initialization
   * order, so an erased edge cannot contribute to one — but isolation is about
   * *coupling*, and a type-only dependency on `legacy` is still a dependency on
   * `legacy` that breaks when `legacy` is deleted. This matches `dependOn` and
   * `notImportFrom` as shipped. Pass `{ ignoreTypeImports: true }` to disagree.
   *
   * Counts every edge kind `notImportFrom()` counts, including `import('…')` and
   * `type X = import('…').Y`. `require()` is not counted (ESM-only, ADR-004).
   *
   * @param args - Forbidden slice names, or `(names[], options)`
   *
   * @example
   * .should().notDependOn('legacy', 'deprecated')
   * .should().notDependOn(['legacy'], { ignoreTypeImports: true })
   */
  notDependOn(sliceNames: string[], options: ImportOptions): this
  notDependOn(...sliceNames: string[]): this
  notDependOn(...args: [string[], ImportOptions] | string[]): this {
    const { globs: sliceNames, options } = splitGlobArgs(args)
    const next = this.copy()
    next._conditions.push(
      options === undefined
        ? notDependOnCondition(...sliceNames)
        : notDependOnCondition(sliceNames, options),
    )
    return next
  }

  override assertsSomething(): boolean {
    return this._conditions.length > 0
  }

  override assertionAdvice(): string {
    return (
      'this rule has no condition, so it asserts nothing and can never fail. Add a ' +
      'condition after .should(), e.g. beFreeOfCycles(), respectLayerOrder(...) or ' +
      'notDependOn(...).'
    )
  }

  /**
   * Named by id when one is set, else by the rule description (plan 0070 §4).
   * The inherited root version says 'unnamed' for every id-less rule, which
   * made three of the assertion hooks unlocatable in a doctor report.
   */
  override describeRule(): RuleDescription {
    // The rule's own description, not a call-site locator. An earlier revision
    // derived a bounded name from `_discovery` so the withdrawn runtime
    // warning would not carry ten filenames — but `explain --format agent`
    // reads this field, and consumers commit that output into their agent's
    // prompt, so bounding it stripped the condition (the only architectural
    // imperative in the line) from every id-less slice rule.
    return {
      ...super.describeRule(),
      rule: this._metadata?.id ?? this.buildRuleDescription(),
    }
  }

  /**
   * Slice discovery is not per-tree, so the gate must stay out (plan 0080).
   *
   * `assignedFrom` fans out one glob tree per entry, and a single dead entry among
   * populated siblings is a dead *tree* — which the gate would report. That guard
   * was written and **withdrawn before release** for firing on legitimate
   * projects (see `collectViolations` below): a layer not created yet, and the
   * `strict-boundaries` scaffold itself.
   *
   * The all-empty case is handled here too, with a message the gate cannot match
   * — it names the discovery mode and its remedy (bug 0009's corpus). So this
   * builder owns both halves.
   *
   * **Why this is a builder-level `true` while `PairFinalBuilder` asks its
   * condition** (`owns-empty-discovery.ts`, plan 0081): there, ownership varies by
   * condition, and a blanket `true` once suppressed the gate for the one condition
   * that did not self-report. Here nothing varies — the reason is a property of
   * `assignedFrom`'s fan-out, identical for every condition reachable through this
   * builder. The asymmetry reflects the discovery models, not an oversight.
   */
  protected override ownsDiscoveryDiagnosis(): boolean {
    return true
  }

  /**
   * Slices holding at least one file — plan 0098.
   *
   * Counting `_slices.length` would count the SHAPE of the discovery rather than
   * what was examined: `assignedFrom()` returns one slice per key whether or not
   * anything matched, so the empty case is "every slice has no files", never "no
   * slices" (arch-014 I1) — which is the same condition this family already
   * fails closed on.
   */
  examinedUnits(): number {
    return this._slices.filter((slice) => slice.files.length > 0).length
  }

  protected collectViolations(): CollectResult {
    // Discovery non-vacuity (ADR-008 / plan 0067): a slice selection that
    // resolved to no slices — or slices that matched no files — discovered
    // nothing, so it enforces nothing. Fail with a config-level meta-finding
    // (bypasses diff/baseline) rather than passing vacuously. `assignedFrom()`
    // returns one slice per key regardless of matches, so the empty case is
    // "every slice has no files", not "no slices" (arch-014 I1).
    if (this._slices.length === 0 || this._slices.every((slice) => slice.files.length === 0)) {
      // Plan 0098: this family ALREADY fails closed here, and has since 0067 —
      // a config-level meta-finding, not a vacuous pass. The floor 0099 adds is a
      // generalisation of this branch, not an invention. `examined` is 0 on the
      // same condition that produces the finding.
      return { violations: [this.emptyDiscoveryViolation()], examined: 0 }
    }

    // Every slice condition is a statement about relationships BETWEEN slices, so a
    // single slice makes all of them unfalsifiable: `beFreeOfCycles` drops
    // intra-slice edges, and `respectLayerOrder` / `notDependOn` have no second
    // slice to relate to. This is not a hypothetical — a glob that silently
    // collapsed to one mega-slice turned a real cycle green twice while every other
    // guard stayed quiet, so the count itself has to be a finding (ADR-008).
    // NOTE: two further guards were prototyped here — failing when discovery yields
    // exactly one non-empty slice (every inter-slice condition is then
    // unfalsifiable), and when one slice is empty among populated siblings (the
    // conditions silently skip names they cannot resolve). Both catch real
    // false-greens, and both were withdrawn before release: they fire on
    // legitimate projects (a one-feature repo, a layer not created yet, and the
    // `strict-boundaries` scaffold itself) with no opt-out, and their remedies were
    // written for one input and emitted for all of them. They return once the
    // remedy is executable data and an opt-out exists, mirroring
    // `correspondence().allowEmpty(name)`.

    const context: ConditionContext = {
      rule: this.buildRuleDescription(),
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    const violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(this._slices, context))
    }
    // Slices holding at least one file. Counting `_slices.length` would count the
    // shape of the discovery rather than what was examined: `assignedFrom()`
    // returns one slice per key whether or not anything matched, so the empty
    // case is "every slice has no files", never "no slices" (arch-014 I1).
    return { violations, examined: this.examinedUnits() }
  }

  private buildRuleDescription(): string {
    const sliceDesc = this._slices.map((s) => s.name).join(', ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    return `slices [${sliceDesc}] should ${conditionDesc}`
  }

  /** Config-level meta-finding for empty slice discovery (plan 0067). */
  private emptyDiscoveryViolation(): ArchViolation {
    return this.metaViolation(this.emptyDiscoveryMessage())
  }

  /**
   * A config-level finding: the rule is misconfigured, so it checks nothing.
   *
   * Deliberately does NOT carry the rule author's `suggestion`/`docs`. Those
   * describe how to fix a *real* violation of the rule ("Split the cycle"), and the
   * formatter renders `suggestion` under `Fix:` — the field an agent obeys. Pairing
   * a configuration message with an unrelated `Fix:` is a false remedy by
   * juxtaposition, no matter how accurate each half is on its own.
   */
  private metaViolation(message: string): ArchViolation {
    const id = this._metadata?.id ?? 'slices'
    return {
      rule: id,
      ruleId: this._metadata?.id,
      element: id,
      file: '',
      line: 0,
      message,
      because: this._reason,
      // Its own remedy, not the rule author's (bug 0021). Deliberately generic:
      // the specific, per-branch diagnosis is already in `message`, where
      // `emptyDiscoveryMessage` derives it and — per the comment there — each
      // branch is reachable only when its advice is actually true. Restating that
      // in `suggestion` would mean two texts to keep in agreement, which is the
      // drift this project keeps paying for. So the `Fix:` line names the two
      // actions that hold in every branch and points at the diagnosis.
      suggestion:
        'A slice rule that discovers nothing cannot enforce anything: correct the cause ' +
        'named in the message, or remove the rule.',
      docs: GLOB_DOCS,
      bypassFilters: true,
    }
  }

  /**
   * The remedy for empty discovery, derived from how slices were sourced *and*
   * from the globs actually given.
   *
   * Bug 0009 was a single hardcoded remedy that was correct for one source and
   * false for the other. Branching only on the source is not enough: telling a
   * caller to add a `**\/` prefix they already have, or to check a directory that
   * plainly exists, is the same defect one level down. So each branch below is
   * reachable only when its advice is actually true (ADR-008).
   */
  private emptyDiscoveryMessage(): string {
    const tail = 'A slice rule that discovers nothing enforces nothing.'

    if (!this._discovery) {
      return (
        'No slice source: call .matching(glob) or .assignedFrom(definition) ' +
        `before .should(). ${tail}`
      )
    }

    // Nothing can match when the project loaded no files at all — blaming the
    // glob would send the caller to the wrong file entirely.
    if (loadedNothing(this.project)) {
      // The SAME string `diagnose()` reports, from the one place that owns it.
      // These were two texts for one state and had already diverged: this copy
      // said only "check that this tsconfig includes your sources", which is
      // not actionable for a config that has no `include` at all — and this is
      // the copy a failing build prints.
      return `${capitalize(emptyProjectAdvice(this.project))}. ${tail}`
    }

    if (this._discovery.mode === 'matching') {
      const { glob } = this._discovery
      const prefix = matchingGlobPrefix(glob)

      // No literal directory prefix at all ('src', '*', '{a,b}/x/*'). Telling the
      // caller to "check the prefix" would send them to inspect something that does
      // not exist — the false-remedy shape this guard keeps relapsing into.
      if (prefix === '') {
        return (
          `matching(${JSON.stringify(glob)}) has no literal directory prefix, so there is ` +
          'nothing to locate in your file paths. It needs at least one plain directory ' +
          `segment before the wildcard, e.g. "src/features/*". ${tail}`
        )
      }

      // Check the claim before making it. The prefix is located with a literal
      // `indexOf` while the pattern goes through picomatch, and the two disagree
      // for prefixes containing `(`, `{` or `!` — so "the prefix was not found"
      // was a verifiable falsehood on exactly the route-group directory names this
      // parser is careful to treat as literal elsewhere.
      const prefixExists = this.project
        .getSourceFiles()
        .some((file) => file.getFilePath().includes(prefix))

      if (prefixExists) {
        return (
          `matching(${JSON.stringify(glob)}) resolved no slices even though the prefix ` +
          `${JSON.stringify(prefix)} does occur in this project's files, so the rest of the ` +
          'glob matched nothing. If a path segment contains "(", ")", "{", "}" or "!", those ' +
          'are pattern syntax rather than literal characters here — match that level with ' +
          `"*" instead. ${tail}`
        )
      }

      return (
        `matching(${JSON.stringify(glob)}) resolved no slices: the prefix ` +
        `${JSON.stringify(prefix)} was not found in any of this project's ` +
        `${String(this.project.getSourceFiles().length)} file paths. Compare it against a ` +
        'real path — the segment after the prefix names each slice (a directory when files ' +
        `are nested under it, otherwise each matching file name). ${tail}`
      )
    }

    const { entries } = this._discovery
    if (entries.length === 0) {
      return (
        'assignedFrom() was given no entries, so there are no slices to check. Pass at ' +
        `least one name-to-glob mapping, e.g. { services: "**/src/services/**" }. ${tail}`
      )
    }

    // Every entry is at fault (all slices are empty), so every entry is reported,
    // grouped by its own cause. Reporting one group and stopping — or applying one
    // group's advice to all of them — is what made each earlier version of this
    // message false for somebody.
    const FAULT_ORDER: readonly GlobFault[] = ['dot-segment', 'unanchored', 'no-match']
    const groups = FAULT_ORDER.map((fault) => ({
      fault,
      // Syntactic only: this message is built while explaining why EVERY
      // slice is empty, so "matched no file" is already established and the
      // useful split is between the two causes with a verifiable fix.
      list: entries.filter(
        (entry) =>
          // The SAME base the declaration uses (bug 0033). With the default
          // `'absolute'`, a project-relative glob is classified `unanchored`
          // and the message tells the author to prefix `"**/"` — advice that
          // stopped being true when this entry point started resolving one
          // against the project root. It would now send them to change a glob
          // whose spelling is fine and whose folder is simply missing.
          (syntacticFault(
            entry.glob,
            'file-path',
            isProjectRelative(entry.glob) ? 'normalized' : 'absolute',
          ) ?? 'no-match') === fault,
      ),
    })).filter((group) => group.list.length > 0)

    const clauses = groups.map((group) => {
      // Cap per group, never across groups, so no cause is hidden entirely — and
      // always keep an entry whose key the docs single out as error-prone.
      const notable = group.list.filter((entry) => /shared/i.test(entry.name))
      const ordered = [...notable, ...group.list.filter((entry) => !notable.includes(entry))]
      const head = ordered.slice(0, 4)
      const rest = ordered.length - head.length
      const named =
        head.map((entry) => `${entry.name}: ${JSON.stringify(entry.glob)}`).join(', ') +
        (rest > 0 ? `, and ${String(rest)} more` : '')
      return `${FAULT_ADVICE[group.fault]}: ${named}`
    })

    return `Every slice in assignedFrom(...) is empty. ${clauses.join('. Separately, ')}. ${tail}`
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

/**
 * A glob no path can match, for declaring a discovery that cannot resolve for
 * a reason the glob itself does not express. Anchored, so it is reported as
 * `no-match` rather than as a syntax fault whose remedy would be nonsense.
 */
const NEVER_MATCHES = '**/\u0000never-matches'
