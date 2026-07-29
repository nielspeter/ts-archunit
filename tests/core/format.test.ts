import { describe, it, expect } from 'vitest'
import { formatViolations, formatViolationsPlain } from '../../src/core/format.js'
import { makeViolation } from '../support/test-rule-builder.js'

/** Shorthand with format-test defaults (avoids repeating them everywhere). */
function mv(overrides: Partial<Parameters<typeof makeViolation>[0]> = {}) {
  return makeViolation({
    element: 'MyService.getTotal',
    file: '/project/src/service.ts',
    line: 42,
    message: 'bad call to parseInt',
    ...overrides,
  })
}

describe('formatViolationsPlain', () => {
  it('includes counter per violation', () => {
    const violations = [
      mv({ element: 'A', file: 'a.ts', line: 1, message: 'v1' }),
      mv({ element: 'B', file: 'b.ts', line: 2, message: 'v2' }),
      mv({ element: 'C', file: 'c.ts', line: 3, message: 'v3' }),
    ]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('[1/3]')
    expect(result).toContain('[2/3]')
    expect(result).toContain('[3/3]')
  })

  it('includes reason when provided', () => {
    const violations = [mv()]
    const result = formatViolationsPlain(violations, 'use shared helper instead')
    expect(result).toContain('Reason: use shared helper instead')
  })

  it('includes code frame when present', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [mv({ codeFrame })]
    const result = formatViolationsPlain(violations)
    expect(result).toContain(codeFrame)
  })

  it('includes suggestion when present', () => {
    const violations = [mv({ suggestion: 'Replace parseInt() with extractCount()' })]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('Fix: Replace parseInt() with extractCount()')
  })

  it('omits code frame when absent', () => {
    const violations = [mv()]
    const result = formatViolationsPlain(violations)
    // Should not have double blank lines or stray markers
    expect(result).not.toContain('> ')
  })

  it('returns empty string for no violations', () => {
    expect(formatViolationsPlain([])).toBe('')
  })

  it('includes element and message in output', () => {
    const violations = [mv()]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('MyService.getTotal')
    expect(result).toContain('bad call to parseInt')
    expect(result).toContain('1 found')
  })
})

describe('formatViolations', () => {
  it('includes violation counter', () => {
    const violations = [mv({ element: 'A' }), mv({ element: 'B' }), mv({ element: 'C' })]
    const result = formatViolations(violations)
    // In non-TTY (test env), ANSI is disabled, so plain text
    expect(result).toContain('[1 of 3]')
    expect(result).toContain('[2 of 3]')
    expect(result).toContain('[3 of 3]')
  })

  it('shows relative file paths', () => {
    const violations = [mv({ file: `${process.cwd()}/src/service.ts` })]
    const result = formatViolations(violations)
    expect(result).toContain('src/service.ts:42')
    expect(result).not.toContain(process.cwd())
  })

  it('includes suggestion as Fix line', () => {
    const violations = [mv({ suggestion: 'Use extractCount()' })]
    const result = formatViolations(violations)
    expect(result).toContain('Fix: Use extractCount()')
  })

  it('includes rule description', () => {
    const violations = [mv({ rule: 'should not call parseInt' })]
    const result = formatViolations(violations)
    expect(result).toContain('should not call parseInt')
  })

  it('includes reason from .because()', () => {
    const violations = [mv({ because: 'use helper instead' })]
    const result = formatViolations(violations)
    expect(result).toContain('use helper instead')
  })

  it('falls back to global reason when violation has no because', () => {
    const violations = [mv()]
    const result = formatViolations(violations, 'global reason')
    expect(result).toContain('global reason')
  })

  it('returns empty string for no violations', () => {
    expect(formatViolations([])).toBe('')
  })

  it('includes code frame when present', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [mv({ codeFrame })]
    const result = formatViolations(violations)
    expect(result).toContain(codeFrame)
  })

  it('respects codeFrames: false option', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [mv({ codeFrame })]
    const result = formatViolations(violations, undefined, { codeFrames: false })
    expect(result).not.toContain(codeFrame)
  })
})

describe('formatViolations for location-less config-level findings', () => {
  const REMEDY = 'prefix these with "**/": services: "src/services/**"'

  /**
   * A meta-finding (empty selector / empty discovery) carries its whole remedy in
   * `message` and has no source location. The rich formatter used to print only
   * the location line, so the remedy was invisible on the default surface — the
   * one place the agent consumer reads it (ADR-008). "A message is only a remedy
   * if it is printed."
   */
  it('prints the message, so the remedy is not invisible', () => {
    const result = formatViolations([mv({ file: '', line: 0, message: REMEDY })])
    expect(result).toContain(REMEDY)
  })

  it('does not render a bogus :0 location or the cwd', () => {
    const result = formatViolations([mv({ file: '', line: 0, message: REMEDY })])
    expect(result).not.toContain(':0')
    expect(result).not.toContain(process.cwd())
  })

  it('still renders location and element for findings that have a file', () => {
    const result = formatViolations([mv({ file: '/project/src/a.ts', line: 7 })])
    expect(result).toContain('MyService.getTotal')
    expect(result).toContain(':7')
  })

  /**
   * The two halves of `remedyRepeatsMessage` in this formatter, which is the one
   * renderer that does NOT always print `message`.
   *
   * A location-less finding prints the message in the location's slot, so a
   * remedy identical to it would print twice — that was the shipped output for
   * every assertion-gate finding until it was measured (plan 0070). But a
   * LOCATED violation never prints `message` here, so for it the `Fix:` line is
   * the remedy's only appearance and must survive. Sabotage confirmed the
   * asymmetry is load-bearing: dropping the `!v.file` half of the condition
   * silently deleted the remedy from every located violation and 2408 tests
   * still passed.
   */
  it('deduplicates the remedy only where the message was already printed', () => {
    const locationless = formatViolations([
      mv({ file: '', line: 0, message: REMEDY, suggestion: REMEDY }),
    ])
    expect(locationless.split(REMEDY).length - 1).toBe(1)

    const located = formatViolations([
      mv({ file: '/project/src/a.ts', line: 7, message: REMEDY, suggestion: REMEDY }),
    ])
    expect(located).toContain(`Fix: ${REMEDY}`)
  })

  it('keeps a Fix line that differs from the message on both shapes', () => {
    const other = 'Use the shared helper.'
    expect(
      formatViolations([mv({ file: '', line: 0, message: REMEDY, suggestion: other })]),
    ).toContain(`Fix: ${other}`)
    expect(
      formatViolations([mv({ file: '/project/src/a.ts', line: 7, suggestion: other })]),
    ).toContain(`Fix: ${other}`)
  })
})
