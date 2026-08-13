import type { DiagnosableRule, DiagnosticFinding } from '../../core/diagnose.js'
import { diagnose } from '../../core/diagnose.js'
import { ArchRuleError } from '../../core/errors.js'
import { loadRuleFiles } from '../load-rules.js'
import { writeStderr } from '../../core/stderr.js'
import { orphanExclusions } from '../../core/orphan-exclusions.js'

export interface DoctorArgs {
  ruleFiles: string[]
  format: 'terminal' | 'json'
}

/**
 * Report what each rule cannot enforce, without evaluating their conditions.
 *
 * It DOES materialize each rule's selection, as of plan 0096: "this rule examined
 * nothing" is a fact about the selection, and the preview for 0098's floor has to
 * read the same computation the floor will. The docstring used to say "without
 * running any of them" and that stopped being true.
 *
 * **Supported and scoped** since plan 0077, which settled the keep-or-retire
 * question 0069 left open. It diagnoses rule files the CLI can **load** — the
 * `arch.rules.ts` shape `init` scaffolds, which `getting-started.md` calls the
 * default path. Rules hosted in a vitest or jest file cannot be imported outside
 * their runner; `diagnose()` is the answer there and reports the same findings.
 *
 * **Why the command earns its slot:** a **dead glob**. A rule whose selector can
 * never match certifies nothing, and `check` never calls `diagnose()` — measured,
 * `check` exits 0 with no output on such a rule while this reports it and exits
 * 1. Until 0069's R3b turns that into a check-time failure, this and `diagnose()`
 * are the only surfaces that see it.
 *
 * Not a build gate (0069): `check` is the gate.
 */
export async function runDoctor(args: DoctorArgs): Promise<number> {
  if (args.ruleFiles.length === 0) {
    writeStderr('Error: no rule files. Pass them as arguments or set `rules` in your config.\n')
    return 1
  }

  // Per file, not one flat array. `diagnose()` treats rules independently, so
  // the results are identical — but the loop is the only place that knows which
  // file a rule came from, and flattening first discarded it (bug 0026).
  const findings: DiagnosticFinding[] = []
  const rules: DiagnosableRule[] = []
  // Identities, never totals (docs/cli.md): a boolean told a JSON consumer that
  // something failed without saying which file or why, leaving them to scrape
  // stderr prose they do not read.
  const loadFailures: { file: string; error: string }[] = []
  for (const file of args.ruleFiles) {
    try {
      const loaded = await loadRuleFiles([file])
      rules.push(...loaded)
      findings.push(...diagnose(loaded).map((f) => ({ ...f, ruleFile: file })))
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
        writeStderr(
          `Error: ${file} executes its rules at import and threw, so none of it could be ` +
            `diagnosed. Leave builders un-terminated in a rule file (see docs/running-in-tests).\n`,
        )
      } else {
        // The remedy is CONDITIONAL: this branch fires for any load failure —
        // a syntax error, a missing dependency — and asserting "this imports a
        // test runner" unconditionally would be a false cause (ADR-008 rule 2,
        // caught in review). The error message is the evidence; the test-runner
        // sentence is offered as the common case, not stated as the cause.
        writeStderr(
          `Error: ${file} could not be loaded (${error instanceof Error ? error.message : String(error)}), ` +
            `so none of it could be diagnosed. If this file imports a test runner (vitest/jest), ` +
            `doctor cannot load it — run your test suite instead; the runtime writes the same ` +
            `diagnostics to stderr.\n`,
        )
      }
      loadFailures.push({ file, error: error instanceof Error ? error.message : String(error) })
    }
  }

  // Orphan exclusion comments, AFTER the loop and over every rule at once
  // (bug 0044). Not inside the loop and not inside `diagnose()`: the declared-id
  // set is the union across rule files, so a per-file check would report a
  // directive naming a rule declared in a sibling file as an orphan. That is a
  // false positive on the commonest multi-file layout, and a diagnostic that
  // cries wolf is one nobody runs.
  //
  // Reported as `dead-glob`'s sibling kind rather than a separate output
  // section, so `--format json` consumers get it through the `findings` array
  // they already parse.
  // The scope is passed, so the advice can say what it checked. `doctor
  // arch.rules.ts` — the single-file form `docs/cli.md` itself shows — sees a
  // subset of a multi-file project's rules, and a directive naming a rule from
  // another file would otherwise be reported as an orphan with "delete the
  // comment" as its remedy. Deleting a working comment un-waives a real
  // violation, which is the rule-2 failure this caveat exists to prevent.
  for (const orphan of orphanExclusions(rules, { ruleFilesChecked: args.ruleFiles.length })) {
    findings.push({
      kind: 'orphan-exclusion',
      rule: orphan.ruleId,
      advice: orphan.advice,
      // `sourceFile`, not `ruleFile`: that field is documented as "the rule file
      // this rule was written in", and putting a *source* path there gave JSON
      // consumers two different things under one name, by `kind`, undocumented.
      sourceFile: orphan.file,
      line: orphan.line,
    })
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
    writeStderr('Error: no rules found in the given files.\n')
    emitJson([])
    return 1
  }

  if (args.format === 'json') {
    emitJson(findings)
    return findings.length > 0 || loadFailures.length > 0 ? 1 : 0
  }

  if (findings.length === 0) {
    if (loadFailures.length > 0) {
      writeStderr(
        'No findings in the rules that loaded — but at least one file could not be ' +
          'loaded (see above), so this is not a clean bill of health.\n',
      )
      return 1
    }
    writeStderr('No rules that cannot enforce anything.\n')
    return 0
  }

  writeStderr(format(findings))
  return 1
}

