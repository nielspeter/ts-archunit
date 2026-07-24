import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import type { Slice, SliceDefinition } from '../models/slice.js'
import { resolveByMatching, resolveByDefinition } from '../models/slice.js'
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

/** Anchored globs already match absolute paths — a `**\/` hint would be a no-op. */
function isAnchored(glob: string): boolean {
  return glob.startsWith('**/') || glob.startsWith('/')
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
    const id = this._metadata?.id ?? 'slices'
    return {
      rule: id,
      ruleId: this._metadata?.id,
      element: id,
      file: '',
      line: 0,
      message: this.emptyDiscoveryMessage(),
      because: this._reason,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
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
      return (
        `matching(${JSON.stringify(this._discovery.glob)}) resolved no slices. The glob's ` +
        'literal prefix (everything before the first wildcard) must be a directory path ' +
        "that occurs in this project's files; the segment after it names each slice — a " +
        'directory when files are nested under it, otherwise each matching file name. ' +
        `Check that prefix against an actual file path. ${tail}`
      )
    }

    const { entries } = this._discovery
    if (entries.length === 0) {
      return (
        'assignedFrom() was given no entries, so there are no slices to check. Pass at ' +
        `least one name-to-glob mapping, e.g. { services: "**/src/services/**" }. ${tail}`
      )
    }

    const unanchored = entries.filter((entry) => !isAnchored(entry.glob))
    const shown = (list: readonly { name: string; glob: string }[]): string => {
      const head = list.slice(0, 5).map((e) => `${e.name}: ${JSON.stringify(e.glob)}`)
      const rest = list.length - head.length
      return head.join(', ') + (rest > 0 ? `, and ${String(rest)} more` : '')
    }

    if (unanchored.length > 0) {
      return (
        'Every slice in assignedFrom(...) is empty. These globs are matched against ' +
        `ABSOLUTE file paths, so a project-relative glob matches nothing — prefix these ` +
        `with "**/": ${shown(unanchored)}. ${tail}`
      )
    }

    return (
      'Every slice in assignedFrom(...) is empty. The globs are anchored correctly, so ' +
      'the named directories do not exist in this project (or hold no source files): ' +
      `${shown(entries)}. ${tail}`
    )
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
