import { collectViolations } from '../../helpers/baseline-generator.js'
import { generateBaseline } from '../../helpers/baseline.js'
import { ArchRuleError } from '../../core/errors.js'
import type { ArchViolation } from '../../core/violation.js'
import { loadRuleFiles } from '../load-rules.js'

export interface BaselineArgs {
  ruleFiles: string[]
  output: string
}

/**
 * Generate a baseline file from current rule violations.
 *
 * Wraps existing APIs: collectViolations + generateBaseline.
 */
export async function runBaseline(args: BaselineArgs): Promise<number> {
  // Per-file parity with runCheck: a user rule file that self-executes a
  // throwing `.check()` at import surfaces its own violations without discarding
  // the other files' rules. (Presets no longer throw at import — returning form.)
  const violations: ArchViolation[] = []
  for (const file of args.ruleFiles) {
    try {
      const builders = await loadRuleFiles([file])
      violations.push(...collectViolations(...builders))
    } catch (error: unknown) {
      if (error instanceof ArchRuleError) {
        violations.push(...error.violations)
      } else {
        throw error
      }
    }
  }

  generateBaseline(violations, args.output)

  // Report what was actually WRITTEN, not what was collected. Config-level findings
  // are deliberately not baselineable (they report that a rule enforces nothing), so
  // printing the pre-filter count told users they had accepted findings that CI would
  // still fail on, with no hint why.
  const refused = violations.filter((v) => v.bypassFilters === true)
  const recorded = violations.length - refused.length

  process.stdout.write(`Baseline generated: ${String(recorded)} violations recorded\n`)
  process.stdout.write(`Written to: ${args.output}\n`)

  if (refused.length > 0) {
    process.stdout.write(
      `\n${String(refused.length)} finding(s) could NOT be baselined — each reports a rule ` +
        `that currently enforces nothing, so accepting it would hide the gap. Fix these:\n`,
    )
    for (const violation of refused) {
      process.stdout.write(`  - ${violation.rule}: ${violation.message}\n`)
    }
  }

  // Non-zero when something could not be baselined, for the same reason
  // `doctor` exits non-zero: an agent reads `exit 0` as "nothing to do", and
  // this command sits on the documented 0.23.0 upgrade path. Exiting 0 here
  // meant `npm run arch:baseline` reported the blocker, succeeded, got
  // committed, and the next `arch` job failed on findings the baseline was
  // supposed to have covered. The file is still written — the findings that
  // COULD be baselined are recorded, so re-running after the fix is cheap.
  return refused.length > 0 ? 1 : 0
}
