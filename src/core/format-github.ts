import path from 'node:path'
import type { ArchViolation } from './violation.js'

/**
 * Format violations as GitHub Actions annotation commands.
 *
 * Each violation becomes an `::error` or `::warning` command that GitHub
 * renders as an inline annotation on the PR diff.
 *
 * File paths are converted to relative (GitHub needs relative paths from repo root).
 *
 * @param violations - The violations to format
 * @param severity - 'error' for ::error, 'warning' for ::warning
 *
 * @example
 * // In a GitHub Actions workflow step:
 * // - run: npm run test 2>&1 | tee test-output.txt
 * // Or directly from the test file:
 * console.log(formatViolationsGitHub(violations))
 */
export function formatViolationsGitHub(
  violations: ArchViolation[],
  severity: 'error' | 'warning' = 'error',
): string {
  const cwd = process.cwd()

  return violations
    .map((v) => {
      // Escaped as a PROPERTY: the runner splits the property list on commas,
      // and a path containing one truncates the annotation onto a file that
      // does not exist (measured). Same treatment as `title` two lines down.
      const relativePath = escapeGitHubProperty(path.relative(cwd, v.file))
      const title = v.ruleId
        ? `Architecture Violation: ${v.ruleId}`
        : `Architecture Violation: ${v.rule}`
      let message = v.because ? `${v.message} (${v.because})` : v.message
      if (v.suggestion) message += `. Fix: ${v.suggestion}`
      if (v.docs) message += `. Docs: ${v.docs}`

      // GitHub annotation format: ::level file=path,line=N,title=T::message
      //
      // A configuration finding has no source location (file '', line 0), and
      // `::error file=,line=0` is not a valid annotation — GitHub drops or
      // misplaces it. Emit a run-level annotation instead, which renders on
      // the workflow summary (plan 0070).
      if (v.file === '') {
        return `::${severity} title=${escapeGitHubProperty(title)}::${escapeGitHub(message)}`
      }
      return `::${severity} file=${relativePath},line=${String(v.line)},title=${escapeGitHubProperty(title)}::${escapeGitHub(message)}`
    })
    .join('\n')
}

/**
 * Escape special characters for GitHub Actions commands.
 * GitHub uses % encoding for newlines and other control chars.
 */
export function escapeGitHub(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

/**
 * Property values (e.g. `title=`) additionally need `,` and `:` escaped —
 * the workflow-command parser splits the property list on commas, and rule
 * descriptions legitimately contain both (`{a,b}` globs, prose). The
 * run-level annotation for locationless findings made `title` the sole
 * identity carrier, which is what surfaced this.
 */
function escapeGitHubProperty(text: string): string {
  return escapeGitHub(text).replace(/,/g, '%2C').replace(/:/g, '%3A')
}
