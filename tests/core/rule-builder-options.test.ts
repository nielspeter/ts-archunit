import { describe, it, expect, vi } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import { Baseline, hashViolation } from '../../src/helpers/baseline.js'
import { DiffFilter } from '../../src/helpers/diff-aware.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { TestRuleBuilder, stubProject, alwaysFail } from '../support/test-rule-builder.js'

const elements = [
  { name: 'ServiceA', file: '/project/src/a.ts', line: 5, exported: true },
  { name: 'ServiceB', file: '/project/src/b.ts', line: 10, exported: true },
  { name: 'ServiceC', file: '/project/src/c.ts', line: 15, exported: true },
]

describe('RuleBuilder with CheckOptions', () => {
  it('check({ baseline }) passes when all violations are known', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    builder.should().withCondition(alwaysFail())

    // Get the violations to build a baseline from their hashes
    try {
      builder.check()
    } catch {
      // expected
    }

    // Build a baseline that knows all 3 violations
    // We need to compute the hashes the same way the evaluate pipeline does
    const fakeViolations: ArchViolation[] = elements.map((el) => ({
      rule: 'should always fails with "violated"',
      element: el.name,
      file: el.file,
      line: el.line,
      message: `violated: ${el.name}`,
    }))
    const hashes = new Set(fakeViolations.map((v) => hashViolation(v)))
    const baseline = new Baseline(hashes, '/project')

    const builder2 = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder2.should().withCondition(alwaysFail()).check({ baseline })
    }).not.toThrow()
  })

  it('check({ baseline }) throws for new violations', () => {
    // Baseline knows ServiceA and ServiceB but not ServiceC
    const knownViolations: ArchViolation[] = [
      {
        rule: 'should always fails with "violated"',
        element: 'ServiceA',
        file: '/project/src/a.ts',
        line: 5,
        message: 'violated: ServiceA',
      },
      {
        rule: 'should always fails with "violated"',
        element: 'ServiceB',
        file: '/project/src/b.ts',
        line: 10,
        message: 'violated: ServiceB',
      },
    ]
    const hashes = new Set(knownViolations.map((v) => hashViolation(v)))
    const baseline = new Baseline(hashes, '/project')

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().withCondition(alwaysFail()).check({ baseline })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(1)
        expect(error.violations[0]?.element).toBe('ServiceC')
      }
    }
  })

  it('check({ diff }) filters to changed files', () => {
    const diff = new DiffFilter(new Set(['/project/src/b.ts']))

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().withCondition(alwaysFail()).check({ diff })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(1)
        expect(error.violations[0]?.element).toBe('ServiceB')
      }
    }
  })

  it('check({ baseline, diff }) combines both filters', () => {
    // ServiceA is known in baseline, ServiceB is in a changed file, ServiceC is neither
    const knownViolations: ArchViolation[] = [
      {
        rule: 'should always fails with "violated"',
        element: 'ServiceA',
        file: '/project/src/a.ts',
        line: 5,
        message: 'violated: ServiceA',
      },
    ]
    const hashes = new Set(knownViolations.map((v) => hashViolation(v)))
    const baseline = new Baseline(hashes, '/project')
    const diff = new DiffFilter(new Set(['/project/src/a.ts', '/project/src/b.ts']))

    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().withCondition(alwaysFail()).check({ baseline, diff })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        // ServiceA is known (filtered by baseline), ServiceC not in diff
        // Only ServiceB remains
        expect(error.violations).toHaveLength(1)
        expect(error.violations[0]?.element).toBe('ServiceB')
      }
    }
  })

  it('warn({ baseline }) logs only new violations', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const knownViolations: ArchViolation[] = [
      {
        rule: 'should always fails with "violated"',
        element: 'ServiceA',
        file: '/project/src/a.ts',
        line: 5,
        message: 'violated: ServiceA',
      },
      {
        rule: 'should always fails with "violated"',
        element: 'ServiceB',
        file: '/project/src/b.ts',
        line: 10,
        message: 'violated: ServiceB',
      },
    ]
    const hashes = new Set(knownViolations.map((v) => hashViolation(v)))
    const baseline = new Baseline(hashes, '/project')

    const builder = new TestRuleBuilder(stubProject, elements)
    builder.should().withCondition(alwaysFail()).warn({ baseline })

    expect(warnSpy).toHaveBeenCalledOnce()
    const output = warnSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('ServiceC')
    expect(output).not.toContain('ServiceA')
    expect(output).not.toContain('ServiceB')

    warnSpy.mockRestore()
  })

  it('check() without options works as before (backward compatible)', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder.should().withCondition(alwaysFail()).check()
    }).toThrow(ArchRuleError)
  })
})
