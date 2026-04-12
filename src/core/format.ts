import type { ArchViolation } from './violation.js'
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
  const relativePath = path.relative(cwd, v.file)
  const locationRef = cyan(relativePath + ':' + String(v.line))
  const location = `  ${locationRef} ${dim('—')} ${v.element}`
  const codeLine = showCodeFrames && v.codeFrame ? `\n${v.codeFrame}` : ''

  const whyText = v.because ?? reason
  const whyLine = whyText ? `  ${dim('Why:')} ${whyText}` : ''
  const fixLine = v.suggestion ? `  ${dim('Fix:')} ${v.suggestion}` : ''
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
 * Used by ArchRuleError.message — error messages should be plain text
 * since they may be captured by test runners, serialized, or logged to files.
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
      if (v.suggestion) parts.push(`  Fix: ${v.suggestion}`)
      return parts.join('\n')
    })
    .join('\n\n')

  return `${header}${reasonLine}\n\n${details}`
}
