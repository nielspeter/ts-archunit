import type { ArchViolation } from '../core/violation.js'

/**
 * Collect violations from rules WITHOUT throwing.
 *
 * Used to generate a baseline: run all rules via their non-throwing
 * `.violations()` terminal (severity-stamped), and write them to a baseline
 * file.
 *
 * @example
 * const violations = collectViolations(
 *   classes(p).that().extend('Base').should().notContain(call('parseInt')),
 *   classes(p).that().extend('Base').should().notContain(newExpr('Error')),
 * )
 * generateBaseline(violations, 'arch-baseline.json')
 */
export function collectViolations(
  ...builders: Array<{ violations: () => ArchViolation[] }>
): ArchViolation[] {
  return builders.flatMap((builder) => builder.violations())
}
