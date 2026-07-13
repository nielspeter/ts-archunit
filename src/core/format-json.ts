import type { ArchViolation } from './violation.js'

/**
 * Format violations as a JSON string.
 *
 * Useful for CI pipelines, custom dashboards, or piping to other tools.
 *
 * @example
 * const violations = collectViolations(rule1, rule2)
 * console.log(formatViolationsJson(violations))
 */
export function formatViolationsJson(violations: ArchViolation[], reason?: string): string {
  const errors = violations.filter((v) => (v.severity ?? 'error') === 'error').length
  const output = {
    summary: {
      total: violations.length,
      errors,
      warnings: violations.length - errors,
      reason: reason ?? null,
    },
    violations: violations.map((v) => ({
      rule: v.rule,
      ruleId: v.ruleId ?? null,
      severity: v.severity ?? 'error',
      element: v.element,
      file: v.file,
      line: v.line,
      message: v.message,
      because: v.because ?? null,
      suggestion: v.suggestion ?? null,
      docs: v.docs ?? null,
      codeFrame: v.codeFrame ?? null,
    })),
  }
  return JSON.stringify(output, null, 2)
}
