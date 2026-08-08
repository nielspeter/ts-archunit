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
export abstract class SmellBuilder extends TerminalBuilder {
  protected _folders: string[] = []
  protected _minLines = 5
  protected _ignoreTests = false
  protected _ignorePaths: string[] = []
  protected _groupByFolder = false

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
