import type { RuleBuilderLike } from './rule-builder-like.js'
import type { CheckOptions } from './check-options.js'
import { ArchRuleError } from './errors.js'
import { writeReport } from './execute-rule.js'
import { suppressionNotice } from './diff-disclosure.js'
import { writeStderr } from './stderr.js'

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
  // `checkAll` filters once for the whole array, so like the CLI it can state
  // the real number (plan 0071). The per-rule terminals cannot — see
  // `core/diff-disclosure.ts`.
  let notice: string | undefined
  if (options?.diff) {
    const before = violations.length
    violations = options.diff.filterToChanged(violations)
    notice = suppressionNotice(
      before - violations.length,
      options.diff.size,
      options.diff.baseBranch,
    )
    if (notice !== undefined) writeStderr(notice)
  }

  // `reason` is rendered as each violation's "Why:" line on the terminal path
  // (`format.ts`: `v.because ?? reason`), so a RUN-level notice must not travel
  // that way — it would appear as the justification for an unrelated finding.
  // `summary.reason` in JSON is genuinely run-level, so it goes there, and
  // stderr carries it for every other format. Found by sabotage: removing the
  // `writeStderr` call left the tests green because the notice was reaching
  // stderr through the "Why:" line instead.
  writeReport(violations, options?.format, options?.format === 'json' ? notice : undefined)

  const errors = violations.filter((v) => (v.severity ?? 'error') === 'error')
  if (errors.length > 0) {
    throw new ArchRuleError(errors)
  }
}
