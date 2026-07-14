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
  // Defensive parity with runCheck: a user rule file that self-executes a
  // throwing `.check()` at import surfaces its violations instead of crashing
  // baseline generation. (Presets no longer throw at import — returning form.)
  let violations: ArchViolation[]
  try {
    const builders = await loadRuleFiles(args.ruleFiles)
    violations = collectViolations(...builders)
  } catch (error: unknown) {
    if (error instanceof ArchRuleError) {
      violations = error.violations
    } else {
      throw error
    }
  }

  generateBaseline(violations, args.output)

  process.stdout.write(`Baseline generated: ${String(violations.length)} violations recorded\n`)
  process.stdout.write(`Written to: ${args.output}\n`)
}
