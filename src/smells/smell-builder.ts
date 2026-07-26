import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { GlobNode } from '../core/glob-site.js'
import { globAnyOf, stampGlobs } from '../core/glob-site.js'
import { TerminalBuilder } from '../core/terminal-builder.js'

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
    this._folders.push(glob)
    return this
  }

  /** Ignore functions/files shorter than N lines. Default: 5. */
  minLines(n: number): this {
    this._minLines = n
    return this
  }

  /** Exclude test files (*.test.ts, *.spec.ts, __tests__/**). */
  ignoreTests(): this {
    this._ignoreTests = true
    return this
  }

  /** Exclude files matching the given glob patterns. */
  ignorePaths(...globs: string[]): this {
    this._ignorePaths.push(...globs)
    return this
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
          globAnyOf(this._folders, 'file-path'),
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
    this._groupByFolder = true
    return this
  }

  /** Delegate to detect() for the terminal builder pipeline. */
  protected collectViolations(): ArchViolation[] {
    return this.detect()
  }

  /** Subclasses implement: run detection, return violations. */
  protected abstract detect(): ArchViolation[]

  /** Subclasses implement: human-readable rule description. */
  protected abstract describe(): string
}
