import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { OutputFormat } from '../core/check-options.js'
import { ArchRuleError } from '../core/errors.js'
import { formatViolations } from '../core/format.js'
import { formatViolationsJson } from '../core/format-json.js'
import { formatViolationsGitHub } from '../core/format-github.js'

/**
 * Base class for smell detector builders.
 * Provides guardrail methods and terminal methods (check/warn).
 *
 * SmellBuilder does NOT extend RuleBuilder — smell detectors have a
 * different chain grammar (no .that()/.should()) and execution model
 * (pairwise comparison rather than individual element evaluation).
 */
export abstract class SmellBuilder {
  protected _folders: string[] = []
  protected _minLines = 5
  protected _ignoreTests = false
  protected _ignorePaths: string[] = []
  protected _groupByFolder = false
  protected _reason?: string

  constructor(protected readonly project: ArchProject) {}

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

  /** Explain why this smell check exists. */
  because(reason: string): this {
    this._reason = reason
    return this
  }

  /** Run detection and throw on violations. */
  check(options?: { format?: OutputFormat }): void {
    const violations = this.detect()
    if (violations.length > 0) {
      if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(violations, 'error') + '\n')
      }
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /** Run detection and log violations without throwing. */
  warn(options?: { format?: OutputFormat }): void {
    const violations = this.detect()
    if (violations.length > 0) {
      if (options?.format === 'json') {
        console.warn(formatViolationsJson(violations, this._reason))
      } else if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(violations, 'warning') + '\n')
      } else {
        console.warn(formatViolations(violations, this._reason))
      }
    }
  }

  /** Subclasses implement: run detection, return violations. */
  protected abstract detect(): ArchViolation[]

  /** Subclasses implement: human-readable rule description. */
  protected abstract describe(): string
}
