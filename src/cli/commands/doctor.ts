import type { DiagnosableRule, DiagnosticFinding } from '../../core/diagnose.js'
import { diagnose } from '../../core/diagnose.js'
import { ArchRuleError } from '../../core/errors.js'
import { loadRuleFiles } from '../load-rules.js'

export interface DoctorArgs {
  ruleFiles: string[]
  format: 'terminal' | 'json'
}

/**
 * Report what each rule cannot enforce, without running any of them.
 *
 * **Experimental and hidden.** Not listed in `--help`, because removing a
 * documented command later is its own breaking change and its life after R3
 * is not yet decided. Shipping it hidden is precisely what defers that
 * decision.
 *
 * It is a diagnostic you invoke, not a build gate — do not wire it into a
 * pipeline. It nevertheless **exits non-zero when it reports anything**,
 * because an agent reads `exit 0` as "nothing to do" (ADR-008 rule 1), and a
 * diagnostic that reports problems while exiting 0 is a diagnostic nobody
 * acts on.
 *
 * Reports identities, never totals: which glob, in which rule, at which
 * position, and what is verifiably true about it.
 */
export async function runDoctor(args: DoctorArgs): Promise<number> {
  if (args.ruleFiles.length === 0) {
    process.stderr.write(
      'Error: no rule files. Pass them as arguments or set `rules` in your config.\n',
    )
    return 1
  }

  const rules: DiagnosableRule[] = []
  for (const file of args.ruleFiles) {
    try {
      rules.push(...(await loadRuleFiles([file])))
    } catch (error: unknown) {
      // A rule file that self-executes a throwing `.check()` at import is a
      // documented shape, and `runCheck` already tolerates it. Without this,
      // `doctor` — the pre-flight R3b's gate depends on — crashes on the
      // commonest legacy rule-file shape and abandons every remaining file,
      // so the gate cannot be run on the population it was invented for.
      if (!(error instanceof ArchRuleError)) throw error
      process.stderr.write(
        `Note: ${file} executed its rules at import; diagnosing what loaded before it threw.\n`,
      )
    }
  }

  const findings = diagnose(rules)

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n')
    return findings.length > 0 ? 1 : 0
  }

  if (findings.length === 0) {
    process.stderr.write('No rules that cannot enforce anything.\n')
    return 0
  }

  process.stderr.write(format(findings))
  return 1
}

function format(findings: readonly DiagnosticFinding[]): string {
  const lines: string[] = ['']
  for (const finding of findings) {
    lines.push(`  ${finding.rule}`)
    if (finding.kind === 'dead-glob') {
      lines.push(
        `    ${finding.origin ?? finding.glob ?? '(unknown)'}  [${finding.position ?? 'unknown'}]`,
        `    ${finding.fault ?? 'unknown'}: ${finding.advice}`,
      )
    } else {
      // `no-condition` and `project-unknown` have no glob, no position and no
      // fault. Rendering them through the dead-glob shape printed
      // `(unknown) [unknown]` / `unknown: …`, which reads like a bug in the
      // tool rather than a finding about the rule.
      lines.push(`    ${finding.kind}: ${finding.advice}`)
    }
    lines.push('')
  }
  // Deliberately no total. A count is the snapshot ADR-008 rule 4 bars, and it
  // is the number people ratchet against instead of fixing the findings.
  return lines.join('\n')
}
