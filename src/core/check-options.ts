import type { ArchViolation } from './violation.js'

/**
 * Output format for violations.
 *
 * - 'terminal' (default): ANSI-colored output with code frames
 * - 'json': Machine-readable JSON
 * - 'github': GitHub Actions annotation commands
 */
export type OutputFormat = 'terminal' | 'json' | 'github'

/**
 * A filter that removes known violations (e.g. from a baseline file).
 * Implemented by `Baseline` in `../helpers/baseline.js`.
 */
export interface BaselineFilter {
  /** Filter out known violations, returning only new ones. */
  filterNew(violations: ArchViolation[]): ArchViolation[]
}

/**
 * A filter that restricts violations to changed files (e.g. from git diff).
 * Implemented by `DiffFilter` in `../helpers/diff-aware.js`.
 */
export interface DiffFilterLike {
  /** Filter violations to only those in changed files. */
  filterToChanged(violations: ArchViolation[]): ArchViolation[]
  /**
   * How many files this filter considers changed, or a negative number when it
   * could not tell (`DiffFilter` returns -1 when git was unavailable).
   *
   * **Optional, and the disclosure degrades rather than guesses.** This is a
   * structural interface, so a consumer may pass any object with
   * `filterToChanged`; when `size` is absent the suppression notice omits the
   * file count instead of inventing one. What it never omits is the suppressed
   * count itself, because the caller derives that by subtraction rather than
   * asking the filter (see `core/diff-disclosure.ts`).
   */
  readonly size?: number
  /** The branch diffed against, when the filter knows it. Optional, as `size`. */
  readonly baseBranch?: string
}

/**
 * Options passed to .check() and .warn() to filter violations.
 *
 * @example
 * // Baseline only
 * .check(\{ baseline \})
 *
 * // Diff-aware only
 * .check(\{ diff: diffAware('main') \})
 *
 * // Both
 * .check(\{ baseline, diff: diffAware('main') \})
 */
export interface CheckOptions {
  /** Filter out known violations from a baseline file */
  baseline?: BaselineFilter
  /** Filter to only violations in changed files */
  diff?: DiffFilterLike
  /** Output format for violations. Default: 'terminal' */
  format?: OutputFormat
}
