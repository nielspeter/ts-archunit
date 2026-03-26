import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
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

  /** Scope detection to files matching the glob pattern. */
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