/**
 * Which kinds carry a glob, and therefore render with origin/position/fault.
 *
 * A `Record` over the union rather than a boolean expression, so that adding a
 * kind fails `tsc` until someone decides how it renders. `project-empty` was
 * added to `DiagnosticFinding['kind']` and this file kept compiling — the gap
 * that made the choice implicit.
 */
const HAS_GLOB: Readonly<Record<DiagnosticFinding['kind'], boolean>> = {
  'dead-glob': true,
  'no-condition': false,
  'project-unknown': false,
  'project-empty': false,
  // No glob: the fault is the family's own filters emptying the set, so there
  // is no glob text to point at (plan 0096).
  'zero-subjects': false,
  // No glob: the fault is the family's own adequacy predicate, not a
  // selector — the corpus was found and examined, it just cannot ever
  // produce a finding as configured (plan 0102).
  inert: false,
  // No glob: the subject is a comment in a source file, and the identity is the
  // rule id it names plus where it sits. That is why this kind carries `line`.
  'orphan-exclusion': false,
  // No glob: the fault is specific CURRENT violations not covered by the
  // rule's own `accepted` list, not a selector — the corpus was found and
  // examined, and some of what it found is not what was accepted (plan 0090).
  'deferred-warning': false,
}

function format(findings: readonly DiagnosticFinding[]): string {
  const lines: string[] = ['']
  for (const finding of findings) {
    // The rule file first: with two identical vacuous rules in two files, the
    // rule's own description is the same sentence twice and says nothing about
    // which to open.
    // An orphan exclusion is located by its SOURCE file and line, not by a rule
    // file — the subject is a comment. The changelog claimed this printed "the
    // file and line" and the terminal format printed neither, so two stale
    // directives in one file rendered as two identical headers.
    if (finding.sourceFile !== undefined) {
      const at = finding.line === undefined ? '' : `:${String(finding.line)}`
      lines.push(`  ${finding.sourceFile}${at}`)
      lines.push(`    ${finding.rule}`)
    } else {
      lines.push(finding.ruleFile === undefined ? `  ${finding.rule}` : `  ${finding.ruleFile}`)
      if (finding.ruleFile !== undefined) lines.push(`    ${finding.rule}`)
    }
    if (HAS_GLOB[finding.kind]) {
      lines.push(
        `    ${finding.origin ?? finding.glob ?? '(unknown)'}  [${finding.position ?? 'unknown'}]`,
        `    ${finding.fault ?? 'unknown'}: ${finding.advice}`,
      )
    } else {
      // `no-condition`, `project-unknown` and `project-empty` have no glob, no
      // position and no fault. Rendering them through the dead-glob shape
      // printed `(unknown) [unknown]` / `unknown: …`, which reads like a bug in
      // the tool rather than a finding about the rule.
      //
      // `HAS_GLOB` below is what makes adding a fifth kind a COMPILE error
      // rather than a silent fall into this branch. `project-empty` was added
      // to the union and compiled without anyone choosing a rendering for it —
      // an if/else cannot ask the question, and `Record<K, …>` can. Same device
      // as `FAULT_ADVICE` and `ON_DISK_ADVICE` in `glob-diagnosis.ts`.
      lines.push(`    ${finding.kind}: ${finding.advice}`)
    }
    lines.push('')
  }
  // Deliberately no total. A count is the snapshot ADR-008 rule 4 bars, and it
  // is the number people ratchet against instead of fixing the findings.
  return lines.join('\n')
}
