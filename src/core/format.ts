import type { ArchViolation } from './violation.js'
import { remedyRepeatsMessage } from './violation.js'
import { bold, red, cyan, dim } from './ansi.js'
import path from 'node:path'

/**
 * Format options for violation output.
 */
export interface FormatOptions {
  /** Working directory for relative path display. Default: process.cwd() */
  cwd?: string
  /** Whether to include code frames in output. Default: true */
  codeFrames?: boolean
}

/** Format a single violation into a rich terminal section. */
function formatSingleViolation(
  v: ArchViolation,
  index: number,
  total: number,
  cwd: string,
  showCodeFrames: boolean,
  reason: string | undefined,
): string {
  const counter = bold(red(`Architecture Violation [${String(index + 1)} of ${String(total)}]`))
  const ruleLine = `  ${dim('Rule:')} ${v.rule}`
  // `message` is printed for BOTH shapes, and it used to be printed for neither
  // — a located violation rendered only `file:line — element`, so the one
  // sentence saying what is actually wrong was dropped from the default surface
  // for every ordinary violation. Nothing failed when this was fixed, because
  // nothing pinned it either way; `formatViolationsPlain` had always printed it,
  // so the two formatters disagreed about what a violation IS.
  //
  // A config-level finding has no source location: `path.relative(cwd, '')`
  // renders as the cwd and ':0' is noise, so it gets the message alone.
  const location = v.file
    ? `  ${v.message}\n  ${cyan(path.relative(cwd, v.file) + ':' + String(v.line))} ${dim('—')} ${v.element}`
    : `  ${v.message}`
  const codeLine = showCodeFrames && v.codeFrame ? `\n${v.codeFrame}` : ''

  const whyText = v.because ?? reason
  const whyLine = whyText ? `  ${dim('Why:')} ${whyText}` : ''
  // Suppressed whenever the `location` slot above already printed this exact
  // text, which is now BOTH shapes — see the note there. It used to be
  // `!v.file && remedyRepeatsMessage(v)`, and that asymmetry was load-bearing
  // and pinned, because a located violation did not render `message` at all: its
  // `Fix:` line was the remedy's only appearance. Rendering `message` for both
  // shapes removed the premise, and the `!v.file` half became a defect —
  // measured, two occurrences of the remedy for a located finding whose
  // suggestion is its message.
  //
  // So do not "restore" the asymmetry from the old comment: check whether this
  // formatter still prints `message` for a located violation first.
  const fixLine = v.suggestion && !remedyRepeatsMessage(v) ? `  ${dim('Fix:')} ${v.suggestion}` : ''
  const docsLine = v.docs ? `  ${dim('Docs:')} ${v.docs}` : ''

  const parts = [counter, '', ruleLine, '', location]
  if (codeLine) parts.push(codeLine)
  if (whyLine) parts.push(whyLine)
  if (fixLine) parts.push(fixLine)
  if (docsLine) parts.push(docsLine)

  return parts.join('\n')
}

/**
 * Format violations into a rich, readable terminal string.
 *
 * Groups violations by rule, shows a counter ("Architecture Violation [1 of 3]"),
 * displays code frames and suggestions, and uses ANSI colors for emphasis.
 */
export function formatViolations(
  violations: ArchViolation[],
  reason?: string,
  options?: FormatOptions,
): string {
  if (violations.length === 0) return ''

  const cwd = options?.cwd ?? process.cwd()
  const showCodeFrames = options?.codeFrames ?? true
  const total = violations.length

  const sections = violations.map((v, i) =>
    formatSingleViolation(v, i, total, cwd, showCodeFrames, reason),
  )

  return sections.join('\n\n')
}

/**
 * Format violations into a plain-text string (no ANSI codes).
 *
 * Public export, for callers that aggregate violations themselves and need
 * output free of ANSI codes — serialized, logged to a file, or embedded in
 * another tool's report. `ArchRuleError.message` is a one-line summary and does
 * not use this; the run's detail is written by `writeReport`.
 */
export function formatViolationsPlain(violations: ArchViolation[], reason?: string): string {
  if (violations.length === 0) return ''

  const header = `Architecture violation${violations.length === 1 ? '' : 's'} (${String(violations.length)} found)`
  const reasonLine = reason ? `\nReason: ${reason}` : ''

  const details = violations
    .map((v, i) => {
      // A configuration finding has no source location — it reports that a RULE
      // enforces nothing, not that a line is wrong — so it carries `file: ''`
      // and a `line` that means nothing. Rendering it produced a bare `(:1)`
      // (bug 0047). The rich formatter and the GitHub formatter
      // (`format-github.ts:58`) both already special-case this; plain and JSON
      // were the two that did not.
      const where = v.file === '' ? '' : ` (${v.file}:${String(v.line)})`
      const parts = [
        `  [${String(i + 1)}/${String(violations.length)}] ${v.element}: ${v.message}${where}`,
      ]
      if (v.codeFrame) parts.push(v.codeFrame)
      // This format always renders `message`, so a remedy identical to it is
      // already shown — see `remedyRepeatsMessage`.
      if (v.suggestion && !remedyRepeatsMessage(v)) parts.push(`  Fix: ${v.suggestion}`)
      return parts.join('\n')
    })
    .join('\n\n')

  return `${header}${reasonLine}\n\n${details}`
}
