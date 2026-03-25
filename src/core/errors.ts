import type { ArchViolation } from './violation.js'

/**
 * Format violations into a human-readable error message.
 */
function formatViolations(violations: ArchViolation[], reason?: string): string {
  const header = `Architecture violation${violations.length === 1 ? '' : 's'} (${String(violations.length)} found)`
  const reasonLine = reason ? `\nReason: ${reason}` : ''

  const details = violations
    .map((v) => {
      const location = `${v.file}:${String(v.line)}`
      return `  - ${v.element}: ${v.message} (${location})`
    })
    .join('\n')

  return `${header}${reasonLine}\n${details}`
}

/**
 * Thrown by `.check()` when architecture violations are found.
 *
 * Integrates naturally with vitest/jest — the test fails with a readable
 * error message listing all violations and their locations.
 */
export class ArchRuleError extends Error {
  public readonly violations: ArchViolation[]

  constructor(violations: ArchViolation[], reason?: string) {
    super(formatViolations(violations, reason))
    this.name = 'ArchRuleError'
    this.violations = violations
  }
}
