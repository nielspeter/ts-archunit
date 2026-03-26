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
      const relativePath = path.relative(cwd, v.file)
      const title = `Architecture Violation: ${v.rule}`
      const message = v.because ? `${v.message} (${v.because})` : v.message

      // GitHub annotation format: ::level file=path,line=N,title=T::message
      return `::${severity} file=${relativePath},line=${String(v.line)},title=${escapeGitHub(title)}::${escapeGitHub(message)}`
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
