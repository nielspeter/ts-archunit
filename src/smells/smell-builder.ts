import type { ArchProject } from '../core/project.js'
import type { CollectResult } from '../core/terminal-builder.js'
import type { ArchViolation } from '../core/violation.js'
import type { GlobNode } from '../core/glob-site.js'
import { globAnyOf, stampGlobs } from '../core/glob-site.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import { isProjectRelative } from '../core/project-relative.js'

/**
 * Base class for smell detector builders.
 * Extends TerminalBuilder for shared terminal methods (check/warn/excluding/because/rule).
 *
 * SmellBuilder does NOT extend RuleBuilder — smell detectors have a
 * different chain grammar (no .that()/.should()) and execution model
 * (pairwise comparison rather than individual element evaluation).
 */
/** The `minLines` threshold applied when the author sets none. */
const DEFAULT_MIN_LINES = 5

export abstract class SmellBuilder extends TerminalBuilder {
  protected _folders: string[] = []
  protected _minLines: number = DEFAULT_MIN_LINES
  protected _ignoreTests = false
  protected _ignorePaths: string[] = []
  protected _groupByFolder = false

  /**
   * This family's own narrowing, named — plan 0099 / ADR-009 part 4.
   *
   * `_minLines` defaults to 5 and neither `agentGuardrails` nor `strictBoundaries`
   * exposes a knob for it, so a user whose bodies are all shorter is told their
   * rule enforces nothing by a filter they never wrote and cannot reach. Naming it
   * is the difference between an actionable finding and one that sends an agent
   * hunting for filters that do not exist.
   */
  /** This family counts function bodies, not subjects — plan 0099. */
  protected override examinedUnitNoun(): string {
    return 'function bodies'
  }

  protected override narrowingHint(): string | undefined {
    const applied = [`minLines(${String(this._minLines)})`]
    if (this._folders.length > 0) applied.push(`inFolder(${this._folders.join(', ')})`)
    if (this._ignorePaths.length > 0) applied.push(`ignorePaths(${this._ignorePaths.join(', ')})`)
    if (this._ignoreTests) applied.push('ignoreTests()')
    // The "you did not write it" clause is TRUE only while the value is still the
    // default. Rendered with an author-written `.minLines(500)` it said
    // "minLines(500) — minLines defaults to 5, a default you did not write",
    // which is false on the path that produced it: an agent goes hunting for
    // where 5 comes from and never touches the 500 that is the actual fault.
    // ADR-008 rule 2, on an unsuppressable hard failure.
    // States the filters as FACT, and does not claim they caused the emptiness.
    //
    // "Its own narrowing removed them" asserts removal. Measured on a types-only
    // corpus with the default threshold: there were zero function bodies, so
    // `minLines` removed nothing — the sentence named a false cause and pointed at
    // a knob that `agentGuardrails` and `strictBoundaries` expose no setter for,
    // on an unsuppressable hard failure. `narrowingHint()`'s own docstring
    // promises the caller "names the possibility rather than asserting a cause it
    // cannot verify"; this is the family honouring that rather than the base
    // softening it afterwards.
    const wroteItThemselves = this._minLines !== DEFAULT_MIN_LINES
    return wroteItThemselves
      ? `Its narrowing was: ${applied.join(', ')}.`
      : `Its narrowing was: ${applied.join(', ')}` +
          ` — minLines defaults to ${String(DEFAULT_MIN_LINES)}, a default you did not write.`
  }

  constructor(protected readonly project: ArchProject) {
    super()
  }

  /**
   * Scope detection to files matching the glob pattern.
   *
   * Note the name: this matches the **whole file path**, not the directory
   * portion (`passesFileFilters` applies the matcher to `sf.getFilePath()`).
   * So its declared kind is `file-path`, which is why plan 0069 derives `kind`
   * from the string a matcher is applied to rather than from the method name.
   */
  inFolder(glob: string): this {
    const next = this.copy()
    next._folders.push(glob)
    return next
  }

  /** Ignore functions/files shorter than N lines. Default: 5. */
  minLines(n: number): this {
    const next = this.copy()
    next._minLines = n
    return next
  }

  /** Exclude test files (*.test.ts, *.spec.ts, __tests__/**). */
  ignoreTests(): this {
    const next = this.copy()
    next._ignoreTests = true
    return next
  }

  /** Exclude files matching the given glob patterns. */
  ignorePaths(...globs: string[]): this {
    const next = this.copy()
    next._ignorePaths.push(...globs)
    return next
  }

  /** The project this detector was built against. See `RuleBuilder.getProject`. */
  getProject(): ArchProject {
    return this.project
  }

  /**
   * The globs this detector was scoped with.
   *
   * `inFolder` is `discovery`: it defines the population to scan, so a glob
   * matching nothing means the detector scans nothing. `ignorePaths` is
   * `exclusion` and is never a fault — an exclusion matching zero files is
   * remedy-optional (proposal 006).
   *
   * Repeated `inFolder()` calls OR together (`folderMatchers.some`), so they
   * form one `any` node rather than one node each.
   */
  override globs(): readonly GlobNode[] {
    const trees: GlobNode[] = []
    if (this._folders.length > 0) {
      trees.push(
        stampGlobs(
          globAnyOf(
            this._folders,
            'file-path',
            this._folders.every((g) => isProjectRelative(g)) ? 'normalized' : 'absolute',
          ),
          'discovery',
          (g) => `inFolder("${g.glob}")`,
        ),
      )
    }
    for (const glob of this._ignorePaths) {
      trees.push(
        stampGlobs(globAnyOf([glob], 'file-path'), 'exclusion', (g) => `ignorePaths("${g.glob}")`),
      )
    }
    return trees
  }

  /** Group violation output by directory. */
  groupByFolder(): this {
    const next = this.copy()
    next._groupByFolder = true
    return next
  }

  /**
   * An independent copy, carrying both scope lists.
   *
   * Without this, `ignorePaths()` on a copy would push into the array the
   * original still points at — and a leaked *ignore* is a false green: the
   * next detector off the same held builder would silently skip those files.
   */
  protected override copy(): this {
    const clone = super.copy()
    clone._folders = [...this._folders]
    clone._ignorePaths = [...this._ignorePaths]
    return clone
  }

  /** Delegate to detect() for the terminal builder pipeline. */
  protected collectViolations(): CollectResult {
    return { violations: this.detect(), examined: this.examinedUnits() }
  }

  /** Subclasses implement: run detection, return violations. */
  protected abstract detect(): ArchViolation[]

  /**
   * Subclasses implement: units this detector examined — plan 0098.
   *
   * Declared here rather than left to the subclasses because
   * `collectViolations()` is the seam and it cannot see a hook the subclass
   * merely happens to have. Plan 0096 added `examinedUnits()` to both detectors
   * and this class could not reach either; a new detector would have compiled
   * with no evidence at all.
   */
  abstract examinedUnits(): number

  /** Subclasses implement: human-readable rule description. */
  protected abstract describe(): string
}
