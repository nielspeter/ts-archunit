import { detectFormat } from '../../core/environment.js'
import { withBaseline } from '../../helpers/baseline.js'
import { diffAware } from '../../helpers/diff-aware.js'
import type { OutputFormat } from '../../core/check-options.js'
import type { ArchViolation } from '../../core/violation.js'
import { ArchRuleError } from '../../core/errors.js'
import { setCallerAggregatesReports, writeReport } from '../../core/execute-rule.js'
import { suppressionNotice } from '../../core/diff-disclosure.js'
import { edgeCoverageNotice, resetEdgeCoverage, untestedRules } from '../../core/edge-coverage.js'
import {
  commentSuppressionNotice,
  resetCommentSuppression,
} from '../../core/comment-suppression.js'
import { writeStderr } from '../../core/stderr.js'
import { loadRuleFiles } from '../load-rules.js'
import { dedupeConfigFindings } from '../../core/dedupe-config-findings.js'
import {
  attributeToRuleFile,
  failureOrViolations,
  ruleFileTruncated,
} from '../rule-file-findings.js'

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
 * Unified pipeline (plan 0060): collect `.violations()` across every builder
 * (each stamped with its severity), apply baseline/diff, report ONCE, and set
 * the exit code from the error-severity count. Warns are reported but do not
 * fail. A rule file that throws `ArchRuleError` on import (a bare self-executing
 * preset call) is handled by a best-effort catch — error-severity only.
 */
export async function runCheck(args: CheckArgs): Promise<number> {
  // Per run: the tally is module state (the `diff-disclosure` pattern), and a
  // second `runCheck` in one process — the CLI's watch loop, or a test — must
  // not inherit the first run's rules.
  resetEdgeCoverage()
  resetCommentSuppression()
  const format: OutputFormat = args.format === 'auto' ? detectFormat() : args.format
  const baseline = args.baseline !== undefined ? withBaseline(args.baseline) : undefined
  const diff = args.changed ? diffAware(args.base) : undefined

  // This command reports once, at the end, across every rule file. So a
  // self-executing rule file's own terminals must not also write the findings that
  // travel on their thrown error — see `setCallerAggregatesReports`.
  setCallerAggregatesReports(true)
  let collected: ArchViolation[] = []
  const total = args.ruleFiles.length
  for (const file of args.ruleFiles) {
    // TWO catches, at the two boundaries that can fail independently. Loading is
    // per file and can only be attributed to the file; evaluating is per builder,
    // so a single malformed rule must not take its twenty siblings in the same
    // file down with it — which one catch around the whole file would do
    // (bug 0025).
    let builders
    try {
      builders = await loadRuleFiles([file], { fresh: args.fresh })
    } catch (error: unknown) {
      // A user rule file that self-executes a throwing `.check()` at import
      // surfaces its violations rather than crashing. (Presets no longer throw
      // at import — they return builders.)
      collected.push(...failureOrViolations(file, error, total))
      // …and, for a thrown TERMINAL, say that the file stopped there — the part R3a
      // specified and did not build (bug 0029). A throw during import aborts the
      // module, so any rule declared after it never ran and its violations are not
      // in this report, while the run is red for the thrown finding so nothing else
      // reveals the gap.
      //
      // **Only for an `ArchRuleError`**, which is the signal that a terminal fired:
      // rules before it DID run and report, rules after did not. For any other error
      // — a syntax error, a missing dependency — nothing ran at all, and
      // `ruleFileFailure` already says the file could not be evaluated. Adding
      // "the rules after this never ran" there would imply some had, and point at a
      // "finding above" that is an error rather than a finding. Three of bug 0025's
      // own tests caught exactly that when this fired unconditionally.
      //
      // Only at THIS boundary either way. A throw from `builder.violations()` below
      // happens after the module finished, so nothing was truncated, and the
      // `export default [rule1, rule2]` shape never reaches here at all — an array
      // export builds every rule before any of them runs.
      if (error instanceof ArchRuleError) collected.push(ruleFileTruncated(file, total))
      continue
    }
    for (const builder of builders) {
      try {
        // Attributed here, where the rule file is known. A builder cannot do it
        // — the same builder is legal in a test file, where vitest supplies the
        // frame instead (bug 0026).
        collected.push(...attributeToRuleFile(builder.violations(), file))
      } catch (error: unknown) {
        collected.push(...failureOrViolations(file, error, total))
      }
    }
  }

  // One option, one finding (plan 0074) — after the per-file loop, because the
  // key includes the rule file: two files with the same bad preset option are
  // two edits and must both be reported.
  collected = dedupeConfigFindings(collected)

  let filtered = collected
  if (baseline) filtered = baseline.filterNew(filtered)

  // The one surface that can count. `filterToChanged` runs once here over every
  // collected violation, so `before - after` is the whole run's suppression —
  // unlike the per-rule terminals, which see one rule each (plan 0071,
  // `core/diff-disclosure.ts`). Derived by subtraction rather than asked of the
  // filter, so it holds for a caller-supplied `DiffFilterLike` too.
  let notice: string | undefined
  if (diff) {
    const before = filtered.length
    filtered = diff.filterToChanged(filtered)
    notice = suppressionNotice(before - filtered.length, diff.size, diff.baseBranch)
    if (notice !== undefined) writeStderr(notice)
  }

  // writeReport handles empties: json always emits one document (so a clean run
  // is still parseable), terminal/github emit nothing. The notice rides along as
  // `summary.reason` so a `--format json` consumer reading only stdout still
  // learns the report is partial — stderr and stdout are different streams, and
  // an agent piping one of them would otherwise see `total: 0` and stop.
  // `reason` is rendered as each violation's "Why:" line on the terminal path
  // (`format.ts`: `v.because ?? reason`), so a RUN-level notice must not travel
  // that way — it would appear as the justification for an unrelated finding.
  // `summary.reason` in JSON is genuinely run-level, so it goes there, and
  // stderr carries it for every other format. Found by sabotage: removing the
  // `writeStderr` call left the tests green because the notice was reaching
  // stderr through the "Why:" line instead.
  writeReport(filtered, format, format === 'json' ? notice : undefined, untestedRules())

  // Bug 0015, and it goes AFTER the report so it reads as a footnote rather than
  // as part of the findings. JSON carries the same information structurally in
  // `summary.untestedAllowlists`, so emitting the prose there too would duplicate
  // it into a document a consumer parses.
  if (format !== 'json') {
    const coverage = edgeCoverageNotice()
    if (coverage !== undefined) writeStderr(`${coverage}\n`)
  }

  // Inline exclusion comments, same footnote position and the same reason. Kept
  // out of the JSON prose for the same reason coverage is: a consumer parsing
  // that document gets the identities structurally, not as a sentence to grep.
  if (format !== 'json') {
    const suppressed = commentSuppressionNotice()
    if (suppressed !== undefined) writeStderr(`${suppressed}\n`)
  }

  // Exit code = error-severity count; warns are reported but never fail.
  return filtered.filter((v) => (v.severity ?? 'error') === 'error').length
}
