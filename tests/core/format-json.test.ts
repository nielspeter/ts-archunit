import { describe, it, expect } from 'vitest'
import { formatViolationsJson } from '../../src/core/format-json.js'
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

describe('formatViolationsJson', () => {
  it('formats single violation as JSON with correct fields', () => {
    const violations = [makeViolation()]
    const output = formatViolationsJson(violations)
    const parsed: unknown = JSON.parse(output)
    expect(parsed).toEqual({
      summary: { total: 1, reason: null },
      violations: [
        {
          rule: 'test rule',
          ruleId: null,
          element: 'MyService.getTotal',
          file: '/project/src/service.ts',
          line: 42,
          message: 'bad call to parseInt',
          because: null,
          suggestion: null,
          docs: null,
        },
      ],
    })
  })

  it('formats multiple violations with correct count', () => {
    const violations = [
      makeViolation({ element: 'A', line: 1 }),
      makeViolation({ element: 'B', line: 2 }),
      makeViolation({ element: 'C', line: 3 }),
    ]
    const output = formatViolationsJson(violations)
    const parsed = JSON.parse(output) as { summary: { total: number }; violations: unknown[] }
    expect(parsed.summary.total).toBe(3)
    expect(parsed.violations).toHaveLength(3)
  })

  it('includes reason when provided', () => {
    const violations = [makeViolation()]
    const output = formatViolationsJson(violations, 'use helper instead')
    const parsed = JSON.parse(output) as { summary: { reason: string | null } }
    expect(parsed.summary.reason).toBe('use helper instead')
  })

  it('uses null for missing optional values (because, suggestion)', () => {
    const violations = [makeViolation()]
    const output = formatViolationsJson(violations)
    const parsed = JSON.parse(output) as {
      violations: Array<{ because: string | null; suggestion: string | null }>
    }
    expect(parsed.violations[0]?.because).toBeNull()
    expect(parsed.violations[0]?.suggestion).toBeNull()
  })

  it('output is parseable JSON with optional fields', () => {
    const violations = [makeViolation({ because: 'security risk', suggestion: 'use Number()' })]
    const output = formatViolationsJson(violations, 'test reason')
    const parsed = JSON.parse(output) as {
      summary: { reason: string | null }
      violations: Array<{ because: string | null; suggestion: string | null }>
    }
    expect(parsed.summary.reason).toBe('test reason')
    expect(parsed.violations[0]?.because).toBe('security risk')
    expect(parsed.violations[0]?.suggestion).toBe('use Number()')
  })
})
