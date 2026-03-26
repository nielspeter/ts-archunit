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
  const output = {
    summary: {
      total: violations.length,
      reason: reason ?? null,
    },
    violations: violations.map((v) => ({
      rule: v.rule,
      element: v.element,
      file: v.file,
      line: v.line,
      message: v.message,
      because: v.because ?? null,
      suggestion: v.suggestion ?? null,
    })),
  }
  return JSON.stringify(output, null, 2)
}
