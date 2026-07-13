import { detectFormat } from '../../core/environment.js'
import { withBaseline } from '../../helpers/baseline.js'
import { diffAware } from '../../helpers/diff-aware.js'
import type { OutputFormat } from '../../core/check-options.js'
import type { ArchViolation } from '../../core/violation.js'
import { ArchRuleError } from '../../core/errors.js'
import { formatViolations } from '../../core/format.js'
import { formatViolationsJson } from '../../core/format-json.js'
import { formatViolationsGitHub } from '../../core/format-github.js'
import { loadRuleFiles } from '../load-rules.js'

export interface CheckArgs {
  ruleFiles: string[]
  baseline?: string
  changed: boolean
  base: string
  format: OutputFormat | 'auto'
  /** Use cache-busting imports for watch mode re-runs. */
  fresh?: boolean
}

/** Report the unified violation list in one document (JSON is a single array). */
function reportViolations(violations: ArchViolation[], format: OutputFormat): void {
  if (format === 'json') {
    process.stdout.write(formatViolationsJson(violations) + '\n')
  } else if (format === 'github') {
    process.stdout.write(formatViolationsGitHub(violations) + '\n')
  } else {
    process.stderr.write(formatViolations(violations) + '\n')
  }
}

/**
 * Run architecture rules from the specified rule files.
 *
 * Unified pipeline (plan 0060): collect `.violations()` across every builder
 * (each stamped with its severity), apply baseline/diff, report ONCE, and set
 * the exit code from the error-severity count. Warns are reported but do not
 * fail. A rule file that throws `ArchRuleError` on import (a bare self-executing
 * preset call) is handled by a best-effort catch — error-severity only.
 */
export async function runCheck(args: CheckArgs): Promise<number> {
  const format: OutputFormat = args.format === 'auto' ? detectFormat() : args.format
  const baseline = args.baseline !== undefined ? withBaseline(args.baseline) : undefined
  const diff = args.changed ? diffAware(args.base) : undefined

  const collected: ArchViolation[] = []
  for (const file of args.ruleFiles) {
    try {
      const builders = await loadRuleFiles([file], { fresh: args.fresh })
      for (const builder of builders) {
        collected.push(...builder.violations())
      }
    } catch (error: unknown) {
      if (error instanceof ArchRuleError) {
        collected.push(...error.violations)
      } else {
        throw error
      }
    }
  }

  let filtered = collected
  if (baseline) filtered = baseline.filterNew(filtered)
  if (diff) filtered = diff.filterToChanged(filtered)

  if (filtered.length > 0) {
    reportViolations(filtered, format)
  }

  // Exit code = error-severity count; warns are reported but never fail.
  return filtered.filter((v) => (v.severity ?? 'error') === 'error').length
}
