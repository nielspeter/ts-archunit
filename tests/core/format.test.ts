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
