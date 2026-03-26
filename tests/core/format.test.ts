import { describe, it, expect } from 'vitest'
import { formatViolations, formatViolationsPlain } from '../../src/core/format.js'
import type { ArchViolation } from '../../src/core/violation.js'

function makeViolation(overrides: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'test rule',
    element: 'MyService.getTotal',
    file: '/project/src/service.ts',
    line: 42,
    message: 'bad call to parseInt',
    ...overrides,
  }
}

describe('formatViolationsPlain', () => {
  it('includes counter per violation', () => {
    const violations = [
      makeViolation({ element: 'A', file: 'a.ts', line: 1, message: 'v1' }),
      makeViolation({ element: 'B', file: 'b.ts', line: 2, message: 'v2' }),
      makeViolation({ element: 'C', file: 'c.ts', line: 3, message: 'v3' }),
    ]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('[1/3]')
    expect(result).toContain('[2/3]')
    expect(result).toContain('[3/3]')
  })

  it('includes reason when provided', () => {
    const violations = [makeViolation()]
    const result = formatViolationsPlain(violations, 'use shared helper instead')
    expect(result).toContain('Reason: use shared helper instead')
  })

  it('includes code frame when present', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [makeViolation({ codeFrame })]
    const result = formatViolationsPlain(violations)
    expect(result).toContain(codeFrame)
  })

  it('includes suggestion when present', () => {
    const violations = [makeViolation({ suggestion: 'Replace parseInt() with extractCount()' })]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('Suggestion: Replace parseInt() with extractCount()')
  })

  it('omits code frame when absent', () => {
    const violations = [makeViolation()]
    const result = formatViolationsPlain(violations)
    // Should not have double blank lines or stray markers
    expect(result).not.toContain('> ')
  })

  it('returns empty string for no violations', () => {
    expect(formatViolationsPlain([])).toBe('')
  })

  it('includes element and message in output', () => {
    const violations = [makeViolation()]
    const result = formatViolationsPlain(violations)
    expect(result).toContain('MyService.getTotal')
    expect(result).toContain('bad call to parseInt')
    expect(result).toContain('1 found')
  })
})

describe('formatViolations', () => {
  it('includes violation counter', () => {
    const violations = [
      makeViolation({ element: 'A' }),
      makeViolation({ element: 'B' }),
      makeViolation({ element: 'C' }),
    ]
    const result = formatViolations(violations)
    // In non-TTY (test env), ANSI is disabled, so plain text
    expect(result).toContain('[1 of 3]')
    expect(result).toContain('[2 of 3]')
    expect(result).toContain('[3 of 3]')
  })

  it('shows relative file paths', () => {
    const violations = [makeViolation({ file: `${process.cwd()}/src/service.ts` })]
    const result = formatViolations(violations)
    expect(result).toContain('src/service.ts:42')
    expect(result).not.toContain(process.cwd())
  })

  it('includes suggestion', () => {
    const violations = [makeViolation({ suggestion: 'Use extractCount()' })]
    const result = formatViolations(violations)
    expect(result).toContain('Suggestion: Use extractCount()')
  })

  it('includes rule description', () => {
    const violations = [makeViolation({ rule: 'should not call parseInt' })]
    const result = formatViolations(violations)
    expect(result).toContain('should not call parseInt')
  })

  it('includes reason from .because()', () => {
    const violations = [makeViolation({ because: 'use helper instead' })]
    const result = formatViolations(violations)
    expect(result).toContain('use helper instead')
  })

  it('falls back to global reason when violation has no because', () => {
    const violations = [makeViolation()]
    const result = formatViolations(violations, 'global reason')
    expect(result).toContain('global reason')
  })

  it('returns empty string for no violations', () => {
    expect(formatViolations([])).toBe('')
  })

  it('includes code frame when present', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [makeViolation({ codeFrame })]
    const result = formatViolations(violations)
    expect(result).toContain(codeFrame)
  })

  it('respects codeFrames: false option', () => {
    const codeFrame = '  > 42 | const x = parseInt(y)'
    const violations = [makeViolation({ codeFrame })]
    const result = formatViolations(violations, undefined, { codeFrames: false })
    expect(result).not.toContain(codeFrame)
  })
})
