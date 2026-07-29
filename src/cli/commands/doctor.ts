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
  // Identities, never totals (docs/cli.md): a boolean told a JSON consumer that
  // something failed without saying which file or why, leaving them to scrape
  // stderr prose they do not read.
  const loadFailures: { file: string; error: string }[] = []
  for (const file of args.ruleFiles) {
    try {
      rules.push(...(await loadRuleFiles([file])))
    } catch (error: unknown) {
      // A rule file that self-executes a throwing `.check()` at import is a
      // documented shape, and `runCheck` already tolerates it. Without this,
      // `doctor` — the pre-flight R3b's gate depends on — crashes on the
      // commonest legacy rule-file shape and abandons every remaining file,
      // so the gate cannot be run on the population it was invented for.
      // `loadRuleFiles` accumulates into a local array and returns it only
      // after its own loop, so when the import throws NOTHING from that file
      // survives. Saying "diagnosing what loaded" would be false, and
      // swallowing it silently turned a visible crash into `exit 0` plus a
      // clean bill of health — the ADR-008 rule 1 failure this command exists
      // to surface, committed by the command.
      //
      // Two loud shapes (plan 0070 round 2): an ArchRuleError means the file
      // self-executes a failing rule at import; anything else — measured, a
      // raw TypeError from importing a vitest test file — used to crash the
      // whole command and abandon every remaining file.
      if (error instanceof ArchRuleError) {
        process.stderr.write(
          `Error: ${file} executes its rules at import and threw, so none of it could be ` +
            `diagnosed. Leave builders un-terminated in a rule file (see docs/running-in-tests).\n`,
        )
      } else {
        // The remedy is CONDITIONAL: this branch fires for any load failure —
        // a syntax error, a missing dependency — and asserting "this imports a
        // test runner" unconditionally would be a false cause (ADR-008 rule 2,
        // caught in review). The error message is the evidence; the test-runner
        // sentence is offered as the common case, not stated as the cause.
        process.stderr.write(
          `Error: ${file} could not be loaded (${error instanceof Error ? error.message : String(error)}), ` +
            `so none of it could be diagnosed. If this file imports a test runner (vitest/jest), ` +
            `doctor cannot load it — run your test suite instead; the runtime writes the same ` +
            `diagnostics to stderr.\n`,
        )
      }
      loadFailures.push({ file, error: error instanceof Error ? error.message : String(error) })
    }
  }

  // A load failure is a REPORT, and this command's contract is "exits
  // non-zero when it reports anything". Review measured the mixed case —
  // one broken file, one clean file, zero findings — printing the error and
  // then exiting 0 with a clean bill of health: exactly the "exit 0 plus
  // silence" this command exists to prevent, reintroduced by the catch that
  // fixed the crash. Every exit path below folds the load failures in.
  //
  // And every exit path emits the JSON document when asked for it: a consumer
  // parsing stdout used to get zero bytes on the commonest single-file failure,
  // and `JSON.parse('')` throws — the exact consumer the exit-code fix was for.
  const emitJson = (findings: DiagnosticFinding[]): void => {
    if (args.format === 'json') {
      process.stdout.write(JSON.stringify({ findings, loadFailures }, null, 2) + '\n')
    }
  }

  if (loadFailures.length > 0 && rules.length === 0) {
    emitJson([])
    return 1
  }

  // Nothing to diagnose is not the same as nothing wrong. The earlier guard
  // checked `args.ruleFiles.length`, which is the wrong derivation: a file
  // exporting `[]` reached this point and reported a clean bill of health.
  if (rules.length === 0) {
    process.stderr.write('Error: no rules found in the given files.\n')
    emitJson([])
    return 1
  }

  const findings = diagnose(rules)

  if (args.format === 'json') {
    emitJson(findings)
    return findings.length > 0 || loadFailures.length > 0 ? 1 : 0
  }

  if (findings.length === 0) {
    if (loadFailures.length > 0) {
      process.stderr.write(
        'No findings in the rules that loaded — but at least one file could not be ' +
          'loaded (see above), so this is not a clean bill of health.\n',
      )
      return 1
    }
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
