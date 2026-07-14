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
export async function runBaseline(args: BaselineArgs): Promise<void> {
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

  process.stdout.write(`Baseline generated: ${String(violations.length)} violations recorded\n`)
  process.stdout.write(`Written to: ${args.output}\n`)
}
