import type { ArchViolation } from './violation.js'

/**
 * Thrown by `.check()` when architecture violations are found.
 *
 * Integrates naturally with vitest/jest — the test fails with a readable
 * error message listing all violations and their locations.
 */
export class ArchRuleError extends Error {
  public readonly violations: ArchViolation[]

  constructor(violations: ArchViolation[], reason?: string) {
    const summary = `Architecture violation${violations.length === 1 ? '' : 's'} (${String(violations.length)} found)`
    const reasonLine = reason ? ` — ${reason}` : ''
    super(`${summary}${reasonLine}`)
    this.name = 'ArchRuleError'
    this.violations = violations
  }
}
