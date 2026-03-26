import type { ArchViolation } from '../core/violation.js'
import { ArchRuleError } from '../core/errors.js'

/**
 * Collect violations from rules WITHOUT throwing.
 *
 * Used to generate a baseline: run all rules, collect violations,
 * write them to a baseline file.
 *
 * @example
 * const violations = collectViolations(
 *   classes(p).that().extend('Base').should().notContain(call('parseInt')),
 *   classes(p).that().extend('Base').should().notContain(newExpr('Error')),
 * )
 * generateBaseline(violations, 'arch-baseline.json')
 */
export function collectViolations(...builders: Array<{ check: () => void }>): ArchViolation[] {
  const allViolations: ArchViolation[] = []

  for (const builder of builders) {
    try {
      builder.check()
    } catch (error: unknown) {
      if (error instanceof ArchRuleError) {
        allViolations.push(...error.violations)
      }
    }
  }

  return allViolations
}
