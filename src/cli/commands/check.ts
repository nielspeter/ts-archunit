import { detectFormat } from '../../core/environment.js'
import { withBaseline } from '../../helpers/baseline.js'
import { diffAware } from '../../helpers/diff-aware.js'
import type { CheckOptions, OutputFormat } from '../../core/check-options.js'
import { ArchRuleError } from '../../core/errors.js'
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

/**
 * Run architecture rules from the specified rule files.
 *
 * Wraps existing programmatic APIs: withBaseline, diffAware, detectFormat.
 */
export async function runCheck(args: CheckArgs): Promise<number> {
  const format: OutputFormat = args.format === 'auto' ? detectFormat() : args.format

  const options: CheckOptions = { format }

  if (args.baseline !== undefined) {
    options.baseline = withBaseline(args.baseline)
  }
  if (args.changed) {
    options.diff = diffAware(args.base)
  }

  const builders = await loadRuleFiles(args.ruleFiles, { fresh: args.fresh })

  let failures = 0
  for (const builder of builders) {
    try {
      builder.check(options)
    } catch (error: unknown) {
      if (error instanceof ArchRuleError) {
        failures++
      } else {
        throw error
      }
    }
  }

  return failures
}
