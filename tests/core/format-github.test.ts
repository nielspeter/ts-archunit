import { describe, it, expect } from 'vitest'
import { formatViolationsGitHub, escapeGitHub } from '../../src/core/format-github.js'
import type { ArchViolation } from '../../src/core/violation.js'

function makeViolation(overrides: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'test rule',
    element: 'MyService.getTotal',
    file: `${process.cwd()}/src/service.ts`,
    line: 42,
    message: 'bad call to parseInt',
    ...overrides,
  }
}

describe('formatViolationsGitHub', () => {
  it('formats single violation as ::error', () => {
    const violations = [makeViolation()]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('::error file=')
    expect(output).toContain(',line=42,')
    expect(output).toContain('title=Architecture Violation: test rule')
    expect(output).toContain('::bad call to parseInt')
  })

  it('uses relative file paths', () => {
    const violations = [makeViolation()]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('file=src/service.ts,')
    expect(output).not.toContain(process.cwd())
  })

  it('escapes newlines and percent in text', () => {
    expect(escapeGitHub('line1\nline2')).toBe('line1%0Aline2')
    expect(escapeGitHub('100% done')).toBe('100%25 done')
    expect(escapeGitHub('a\rb')).toBe('a%0Db')
  })

  it('includes because in message when present', () => {
    const violations = [makeViolation({ because: 'security risk' })]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('::bad call to parseInt (security risk)')
  })

  it('uses ::warning for warn severity', () => {
    const violations = [makeViolation()]
    const output = formatViolationsGitHub(violations, 'warning')
    expect(output).toMatch(/^::warning file=/)
    expect(output).not.toContain('::error')
  })

  it('produces one line per violation for multiple violations', () => {
    const violations = [
      makeViolation({ element: 'A', line: 1 }),
      makeViolation({ element: 'B', line: 2 }),
      makeViolation({ element: 'C', line: 3 }),
    ]
    const output = formatViolationsGitHub(violations)
    const lines = output.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^::error/)
    expect(lines[1]).toMatch(/^::error/)
    expect(lines[2]).toMatch(/^::error/)
  })
})
