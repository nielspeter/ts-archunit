import type { ArchViolation } from './violation.js'
import { formatViolationsPlain } from './format.js'

/**
 * Thrown by `.check()` when architecture violations are found.
 *
 * Integrates naturally with vitest/jest — the test fails with a readable
 * error message listing all violations and their locations.
 */
export class ArchRuleError extends Error {
  public readonly violations: ArchViolation[]

  constructor(violations: ArchViolation[], reason?: string) {
    super(formatViolationsPlain(violations, reason))
    this.name = 'ArchRuleError'
    this.violations = violations
  }
}
