import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import type { Slice, SliceDefinition } from '../models/slice.js'
import { resolveByMatching, resolveByDefinition, matchingGlobPrefix } from '../models/slice.js'
import {
  beFreeOfCycles as beFreeOfCyclesCondition,
  respectLayerOrder as respectLayerOrderCondition,
  notDependOn as notDependOnCondition,
} from '../conditions/slice.js'

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
 * Whether a glob can already match an absolute path, so the `**\/` hint would be
 * a no-op (or worse). Covers POSIX-absolute and Windows drive-absolute globs as
 * well as an explicit globstar.
 */
function isAnchored(glob: string): boolean {
  return glob.startsWith('**/') || glob.startsWith('/') || /^[A-Za-z]:\//.test(glob)
}

/** Where the glob conventions these messages talk about are documented. */
const DISCOVERY_DOCS = 'https://nielspeter.github.io/ts-archunit/slices'

/** Why one `assignedFrom()` glob matched nothing. */
type GlobFault = 'dot-segment' | 'unanchored' | 'no-match'

/**
 * Diagnose a single glob. Each fault has a *different* fix, so they are reported
 * separately — a message that lumps them together (or reports only the first kind
 * it finds) sends the caller through repeated failing runs, and was how every
 * earlier version of this guard ended up stating a remedy that did not apply.
 */
function diagnoseGlob(glob: string): GlobFault {
  // A './' anywhere — not just leading — makes the glob unmatchable, and adding
  // '**/' in front of it does not help ('**/./src/**' still matches nothing).
  if (/(?:^|\/)\.\//.test(glob)) return 'dot-segment'
  if (!isAnchored(glob)) return 'unanchored'
  return 'no-match'
}

/**
 * Only two faults name a cause, and only because the fix is a transformation that
 * can be verified: removing `./`, and adding the `**\/` anchor. Everything else
 * falls into `no-match`, which lists likely causes WITHOUT asserting one.
 *
 * That restraint is deliberate. Earlier revisions asserted a specific cause here —
 * "the directory does not exist", "append `/**`" — and each was false on a
 * reachable input (a glob targeting a file, a directory whose name ends in `]`,
 * a path that plainly existed). Under ADR-008 a confidently wrong cause is worse
 * than an honest list: the agent acts on it.
 */
const FAULT_ADVICE: Readonly<Record<GlobFault, string>> = {
  'dot-segment':
    'a "./" segment never occurs in an absolute file path — remove it and anchor instead ("./src/x/**" -> "**/src/x/**")',
  unanchored:
    'these are matched against ABSOLUTE file paths, so a project-relative glob matches nothing — prefix these with "**/"',
  'no-match':
    'these are anchored but matched no file. Common causes: the glob names a directory rather than the files inside it (append "/**"), a path segment is misspelled, or the directory holds no source files',
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
export class SliceRuleBuilder extends TerminalBuilder {
  private _slices: Slice[] = []
  private _discovery?: DiscoverySource
  private readonly _conditions: Condition<Slice>[] = []

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
    this._discovery = { mode: 'matching', glob }
    this._slices = resolveByMatching(this.project, glob)
    return this
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
    this._discovery = { mode: 'assignedFrom', entries }
    this._slices = resolveByDefinition(this.project, definition)
    return this
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
  beFreeOfCycles(): this {
    this._conditions.push(beFreeOfCyclesCondition())
    return this
  }

  /**
   * Assert that slices respect a layered dependency order.
   * Layer N may depend on layers N+1, N+2, ... but NOT on layers with lower index.
   *
   * @param layers - Ordered layer names from highest to lowest
   */
  respectLayerOrder(...layers: string[]): this {
    this._conditions.push(respectLayerOrderCondition(...layers))
    return this
  }

  /**
   * Assert that no slice depends on any of the listed slices.
   *
   * @param sliceNames - Names of forbidden dependency targets
   */
  notDependOn(...sliceNames: string[]): this {
    this._conditions.push(notDependOnCondition(...sliceNames))
    return this
  }

  protected collectViolations(): ArchViolation[] {
    // Discovery non-vacuity (ADR-008 / plan 0067): a slice selection that
    // resolved to no slices — or slices that matched no files — discovered
    // nothing, so it enforces nothing. Fail with a config-level meta-finding
    // (bypasses diff/baseline) rather than passing vacuously. `assignedFrom()`
    // returns one slice per key regardless of matches, so the empty case is
    // "every slice has no files", not "no slices" (arch-014 I1).
    if (this._slices.length === 0 || this._slices.every((slice) => slice.files.length === 0)) {
      return [this.emptyDiscoveryViolation()]
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

    if (this._conditions.length === 0) {
      const ruleId = this._metadata?.id ?? 'unnamed'
      console.warn(
        `[ts-archunit] Slice rule '${ruleId}' has no conditions. ` +
          `Did you forget to add a condition like beFreeOfCycles()?`,
      )
      return []
    }

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

    return violations
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
      docs: DISCOVERY_DOCS,
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
    if (this.project.getSourceFiles().length === 0) {
      return (
        `The project loaded 0 source files (${this.project.tsConfigPath}), so no glob ` +
        `can match. Check that this tsconfig includes your sources. ${tail}`
      )
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
      list: entries.filter((entry) => diagnoseGlob(entry.glob) === fault),
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
