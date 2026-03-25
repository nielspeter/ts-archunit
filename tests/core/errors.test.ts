import { describe, it, expect } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchViolation } from '../../src/core/violation.js'

describe('ArchRuleError', () => {
  it('formats a single violation', () => {
    const violations: ArchViolation[] = [
      {
        rule: 'test rule',
        element: 'ProductService.getTotal',
        file: 'src/service.ts',
        line: 42,
        message: 'bad call to parseInt',
      },
    ]
    const error = new ArchRuleError(violations)
    expect(error.name).toBe('ArchRuleError')
    expect(error.message).toContain('1 found')
    expect(error.message).toContain('ProductService.getTotal')
    expect(error.message).toContain('bad call to parseInt')
    expect(error.message).toContain('src/service.ts:42')
  })

  it('formats multiple violations', () => {
    const violations: ArchViolation[] = [
      { rule: 'r', element: 'A', file: 'a.ts', line: 1, message: 'violation A' },
      { rule: 'r', element: 'B', file: 'b.ts', line: 2, message: 'violation B' },
    ]
    const error = new ArchRuleError(violations)
    expect(error.message).toContain('2 found')
    expect(error.message).toContain('violation A')
    expect(error.message).toContain('violation B')
  })

  it('includes reason when provided', () => {
    const violations: ArchViolation[] = [
      { rule: 'r', element: 'X', file: 'x.ts', line: 1, message: 'bad' },
    ]
    const error = new ArchRuleError(violations, 'use shared helper instead')
    expect(error.message).toContain('Reason: use shared helper instead')
  })

  it('exposes violations array', () => {
    const violations: ArchViolation[] = [
      { rule: 'r', element: 'A', file: 'a.ts', line: 1, message: 'a' },
      { rule: 'r', element: 'B', file: 'b.ts', line: 2, message: 'b' },
    ]
    const error = new ArchRuleError(violations)
    expect(error.violations).toBe(violations)
  })

  it('extends Error', () => {
    const error = new ArchRuleError([])
    expect(error).toBeInstanceOf(Error)
  })
})
