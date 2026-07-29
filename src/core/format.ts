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
  // A config-level meta-finding (empty selector / empty discovery) has no source
  // location: `path.relative(cwd, '')` renders as the cwd and ':0' is noise, while
  // `message` carries the whole remedy. Show the message in the location's place —
  // otherwise the remedy is invisible on the default surface, which is exactly
  // where the agent consumer reads it (ADR-008).
  const location = v.file
    ? `  ${cyan(path.relative(cwd, v.file) + ':' + String(v.line))} ${dim('—')} ${v.element}`
    : `  ${v.message}`
  const codeLine = showCodeFrames && v.codeFrame ? `\n${v.codeFrame}` : ''

  const whyText = v.because ?? reason
  const whyLine = whyText ? `  ${dim('Why:')} ${whyText}` : ''
  // Suppressed only when the `location` slot above already printed this exact
  // text — which happens for a location-less finding whose remedy is its
  // message. A located violation never renders `message` here, so its `Fix:`
  // line is the only place the remedy appears and must always print.
  const remedyAlreadyShown = !v.file && remedyRepeatsMessage(v)
  const fixLine = v.suggestion && !remedyAlreadyShown ? `  ${dim('Fix:')} ${v.suggestion}` : ''
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
      const parts = [
        `  [${String(i + 1)}/${String(violations.length)}] ${v.element}: ${v.message} (${v.file}:${String(v.line)})`,
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
