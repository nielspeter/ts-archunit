import type { RuleBuilderLike } from './rule-builder-like.js'
import type { CheckOptions } from './check-options.js'
import { ArchRuleError } from './errors.js'
import { writeReport } from './execute-rule.js'

/**
 * Run an array of rules (e.g. a spread preset) and throw one aggregated
 * `ArchRuleError` if any **error-severity** violation is found. Warn-severity
 * violations are reported but never throw — the same severity contract as the
 * CLI `check`. This is the test-file terminal for the returning form:
 *
 * ```ts
 * checkAll(layeredArchitecture(p, opts))
 * checkAll([...recommended(p), ...layeredArchitecture(p, opts)])
 * ```
 *
 * Each builder's `.violations()` already carries its stamped severity
 * (via `.asSeverity()`), so aggregation and severity are preserved across the
 * whole array — one readable error listing every error-severity violation.
 */
export function checkAll(rules: RuleBuilderLike[], options?: CheckOptions): void {
  let violations = rules.flatMap((rule) => rule.violations())

  if (options?.baseline) {
    violations = options.baseline.filterNew(violations)
  }
  if (options?.diff) {
    violations = options.diff.filterToChanged(violations)
  }

  writeReport(violations, options?.format)

  const errors = violations.filter((v) => (v.severity ?? 'error') === 'error')
  if (errors.length > 0) {
    throw new ArchRuleError(errors)
  }
}
